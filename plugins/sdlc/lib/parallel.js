'use strict';

// Running several changes from one main session. A draft is discussed and approved
// on the default branch, then moved to its own worktree, where a background Claude
// session builds it. The main session stays where it is and looks after them all.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const machine = require('./machine');
const workspace = require('./workspace');

const { ARTIFACTS, isOpen } = machine;
const { SdlcError, git } = workspace;

const START_PROMPT = '/sdlc:next';

// A finished teammate stays listed as running, which keeps the stop hook from
// sending a stalled lead back. Nobody is watching a build, so plain subagents do
// the same work and leave nothing behind.
const BUILD_SETTINGS = JSON.stringify({ env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } });
const CLAUDE_TIMEOUT_MS = 60000;
const SETTINGS = path.join('.claude', 'settings.json');

// `claude agents --json` says a session is blocked but not on what, so only attaching shows it.
const BLOCKED = 'waiting on you, at a permission prompt or a question';

function slugOf(item) {
  return item.id.replace(/^\d+-/, '');
}

function sessionName(item) {
  return `sdlc-${slugOf(item)}`;
}

function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function sameDir(one, other) {
  return realPath(one) === realPath(other);
}

// The session's own variables would make the new one a child of it.
function claudeEnv() {
  const keep = ([key]) => !key.startsWith('CLAUDE') || key === 'CLAUDE_CONFIG_DIR';
  return Object.fromEntries(Object.entries(process.env).filter(keep));
}

function claude(cwd, args) {
  return spawnSync('claude', args, { cwd, env: claudeEnv(), encoding: 'utf8', timeout: CLAUDE_TIMEOUT_MS });
}

// Null when Claude Code can't say, which is different from having no sessions.
function backgroundSessions() {
  const result = claude(process.cwd(), ['agents', '--json']);
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).filter((session) => session.kind === 'background');
  } catch {
    return null;
  }
}

function sessionsAt(sessions, dir) {
  return (sessions ?? []).filter((session) => sameDir(session.cwd, dir)).sort((a, b) => b.startedAt - a.startedAt);
}

function sessionState(session) {
  if (!session) return 'stopped';
  if (session.state === 'blocked') return 'blocked';
  // `state` is how the last turn ended, and can stay at `working` on an idle session.
  return session.status === 'idle' ? 'idle' : 'running';
}

function describeSession(sessions, dir) {
  if (sessions === null) return null;
  const [session] = sessionsAt(sessions, dir);
  const state = sessionState(session);
  return state === 'blocked' ? 'waiting on you' : state;
}

function stopSessions(dir) {
  for (const session of sessionsAt(backgroundSessions(), dir)) claude(dir, ['stop', session.id]);
}

// The state is all in Git, so a fresh session picks up where the last one stopped.
// Resuming a session that's idle would only start a copy of it.
//
// Its output goes to a file because the first `--bg` also starts Claude Code's
// background service, which would hold a pipe open and hang this until it timed out.
function startSession(dir, item) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-launch-')), 'output');
  const output = fs.openSync(log, 'w');
  const model = workspace.loadConfig(dir).build_model ?? 'sonnet';
  const args = ['--bg', '--settings', BUILD_SETTINGS, '--model', model, '-n', sessionName(item), START_PROMPT];
  const options = { cwd: dir, env: claudeEnv(), stdio: ['ignore', output, output], timeout: CLAUDE_TIMEOUT_MS };
  const result = spawnSync('claude', args, options);
  fs.closeSync(output);
  const detail = result.error?.message ?? fs.readFileSync(log, 'utf8').trim();
  fs.rmSync(path.dirname(log), { recursive: true });
  if (result.status !== 0) throw new SdlcError(`${item.id} is ready in ${dir}, but its session didn't start: ${detail}`);
}

function restart(dir, item) {
  stopSessions(dir);
  startSession(dir, item);
}

function isAncestor(root, ancestor, commit) {
  return git(root, ['merge-base', '--is-ancestor', ancestor, commit]) !== null;
}

// The default branch as far as anyone knows. A local copy that has unpushed work is
// ahead of the remote, so it wins. One that's only behind doesn't.
function latestCommit(root, branch) {
  git(root, ['fetch', '-q', 'origin', branch]);
  const local = git(root, ['rev-parse', '--verify', '-q', branch]);
  const remote = git(root, ['rev-parse', '--verify', '-q', `origin/${branch}`]);
  return remote && (!local || isAncestor(root, local, remote)) ? remote : local;
}

function itemDir(root, item) {
  return path.join(root, '.sdlc', 'work', item.id);
}

function commitItem(dir, item, message) {
  git(dir, ['add', '-A', '--', path.join('.sdlc', 'work', item.id)]);
  return git(dir, ['commit', '-q', '-m', message]);
}

function withEvent(item, event) {
  return { ...item, history: [...item.history, { at: new Date().toISOString(), ...event }] };
}

// Moves the draft rather than copying it, so it can't also get built a second time.
// Nothing leaves the main checkout until the worktree holds it in a commit.
function promote(root, { item }) {
  const facts = workspace.readFacts(root, item);
  const next = machine.nextAction(item, facts);
  if (next.action !== 'launch') throw new SdlcError(`can't launch ${item.id}: ${machine.describeNext(next)}`);
  if (git(root, ['ls-files', '--', path.join('.sdlc', 'work', item.id)])) {
    throw new SdlcError(`${item.id} is committed on ${item.branch}, so it can't be moved to a worktree`);
  }
  // The worktree starts from the last commit. Without the plugin enabled there, its
  // session can't even run the start prompt, and builds with no hooks.
  if (git(root, ['status', '--porcelain', '--', SETTINGS])) {
    throw new SdlcError(`commit ${SETTINGS} first: ${item.id}'s worktree starts from the last commit, so its build wouldn't get your changes`);
  }
  const branch = `worktree-${slugOf(item)}`;
  const dir = path.join(root, '.claude', 'worktrees', slugOf(item));
  const base = latestCommit(root, item.branch);
  if (git(root, ['worktree', 'add', '-q', '-b', branch, dir, base]) === null) {
    throw new SdlcError(`can't create the worktree ${dir} on branch ${branch}: is one there already?`);
  }
  fs.cpSync(itemDir(root, item), itemDir(dir, item), { recursive: true });
  const { item: building } = machine.advance(item, { ...facts, draft: false });
  const event = { from: item.stage, to: building.stage, launched: branch };
  workspace.saveItem(dir, withEvent({ ...building, branch, base }, event));
  if (commitItem(dir, item, `Start ${item.id}`) === null) {
    git(root, ['worktree', 'remove', '--force', dir]);
    git(root, ['branch', '-q', '-D', branch]);
    throw new SdlcError(`can't commit ${item.id} in its worktree, so it stays here`);
  }
  fs.rmSync(itemDir(root, item), { recursive: true });
  startSession(dir, item);
  return dir;
}

function refuseIfRunning({ root: dir, item }) {
  const [session] = sessionsAt(backgroundSessions(), dir);
  const state = sessionState(session);
  if (state === 'running') throw new SdlcError(`${item.id} is still running`);
  if (state === 'blocked') {
    throw new SdlcError(`${item.id} is ${BLOCKED}: run claude attach ${sessionName(item)}`);
  }
}

function resume(found) {
  const { root: dir, item } = found;
  if (!isOpen(item)) throw new SdlcError(`${item.id} is ${item.stage}, so there's nothing to build`);
  refuseIfRunning(found);
  const next = machine.nextAction(item, workspace.readFacts(dir, item));
  if (next.action === 'approve') throw new SdlcError(`can't launch ${item.id}: ${machine.describeNext(next)}`);
  restart(dir, item);
  return dir;
}

// The one command for both a new build and one that has stopped.
function launch(root, query) {
  const found = workspace.findItem(root, query);
  return workspace.isLinkedWorktree(found.root) ? resume(found) : promote(root, found);
}

// Runs the project's own tests and has the tool write the evidence, so the result
// is the test output itself. A failure removes any earlier pass.
function runVerify(root, item) {
  const command = workspace.loadConfig(root).commands?.verify;
  if (!command) throw new SdlcError('set commands.verify in .sdlc/config.json');
  const result = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd().split('\n').slice(-200).join('\n');
  const code = workspace.codeFingerprint(root, item.base);
  const body = `command: ${command}\ncommit: ${workspace.headCommit(root)}\ncode: ${code}\n\n${output}\n`;
  const passed = result.status === 0;
  workspace.removeEvidence(root, item, passed ? 'verify-failed.md' : 'verify.md');
  workspace.writeEvidence(root, item, passed ? 'verify.md' : 'verify-failed.md', body);
  return { passed, command, output };
}

function currentItem(root) {
  const own = workspace.ownItems(root).filter((item) => item.stage !== machine.ABANDONED);
  if (own.length === 0) throw new SdlcError('no work item on this branch');
  return { root, item: own.at(-1) };
}

function setAside(dir, item, label) {
  workspace.archiveEvidence(dir, item.id, `sync-${label}`, workspace.SYNC_EVIDENCE);
  return withEvent(machine.reopen(item), { from: item.stage, to: machine.reopen(item).stage, reason: 'sync' });
}

// Brings the default branch in. If this change's own files came out the same then
// its reviews still stand, and only the tests need to run on the combined code.
// Otherwise it goes back through build, verify, and review. That compares contents,
// so it doesn't matter whether main's commits got here by this or by hand.
function update({ root: dir, item }) {
  const branch = workspace.defaultBranch(dir);
  if (!branch) throw new SdlcError("can't tell which branch is the default");
  if (item.branch === branch) throw new SdlcError(`${item.id} is still a draft on ${branch}, so nothing needs syncing`);
  if (git(dir, ['status', '--porcelain'])) throw new SdlcError(`${item.id} has uncommitted changes, so commit them first`);
  const target = latestCommit(dir, branch);
  const head = workspace.headCommit(dir);
  if (isAncestor(dir, head, target)) throw new SdlcError(`${item.id} is already merged into ${branch}`);
  if (isAncestor(dir, target, head) && item.base === target) return { outcome: 'current', branch };

  const before = workspace.codeFingerprint(dir, git(dir, ['merge-base', head, target]));
  const message = `Sync ${item.id} with ${branch}`;
  const merged = git(dir, ['merge', '-q', '--no-edit', '-m', message, target]);
  const conflicts = (git(dir, ['diff', '--name-only', '--diff-filter=U']) ?? '').split('\n').filter(Boolean);
  if (merged === null && conflicts.length === 0) throw new SdlcError(`can't merge ${branch} into ${item.id}`);

  const moved = { ...item, base: target };
  const label = target.slice(0, 7);
  if (conflicts.length > 0) {
    workspace.saveItem(dir, setAside(dir, moved, label));
    return { outcome: 'conflict', branch, conflicts };
  }
  const tested = fs.existsSync(path.join(itemDir(dir, item), ARTIFACTS.verify));
  const same = workspace.codeFingerprint(dir, target) === before;
  const passed = tested && same && runVerify(dir, moved).passed;
  const reopened = tested && !passed;
  workspace.saveItem(dir, reopened ? setAside(dir, moved, label) : moved);
  commitItem(dir, item, message);
  if (git(dir, ['rev-parse', '--abbrev-ref', '@{u}'])) git(dir, ['push', '-q']);
  return { outcome: reopened ? 'reopened' : 'updated', branch, retested: passed };
}

function reportSync(item, { outcome, branch, conflicts }) {
  const messages = {
    current: `${item.id} is up to date with ${branch}.`,
    updated: `${item.id} now includes ${branch}.`,
    reopened: `${item.id} now includes ${branch}, but its code or tests changed, so it's back at build.`,
    conflict: `${item.id} has conflicts with ${branch} in ${conflicts?.join(', ')}. It's back at build: resolve them and commit.`,
  };
  return messages[outcome];
}

// From inside the worktree the session is the one asking. From anywhere else, a
// running session owns its files, and a stopped one needs starting afterwards.
function sync(root, query) {
  if (!query && !workspace.isLinkedWorktree(root)) throw new SdlcError('name the change to sync');
  const found = query ? workspace.findItem(root, query) : currentItem(root);
  const outside = !sameDir(root, found.root);
  if (outside) refuseIfRunning(found);
  const result = update(found);
  const after = workspace.loadItem(found.root, found.item.id);
  if (outside && result.outcome !== 'current' && isOpen(after)) restart(found.root, after);
  return { ...result, message: reportSync(after, result) };
}

function isMerged({ root: dir, item }) {
  const branch = workspace.defaultBranch(dir);
  if (!branch) return false;
  return isAncestor(dir, workspace.headCommit(dir), latestCommit(dir, branch)) && item.base !== workspace.headCommit(dir);
}

function removeWorktree(root, found) {
  const { root: dir, item } = found;
  stopSessions(dir);
  const sessions = sessionsAt(backgroundSessions(), dir);
  if (git(root, ['worktree', 'remove', dir]) === null) {
    throw new SdlcError(`can't remove ${dir}, so check what's left in it`);
  }
  git(root, ['branch', '-q', '-D', item.branch]);
  // `rm` also deletes a session's worktree, so it only runs once that's already gone.
  for (const session of sessions) claude(root, ['rm', session.id]);
  return item.id;
}

function cleanup(root, query) {
  const merged = query ? [workspace.findItem(root, query)] : workspace.launchedItems(root).filter(isMerged);
  for (const found of merged) {
    if (sameDir(found.root, root)) throw new SdlcError(`run this from the main session, not from ${found.item.id}'s worktree`);
    if (!workspace.isLinkedWorktree(found.root)) throw new SdlcError(`${found.item.id} has no worktree`);
    if (!isMerged(found)) throw new SdlcError(`${found.item.id} isn't merged yet, so its worktree stays`);
  }
  return merged.map((found) => removeWorktree(root, found));
}

// A person just approved something a background build was waiting on. Nothing else
// can wake that session, because it's not attended and it stopped at the gate.
function continueAfterApproval(root, item) {
  if (!workspace.isLinkedWorktree(root)) return null;
  if (sessionsAt(backgroundSessions(), root).length === 0) return null;
  try {
    restart(root, item);
    return `The build of ${item.id} is running again.`;
  } catch (error) {
    if (!(error instanceof SdlcError)) throw error;
    return `The build of ${item.id} didn't restart, so use /sdlc:launch: ${error.message}`;
  }
}

// What a main session should hear about one build, or null if it needs nothing.
function attention({ root: dir, item }, sessions) {
  const next = machine.nextAction(item, workspace.readFacts(dir, item));
  if (next.action === 'approve') return `${item.id} needs you: ${machine.describeNext(next)}.`;
  if (sessions === null) return null;
  const [session] = sessionsAt(sessions, dir);
  const state = sessionState(session);
  if (state === 'running') return null;
  if (!isOpen(item)) return `${item.id} has finished, so it's ready to merge.`;
  if (state === 'blocked') {
    return `${item.id} is ${BLOCKED}, so run claude attach ${sessionName(item)} in a terminal.`;
  }
  return `${item.id} stopped at ${item.stage} with work left, so use /sdlc:launch ${slugOf(item)}.`;
}

module.exports = {
  attention,
  backgroundSessions,
  cleanup,
  continueAfterApproval,
  describeSession,
  launch,
  runVerify,
  stopSessions,
  sync,
};
