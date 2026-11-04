'use strict';

// Running several changes at once. Each change gets its own worktree and branch the
// moment it starts, and a person works on it in a window of its own, from intent to
// merge. The main session stays on the default branch. Inside a change, slices that
// don't depend on each other can build at once, each in a worktree of its own.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reviewPassed, sliceList } = require('./check');
const machine = require('./machine');
const workspace = require('./workspace');

const { ARTIFACTS } = machine;
const { SdlcError, git } = workspace;

const SETTINGS = path.join('.claude', 'settings.json');
const EDITOR_TIMEOUT_MS = 30000;

// Where VS Code keeps its command-line tool on macOS, which isn't always on the PATH.
const MAC_CODE = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';

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

// Whether `sdlc new` here should give the change a worktree of its own.
function startsWorktree(root) {
  const branch = workspace.currentBranch(root);
  return !workspace.isLinkedWorktree(root) && branch !== null && branch === workspace.defaultBranch(root);
}

// The default branch never holds a change, so the main session stays free and two
// changes can't trip over each other's drafts. What the person asked for goes with
// it, because the session in its window can't see this conversation.
function start(root, { slug, track, files, request }) {
  workspace.assertSlug(slug);
  // The worktree starts from the last commit. Without the plugin enabled there, its
  // session can't run the factory's commands, and builds with no hooks.
  if (git(root, ['status', '--porcelain', '--', SETTINGS])) {
    throw new SdlcError(`commit ${SETTINGS} first: the new worktree starts from the last commit, so it wouldn't get your changes`);
  }
  const branch = `worktree-${slug}`;
  const dir = path.join(root, '.claude', 'worktrees', slug);
  const base = latestCommit(root, workspace.currentBranch(root));
  if (git(root, ['worktree', 'add', '-q', '-b', branch, dir, base]) === null) {
    throw new SdlcError(`can't create the worktree ${dir} on branch ${branch}: is one there already?`);
  }
  try {
    const item = workspace.createItem(dir, slug, track, machine.firstStage(track), files);
    if (request) workspace.writeArtifact(dir, item, 'request.md', `${request.trim()}\n`);
    if (commitItem(dir, item, `Start ${item.id}`) === null) throw new SdlcError(`can't commit ${item.id} in its worktree`);
    return { dir, item };
  } catch (error) {
    git(root, ['worktree', 'remove', '--force', dir]);
    git(root, ['branch', '-q', '-D', branch]);
    throw error;
  }
}

function insideVsCode() {
  return Boolean(process.env.VSCODE_PID) || process.env.TERM_PROGRAM === 'vscode';
}

// A new VS Code window on the worktree, when this runs inside VS Code. Anywhere else,
// or if VS Code can't be found, the person opens it themselves.
function openWindow(dir) {
  if (!insideVsCode()) return false;
  for (const command of ['code', ...(process.platform === 'darwin' ? [MAC_CODE] : [])]) {
    const result = spawnSync(command, ['--new-window', dir], { stdio: 'ignore', timeout: EDITOR_TIMEOUT_MS });
    if (result.status === 0) return true;
    if (result.error?.code !== 'ENOENT') return false;
  }
  return false;
}

function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A subagent's worktree branches from the remote's default branch unless this is
// set, and a builder there wouldn't see the spec it's meant to build. The most
// specific setting wins, as it does in Claude Code.
function parallelSlices(root) {
  const home = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
  const files = [path.join(root, '.claude', 'settings.local.json'), path.join(root, SETTINGS), path.join(home, 'settings.json')];
  for (const file of files) {
    const baseRef = readSettings(file)?.worktree?.baseRef;
    if (baseRef) return baseRef === 'head';
  }
  return false;
}

// Each slice, whether it has passed its review, and whether it can be built now:
// a slice waits for the ones its heading says it comes after.
function slices(root, item) {
  const listed = sliceList(workspace.readArtifact(root, item, ARTIFACTS.spec));
  const passed = new Set(listed.filter(({ id }) => reviewPassed(root, item, id)).map(({ id }) => id));
  const described = listed.map((slice) => {
    const waiting = slice.after.filter((id) => !passed.has(id));
    const state = passed.has(slice.id) ? 'passed' : waiting.length > 0 ? 'waiting' : 'ready';
    return { ...slice, state, ...(state === 'waiting' && { waiting }) };
  });
  return { slices: described, parallel: parallelSlices(root) };
}

function currentItem(root) {
  const own = workspace.ownItems(root).filter((item) => item.stage !== machine.ABANDONED);
  if (own.length === 0) throw new SdlcError('no work item on this branch');
  return { root, item: own.at(-1) };
}

// A slice built at the same time as others comes back as a branch in a worktree of
// its own. Merging it and removing that worktree is one step, so nothing is left
// lying around, and a conflict leaves both sides as they were.
function mergeSlice(root, worktree) {
  const { item } = currentItem(root);
  if (item.stage !== 'build') throw new SdlcError(`${item.id} is at ${item.stage}, not build`);
  const dir = path.resolve(root, worktree);
  if (sameDir(dir, root) || !workspace.checkouts(root).some((checkout) => sameDir(checkout, dir))) {
    throw new SdlcError(`${worktree} isn't another worktree of this repo`);
  }
  const theirs = fs.existsSync(path.join(itemDir(dir, item), 'state.json')) && workspace.loadItem(dir, item.id);
  if (!theirs || theirs.branch !== item.branch) throw new SdlcError(`${worktree} wasn't started from ${item.id}`);
  const branch = workspace.currentBranch(dir);
  if (git(dir, ['status', '--porcelain'])) throw new SdlcError(`${worktree} has uncommitted changes, so commit them there first`);
  if (git(root, ['status', '--porcelain'])) throw new SdlcError(`${item.id} has uncommitted changes, so commit them first`);
  if (isAncestor(root, branch, 'HEAD')) throw new SdlcError(`${branch} has nothing this change doesn't have already`);
  if (git(root, ['merge', '-q', '--no-ff', '-m', `Merge ${branch} into ${item.id}`, branch]) === null) {
    git(root, ['merge', '--abort']);
    throw new SdlcError(`${branch} conflicts with ${item.id}, so nothing changed: build that slice again here, once the others are in`);
  }
  git(root, ['worktree', 'remove', '--force', dir]);
  git(root, ['branch', '-q', '-D', branch]);
  return `Merged ${branch} into ${item.id} and removed its worktree.`;
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
  if (item.branch === branch) throw new SdlcError(`${item.id} is on ${branch} itself, so nothing needs syncing`);
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

// Only from the change's own worktree, because the session in its window owns its
// files, and merging under it would change them while it works.
function sync(root, query) {
  const found = query ? workspace.findItem(root, query) : currentItem(root);
  if (!sameDir(root, found.root)) {
    throw new SdlcError(`run /sdlc:sync in ${found.item.id}'s own window, at ${found.root}`);
  }
  const result = update(found);
  const after = workspace.loadItem(found.root, found.item.id);
  return { ...result, message: reportSync(after, result) };
}

function isMerged({ root: dir, item }) {
  const branch = workspace.defaultBranch(dir);
  if (!branch) return false;
  return isAncestor(dir, workspace.headCommit(dir), latestCommit(dir, branch)) && item.base !== workspace.headCommit(dir);
}

function removeWorktree(root, { root: dir, item }) {
  if (git(root, ['worktree', 'remove', dir]) === null) {
    throw new SdlcError(`can't remove ${dir}, so check what's left in it`);
  }
  git(root, ['branch', '-q', '-D', item.branch]);
  return item.id;
}

function cleanup(root, query) {
  const merged = query ? [workspace.findItem(root, query)] : workspace.worktreeItems(root).filter(isMerged);
  for (const found of merged) {
    if (sameDir(found.root, root)) throw new SdlcError(`run this from the main session, not from ${found.item.id}'s worktree`);
    if (!workspace.isLinkedWorktree(found.root)) throw new SdlcError(`${found.item.id} has no worktree`);
    if (!isMerged(found)) throw new SdlcError(`${found.item.id} isn't merged yet, so its worktree stays`);
  }
  return merged.map((found) => removeWorktree(root, found));
}

module.exports = {
  cleanup,
  mergeSlice,
  openWindow,
  runVerify,
  slices,
  start,
  startsWorktree,
  sync,
};
