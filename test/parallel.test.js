'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'sdlc');
const CLI = path.join(PLUGIN, 'bin', 'sdlc');
const HUMAN = path.join(PLUGIN, 'scripts', 'on-human-command.js');
const HOOK = path.join(PLUGIN, 'scripts', 'hook.js');
const AWAIT = path.join(PLUGIN, 'scripts', 'await-approval.js');
const SPEC = '### S1: The change\n\n```scope\nsrc/**\n```\n';
const ID = '0001-csv';

// Stands in for VS Code's command-line tool, so a test can see what it was asked to open.
const FAKE_CODE = `#!/bin/sh
echo "$@" >> "$FAKE_DIR/code-calls"
exit 0
`;

function tempDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function context(t) {
  const fake = tempDir(t, 'sdlc-fake-');
  fs.writeFileSync(path.join(fake, 'code'), FAKE_CODE, { mode: 0o755 });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${fake}:${process.env.PATH}`,
    FAKE_DIR: fake,
    CLAUDE_CONFIG_DIR: tempDir(t, 'sdlc-home-'),
  };
  for (const key of ['CLAUDE_CODE_SESSION_ATTENDED', 'VSCODE_PID', 'TERM_PROGRAM']) delete env[key];
  return {
    fake,
    env,
    git: (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'ignore' }),
    gitOut: (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim(),
    sdlc: (cwd, ...args) => spawnSync(CLI, args, { cwd, encoding: 'utf8', env }),
    human: (cwd, command, args) => {
      const input = JSON.stringify({ cwd, command_args: args });
      const result = spawnSync('node', [HUMAN, command], { input, encoding: 'utf8', env });
      return JSON.parse(result.stdout);
    },
    hook: (event, input) => spawnSync('node', [HOOK, event], { input: JSON.stringify(input), encoding: 'utf8', env }),
    codeCalls: () => {
      const file = path.join(fake, 'code-calls');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
  };
}

function touch(cwd, file, content = 'x\n') {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
}

function repo(t, verify = 'true') {
  const c = context(t);
  const root = tempDir(t, 'sdlc-parallel-');
  c.git(root, 'init', '-q', '-b', 'main');
  c.git(root, 'config', 'user.name', 'Ada');
  c.git(root, 'config', 'user.email', 'ada@example.com');
  c.sdlc(root, 'init', '--verify', verify);
  touch(root, 'src/shared.py', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
  c.git(root, 'add', '-A');
  c.git(root, 'commit', '-q', '-m', 'first');
  return { ...c, root };
}

const itemFile = (root, name, id = ID) => path.join(root, '.sdlc', 'work', id, name);

function state(root, id = ID) {
  return JSON.parse(fs.readFileSync(itemFile(root, 'state.json', id), 'utf8'));
}

// A change started from the main session, in the worktree it gets.
function started(c, slug = 'csv') {
  const result = c.sdlc(c.root, 'new', slug, '--request', 'Export the list as CSV');
  assert.equal(result.status, 0, result.stderr);
  return path.join(c.root, '.claude', 'worktrees', slug);
}

function advance(c, cwd) {
  const result = c.sdlc(cwd, 'advance');
  assert.equal(result.status, 0, result.stderr);
}

// A started change with both documents approved, at build.
function building(c, slug = 'csv', id = ID, spec = SPEC) {
  const dir = started(c, slug);
  fs.writeFileSync(itemFile(dir, 'intent.md', id), 'the intent');
  c.human(dir, 'approve', slug);
  advance(c, dir);
  fs.writeFileSync(itemFile(dir, 'spec.md', id), spec);
  c.human(dir, 'approve', slug);
  advance(c, dir);
  assert.equal(state(dir, id).stage, 'build');
  return dir;
}

// `sdlc advance` commits the item's records itself, so there may be nothing left.
function commitAll(c, cwd) {
  c.git(cwd, 'add', '-A');
  c.git(cwd, 'commit', '-q', '--allow-empty', '-m', 'work');
}

// A change taken right to the end, with every step really done. A review that
// didn't plainly pass gets a person's sign-off on the merge.
function finished(c, slug = 'csv', id = ID, review = 'Verdict: pass\n') {
  const dir = building(c, slug, id);
  touch(dir, `src/${slug}.py`);
  touch(dir, itemFile('', 'evidence/reviews/S1.md', id), 'Verdict: pass\n');
  advance(c, dir);
  commitAll(c, dir);
  assert.equal(c.sdlc(dir, 'verify').status, 0);
  advance(c, dir);
  touch(dir, itemFile('', 'evidence/review.md', id), review);
  advance(c, dir);
  if (!/Verdict: pass/.test(review)) c.human(dir, 'approve', slug);
  advance(c, dir);
  commitAll(c, dir);
  assert.equal(state(dir, id).stage, 'done');
  return dir;
}

function mainMoves(c, file, content) {
  touch(c.root, file, content);
  c.git(c.root, 'add', file);
  c.git(c.root, 'commit', '-q', '-m', 'main moved');
}

// What Claude Code makes for a subagent with `isolation: worktree`, once
// `worktree.baseRef` is `head`: a worktree beside the others, on its own branch.
function sliceWorktree(c, from, name = 'agent-a1') {
  const dir = path.join(c.root, '.claude', 'worktrees', name);
  c.git(from, 'worktree', 'add', '-q', '-b', `worktree-${name}`, dir, 'HEAD');
  return dir;
}

test('starting a change on the default branch gives it a committed worktree, and leaves main alone', (t) => {
  const c = repo(t);
  const before = c.gitOut(c.root, 'rev-parse', 'HEAD');
  const result = c.sdlc(c.root, 'new', 'csv', '--request', 'Export the list as CSV');
  assert.equal(result.status, 0, result.stderr);
  const dir = path.join(c.root, '.claude', 'worktrees', 'csv');
  assert.match(result.stdout, /^0001-csv {2}standard {2}intent {2}in .*\.claude\/worktrees\/csv, on branch worktree-csv/);
  assert.match(result.stdout, /Open .*worktrees\/csv in its own window.*\/sdlc:next/);

  assert.equal(c.gitOut(c.root, 'rev-parse', 'HEAD'), before);
  assert.equal(c.gitOut(c.root, 'status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(c.root, '.sdlc', 'work', ID)), false);

  assert.equal(c.gitOut(dir, 'branch', '--show-current'), 'worktree-csv');
  assert.equal(c.gitOut(dir, 'status', '--porcelain'), '');
  const item = state(dir);
  assert.equal(item.stage, 'intent');
  assert.equal(item.branch, 'worktree-csv');
  assert.equal(item.base, before);
  assert.equal(fs.readFileSync(itemFile(dir, 'request.md'), 'utf8'), 'Export the list as CSV\n');
  assert.equal(JSON.parse(c.sdlc(dir, 'status', '--json').stdout).next.action, 'produce');
  assert.equal(c.codeCalls(), '', 'nothing opens outside VS Code');
});

test('inside VS Code, a new window opens on the worktree', (t) => {
  const c = repo(t);
  const result = spawnSync(CLI, ['new', 'csv'], { cwd: c.root, encoding: 'utf8', env: { ...c.env, VSCODE_PID: '1' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /A VS Code window has opened on it/);
  assert.equal(c.codeCalls().trim(), `--new-window ${path.join(c.root, '.claude', 'worktrees', 'csv')}`);
});

test('starting waits for Claude\'s settings to be committed, or the change would start without the plugin', (t) => {
  const c = repo(t);
  const settings = path.join(c.root, '.claude', 'settings.json');
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('}', ', "enabledPlugins": {}\n}'));
  const refused = c.sdlc(c.root, 'new', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /commit \.claude\/settings\.json first/);
  assert.equal(fs.existsSync(path.join(c.root, '.claude', 'worktrees', 'csv')), false);

  c.git(c.root, 'commit', '-q', '-m', 'settings', '--', '.claude/settings.json');
  assert.equal(c.sdlc(c.root, 'new', 'csv').status, 0);
});

test('a worktree that can\'t commit leaves nothing behind', (t) => {
  const c = repo(t);
  touch(c.root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(c.root, '.git/hooks/pre-commit'), 0o755);
  const refused = c.sdlc(c.root, 'new', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /can't commit 0001-csv/);
  assert.equal(fs.existsSync(path.join(c.root, '.claude', 'worktrees', 'csv')), false);
  assert.equal(c.gitOut(c.root, 'branch', '--list', 'worktree-csv'), '');
});

test('a bad or taken name is refused before anything is made', (t) => {
  const c = repo(t);
  assert.equal(c.sdlc(c.root, 'new', 'Bad_Name').status, 2);
  assert.equal(fs.existsSync(path.join(c.root, '.claude', 'worktrees')), false);
  started(c);
  const taken = c.sdlc(c.root, 'new', 'csv');
  assert.equal(taken.status, 1);
  assert.match(taken.stderr, /is one there already/);
});

test('changes in flight never share a number', (t) => {
  const c = repo(t);
  started(c);
  assert.match(c.sdlc(c.root, 'new', 'other').stdout, /^0002-other/);
});

test('status in the main session shows each change and where it is', (t) => {
  const c = repo(t);
  started(c);
  assert.match(c.sdlc(c.root, 'status').stdout, /0001-csv .*next: write intent\.md.*\(in \.claude\/worktrees\/csv\)/);
});

test('a person can approve from the main session, and the change\'s window carries on', async (t) => {
  const c = repo(t);
  const dir = started(c);
  fs.writeFileSync(itemFile(dir, 'intent.md'), 'the intent');
  const watcher = watch(c, dir);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.match(c.human(c.root, 'approve', 'csv').hookSpecificOutput.additionalContext, /Approval recorded: 0001-csv intent/);
  const result = await outcome(watcher);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /approved 0001-csv, so continue with \/sdlc:next 0001-csv/);
});

test('the main session has no gate to wait at', async (t) => {
  const c = repo(t);
  const dir = started(c);
  fs.writeFileSync(itemFile(dir, 'intent.md'), 'the intent');
  assert.equal((await outcome(watch(c, c.root), 400)).code, 0);
});

const THREE_SLICES = [
  '### S1: Parse it\n\n```scope\nsrc/parse.py\n```\n',
  '### S2: Export it (after S1)\n\n```scope\nsrc/export.py\n```\n',
  '### S3: Document it\n\n```scope\ndocs/**\n```\n',
].join('\n');

test('slices say which can be built now, and wait for the ones they come after', (t) => {
  const c = repo(t);
  const dir = building(c, 'csv', ID, THREE_SLICES);
  const listed = () => JSON.parse(c.sdlc(dir, 'slices', '--json').stdout);
  assert.deepEqual(listed(), {
    id: ID,
    parallel: true,
    slices: [
      { id: 'S1', title: 'Parse it', after: [], state: 'ready' },
      { id: 'S2', title: 'Export it', after: ['S1'], state: 'waiting', waiting: ['S1'] },
      { id: 'S3', title: 'Document it', after: [], state: 'ready' },
    ],
  });
  assert.match(c.sdlc(dir, 'slices').stdout, /S2 {2}waits on S1 {2}Export it/);

  touch(dir, itemFile('', 'evidence/reviews/S1.md'), 'Verdict: pass\n');
  assert.deepEqual(listed().slices.map(({ state: s }) => s), ['passed', 'ready', 'ready']);
});

test('slices build one at a time unless subagent worktrees start from the change', (t) => {
  const c = repo(t);
  const dir = building(c);
  const settings = path.join(dir, '.claude', 'settings.json');
  const { worktree, ...rest } = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(worktree, { baseRef: 'head' }, 'init sets it');
  fs.writeFileSync(settings, JSON.stringify(rest));
  assert.equal(JSON.parse(c.sdlc(dir, 'slices', '--json').stdout).parallel, false);
  assert.match(c.sdlc(dir, 'slices').stdout, /one at a time\. Set worktree\.baseRef to "head"/);
});

test('a slice\'s own worktree still holds the change, so its builder is held to the same checks', (t) => {
  const c = repo(t);
  const dir = building(c);
  const slice = sliceWorktree(c, dir);
  assert.deepEqual(JSON.parse(c.sdlc(slice, 'status', '--json').stdout).items.map(({ id }) => id), [ID]);
  assert.deepEqual(JSON.parse(c.sdlc(c.root, 'status', '--json').stdout).items, [], 'main has none of its own');
  assert.equal(c.sdlc(c.root, 'status', 'csv').status, 1, 'the slice worktree doesn\'t make the name ambiguous');

  touch(slice, 'docs/elsewhere.md');
  const stop = c.hook('subagent-stop', { cwd: slice, agent_type: 'sdlc:builder', agent_id: 'b1', session_id: 'none' });
  assert.match(JSON.parse(stop.stdout).reason, /outside the spec's scope: docs\/elsewhere\.md/);
});

test('a worktree started from main doesn\'t take on an open change it never forked from', (t) => {
  const c = repo(t);
  building(c);
  const other = sliceWorktree(c, c.root, 'plain');
  assert.deepEqual(JSON.parse(c.sdlc(other, 'status', '--json').stdout).items, []);
});

test('a slice built in its own worktree merges back, and its worktree goes', (t) => {
  const c = repo(t);
  const dir = building(c);
  const slice = sliceWorktree(c, dir);
  touch(slice, 'src/parse.py');
  c.git(slice, 'add', 'src/parse.py');
  c.git(slice, 'commit', '-q', '-m', 'Parse it\n\nSlice: S1');

  const result = c.sdlc(dir, 'merge-slice', slice);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Merged worktree-agent-a1 into 0001-csv and removed its worktree/);
  assert.ok(fs.existsSync(path.join(dir, 'src/parse.py')));
  assert.equal(fs.existsSync(slice), false);
  assert.equal(c.gitOut(dir, 'branch', '--list', 'worktree-agent-a1'), '');
  assert.equal(c.sdlc(dir, 'check').status, 0);
});

test('merge-slice refuses what it shouldn\'t take, and a conflict changes nothing', (t) => {
  const c = repo(t);
  const dir = building(c);
  const slice = sliceWorktree(c, dir);
  assert.match(c.sdlc(dir, 'merge-slice', slice).stderr, /has nothing this change doesn't have/);

  touch(slice, 'src/shared.py', 'theirs\n');
  assert.match(c.sdlc(dir, 'merge-slice', slice).stderr, /uncommitted changes, so commit them there first/);
  commitAll(c, slice);

  const plain = sliceWorktree(c, c.root, 'plain');
  assert.match(c.sdlc(dir, 'merge-slice', plain).stderr, /wasn't started from 0001-csv/);
  assert.match(c.sdlc(dir, 'merge-slice', c.root).stderr, /wasn't started from 0001-csv/);

  touch(dir, 'src/shared.py', 'mine\n');
  commitAll(c, dir);
  const head = c.gitOut(dir, 'rev-parse', 'HEAD');
  const refused = c.sdlc(dir, 'merge-slice', slice);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /conflicts with 0001-csv, so nothing changed/);
  assert.equal(c.gitOut(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(c.gitOut(dir, 'status', '--porcelain'), '');
  assert.ok(fs.existsSync(slice));
});

test('sync fixes the update that used to trip the scope check', (t) => {
  const c = repo(t);
  const dir = building(c);
  touch(dir, 'src/csv.py');
  commitAll(c, dir);
  mainMoves(c, 'docs/x.md');

  assert.equal(c.sdlc(dir, 'sync').status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'docs/x.md')));
  assert.equal(state(dir).base, c.gitOut(c.root, 'rev-parse', 'main'));
  assert.equal(c.sdlc(dir, 'check').status, 0);
  assert.equal(c.gitOut(dir, 'status', '--porcelain'), '');
});

test('sync repairs a change someone already merged main into by hand', (t) => {
  const c = repo(t);
  const dir = building(c);
  touch(dir, 'src/csv.py');
  commitAll(c, dir);
  mainMoves(c, 'docs/x.md');
  c.git(dir, 'merge', '-q', '--no-edit', 'main');
  assert.equal(c.sdlc(dir, 'check').status, 1);

  assert.equal(c.sdlc(dir, 'sync').status, 0);
  assert.equal(c.sdlc(dir, 'check').status, 0);
});

test('a finished change with no overlap stays finished, once the tests pass on the combined code', (t) => {
  const c = repo(t);
  const dir = finished(c);
  const before = fs.readFileSync(itemFile(dir, 'evidence/verify.md'), 'utf8');
  mainMoves(c, 'docs/x.md');

  const result = c.sdlc(dir, 'sync');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /now includes main/);
  assert.equal(state(dir).stage, 'done');
  assert.notEqual(fs.readFileSync(itemFile(dir, 'evidence/verify.md'), 'utf8'), before);
  assert.equal(c.gitOut(dir, 'status', '--porcelain'), '');
  assert.equal(c.sdlc(dir, 'gates', '--base', 'main').status, 0);
});

test('tests that fail on the combined code send a finished change back', (t) => {
  const c = repo(t, 'test ! -f docs/breaks.md');
  const dir = finished(c);
  mainMoves(c, 'docs/breaks.md');

  const result = c.sdlc(dir, 'sync');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /back at build/);
  const item = state(dir);
  assert.equal(item.stage, 'build');
  assert.equal(item.rework, 0, 'someone else\'s change isn\'t this one\'s rework');
  assert.equal(fs.existsSync(itemFile(dir, 'evidence/verify.md')), false);
  assert.ok(fs.existsSync(itemFile(dir, 'evidence/verify-failed.md')));
});

test('a change to the same file goes back through verify and review, keeping slice reviews', (t) => {
  const c = repo(t);
  const dir = building(c);
  fs.writeFileSync(path.join(dir, 'src/shared.py'), 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n');
  touch(dir, itemFile('', 'evidence/reviews/S1.md'), 'Verdict: pass\n');
  advance(c, dir);
  commitAll(c, dir);
  assert.equal(c.sdlc(dir, 'verify').status, 0);
  advance(c, dir);
  touch(dir, itemFile('', 'evidence/review.md'), 'Verdict: pass\n');
  advance(c, dir);
  advance(c, dir);
  commitAll(c, dir);
  mainMoves(c, 'src/shared.py', 'one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n');

  const result = c.sdlc(dir, 'sync');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /back at build/);
  assert.equal(state(dir).stage, 'build');
  assert.equal(fs.readFileSync(path.join(dir, 'src/shared.py'), 'utf8').split('\n')[6], 'SEVEN');
  assert.equal(fs.existsSync(itemFile(dir, 'evidence/verify.md')), false);
  assert.equal(fs.existsSync(itemFile(dir, 'evidence/review.md')), false);
  assert.ok(fs.existsSync(itemFile(dir, 'evidence/reviews/S1.md')));
  assert.equal(c.sdlc(dir, 'gates', '--base', 'main').status, 1);

  advance(c, dir);
  assert.equal(c.sdlc(dir, 'verify').status, 0);
  advance(c, dir);
  touch(dir, itemFile('', 'evidence/review.md'), 'Verdict: pass\n');
  advance(c, dir);
  advance(c, dir);
  commitAll(c, dir);
  assert.equal(c.sdlc(dir, 'gates', '--base', 'main').status, 0);
});

test('a conflict leaves the merge for the build to finish', (t) => {
  const c = repo(t);
  const dir = building(c);
  touch(dir, 'src/shared.py', 'mine\n');
  touch(dir, itemFile('', 'evidence/reviews/S1.md'), 'Verdict: pass\n');
  advance(c, dir);
  commitAll(c, dir);
  assert.equal(c.sdlc(dir, 'verify').status, 0);
  commitAll(c, dir);
  mainMoves(c, 'src/shared.py', 'theirs\n');

  const result = c.sdlc(dir, 'sync');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /conflicts with main in src\/shared\.py/);
  assert.equal(state(dir).stage, 'build');

  touch(dir, 'src/shared.py', 'both\n');
  commitAll(c, dir);
  assert.equal(c.gitOut(dir, 'status', '--porcelain'), '');
  assert.equal(c.sdlc(dir, 'check').status, 0);
  advance(c, dir);
  assert.equal(c.sdlc(dir, 'verify').status, 0);
});

test('sync with nothing new does nothing', (t) => {
  const c = repo(t);
  const dir = finished(c);
  const head = c.gitOut(dir, 'rev-parse', 'HEAD');
  const result = c.sdlc(dir, 'sync');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /up to date/);
  assert.equal(c.gitOut(dir, 'rev-parse', 'HEAD'), head);
});

test('sync refuses uncommitted work, a change that already merged, and the main session', (t) => {
  const c = repo(t);
  const dir = building(c);
  touch(dir, 'src/csv.py');
  mainMoves(c, 'docs/x.md');
  assert.match(c.sdlc(dir, 'sync').stderr, /uncommitted/);

  commitAll(c, dir);
  c.git(c.root, 'merge', '-q', '--no-edit', 'worktree-csv');
  assert.match(c.sdlc(dir, 'sync').stderr, /already merged/);

  started(c, 'other');
  assert.match(c.sdlc(c.root, 'sync', 'other').stderr, /run \/sdlc:sync in 0002-other's own window/);
  assert.match(c.sdlc(c.root, 'sync').stderr, /no work item on this branch/);
});

test('sync uses the remote when it\'s ahead, and pushes the result', (t) => {
  const c = repo(t);
  const remote = tempDir(t, 'sdlc-remote-');
  c.git(remote, 'init', '-q', '--bare', '-b', 'main');
  c.git(c.root, 'remote', 'add', 'origin', remote);
  c.git(c.root, 'push', '-q', '-u', 'origin', 'main');
  const dir = finished(c);
  c.git(dir, 'push', '-q', '-u', 'origin', 'worktree-csv');

  mainMoves(c, 'docs/x.md');
  c.git(c.root, 'push', '-q');
  c.git(c.root, 'reset', '-q', '--hard', 'HEAD~1');

  assert.equal(c.sdlc(dir, 'sync').status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'docs/x.md')));
  assert.equal(c.gitOut(dir, 'rev-parse', 'HEAD'), c.gitOut(remote, 'rev-parse', 'worktree-csv'));
});

test('cleanup removes merged changes and nothing else', (t) => {
  const c = repo(t);
  const merged = finished(c);
  const open = started(c, 'other');

  assert.match(c.sdlc(c.root, 'cleanup', 'csv').stderr, /isn't merged yet/);
  assert.match(c.sdlc(c.root, 'cleanup').stdout, /No merged changes/);
  assert.ok(fs.existsSync(merged));

  c.git(c.root, 'merge', '-q', '--no-edit', 'worktree-csv');
  assert.match(c.sdlc(c.root, 'cleanup').stdout, /Removed 0001-csv/);
  assert.equal(fs.existsSync(merged), false);
  assert.equal(c.gitOut(c.root, 'branch', '--list', 'worktree-csv'), '');
  assert.ok(fs.existsSync(open));
});

test('cleanup refuses from inside the worktree it would remove', (t) => {
  const c = repo(t);
  const dir = finished(c);
  c.git(c.root, 'merge', '-q', '--no-edit', 'worktree-csv');
  assert.match(c.sdlc(dir, 'cleanup', 'csv').stderr, /from the main session/);
  assert.ok(fs.existsSync(dir));
});

test('cleanup won\'t delete uncommitted work', (t) => {
  const c = repo(t);
  const dir = finished(c);
  c.git(c.root, 'merge', '-q', '--no-edit', 'worktree-csv');
  touch(dir, 'notes.md');
  assert.equal(c.sdlc(c.root, 'cleanup', 'csv').status, 1);
  assert.ok(fs.existsSync(path.join(dir, 'notes.md')));
});

function watch(c, cwd) {
  const child = spawn('node', [AWAIT], { env: { ...c.env, SDLC_AWAIT_POLL_MS: '10' } });
  child.stdin.end(JSON.stringify({ cwd }));
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stderr }));
  });
  return { child, done };
}

// Settles on the watcher's result, or stops it and reports that it was still waiting.
async function outcome(watcher, ms = 1500) {
  const timer = setTimeout(() => watcher.child.kill(), ms);
  const result = await watcher.done;
  clearTimeout(timer);
  return result;
}

// Stands in for gh, with a pull request that's open and checks that pass unless told not to.
const FAKE_GH = `#!/bin/sh
echo "$@" >> "$FAKE_DIR/gh-calls"
case "$1 $2" in
  'pr view') echo '{"number":7,"state":"OPEN"}' ;;
  'pr checks') [ -f "$FAKE_DIR/checks-fail" ] && { echo 'gates	fail'; exit 1; }; echo 'gates	pass' ;;
esac
exit 0
`;

const UNCLEAR = 'Some aliases are unverified, so a person should decide.\n';

function withRemote(t, c) {
  const remote = tempDir(t, 'sdlc-remote-');
  c.git(remote, 'init', '-q', '--bare', '-b', 'main');
  c.git(c.root, 'remote', 'add', 'origin', remote);
  c.git(c.root, 'push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(c.fake, 'gh'), FAKE_GH, { mode: 0o755 });
}

function ghCalls(c) {
  const file = path.join(c.fake, 'gh-calls');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('a signed-off merge goes into the default branch with no remote', (t) => {
  const c = repo(t);
  const dir = finished(c, 'csv', ID, UNCLEAR);
  const result = c.sdlc(dir, 'merge');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Merged worktree-csv into main/);
  assert.ok(fs.existsSync(path.join(c.root, 'src/csv.py')));
  assert.match(c.gitOut(c.root, 'log', '-1', '--format=%s'), /^Merge worktree-csv: 0001-csv/);
});

test('a signed-off merge waits for the pull request\'s checks, then merges it', (t) => {
  const c = repo(t);
  withRemote(t, c);
  const dir = finished(c, 'csv', ID, UNCLEAR);
  const result = c.sdlc(dir, 'merge');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Merged pull request #7/);
  assert.match(ghCalls(c), /pr checks 7 --watch[\s\S]*pr merge 7 --merge/);
  assert.ok(c.gitOut(c.root, 'ls-remote', 'origin', 'worktree-csv'), 'the branch was pushed');
});

test('a pull request whose checks fail stays open', (t) => {
  const c = repo(t);
  withRemote(t, c);
  const dir = finished(c, 'csv', ID, UNCLEAR);
  fs.writeFileSync(path.join(c.fake, 'checks-fail'), '');
  const refused = c.sdlc(dir, 'merge');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /checks didn't pass, so it stays open/);
  assert.doesNotMatch(ghCalls(c), /pr merge/);
});

test('nothing merges without a person\'s sign-off on the review as it is', (t) => {
  const c = repo(t);
  const clean = finished(c);
  assert.match(c.sdlc(clean, 'merge').stderr, /review passed, so nobody signed off a merge: a person merges it/);

  const other = finished(c, 'other', '0002-other', UNCLEAR);
  fs.appendFileSync(itemFile(other, 'evidence/review.md', '0002-other'), 'And one more thing.\n');
  commitAll(c, other);
  assert.match(c.sdlc(other, 'merge').stderr, /merge sign-off is missing or out of date/);

  const before = c.gitOut(c.root, 'rev-parse', 'HEAD');
  const third = building(c, 'third', '0003-third');
  assert.match(c.sdlc(third, 'merge', 'third').stderr, /at build, not finished/);
  assert.equal(c.gitOut(c.root, 'rev-parse', 'HEAD'), before);
});
