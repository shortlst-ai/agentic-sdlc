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
const AWAIT = path.join(PLUGIN, 'scripts', 'await-approval.js');
const SPEC = '### S1: The change\n\n```scope\nsrc/**\n```\n';
const ID = '0001-csv';

// Stands in for Claude Code, so a test can say which sessions exist and see what
// the factory asked for.
const FAKE_CLAUDE = `#!/bin/sh
{ printf '%s|' "$PWD"; printf '%s ' "$@"; env | grep -c '^CLAUDECODE=' ; } >> "$FAKE_DIR/calls"
case "$1" in
  agents) cat "$FAKE_DIR/sessions" 2>/dev/null || echo '[]' ;;
  --bg) [ -f "$FAKE_DIR/refuse" ] && { echo 'Workspace not trusted' >&2; exit 1; }
        [ -f "$FAKE_DIR/service" ] && sleep 5 &
        echo 'backgrounded · abc12345 · name' ;;
esac
exit 0
`;

function tempDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeClaude(t) {
  const dir = tempDir(t, 'sdlc-claude-');
  fs.writeFileSync(path.join(dir, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  return dir;
}

function context(t) {
  const fake = fakeClaude(t);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${fake}:${process.env.PATH}`,
    FAKE_DIR: fake,
    CLAUDECODE: '1',
  };
  delete env.CLAUDE_CODE_SESSION_ATTENDED;
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
    calls: () => (fs.existsSync(path.join(fake, 'calls')) ? fs.readFileSync(path.join(fake, 'calls'), 'utf8') : ''),
    sessions: (list) => fs.writeFileSync(path.join(fake, 'sessions'), JSON.stringify(list)),
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

// A draft on the default branch with both documents approved, ready to launch.
function approvedDraft(c, slug = 'csv', id = ID) {
  const { root } = c;
  assert.equal(c.sdlc(root, 'new', slug).status, 0);
  fs.writeFileSync(itemFile(root, 'intent.md', id), 'the intent');
  c.human(root, 'approve', slug);
  c.sdlc(root, 'advance', slug);
  fs.writeFileSync(itemFile(root, 'spec.md', id), SPEC);
  c.human(root, 'approve', slug);
}

function launched(c, slug = 'csv', id = ID) {
  approvedDraft(c, slug, id);
  const result = c.sdlc(c.root, 'launch', slug);
  assert.equal(result.status, 0, result.stderr);
  return path.join(c.root, '.claude', 'worktrees', slug);
}

// `sdlc advance` commits the item's records itself, so there may be nothing left.
function commitAll(c, cwd) {
  c.git(cwd, 'add', '-A');
  c.git(cwd, 'commit', '-q', '--allow-empty', '-m', 'work');
}

function advance(c, cwd) {
  const result = c.sdlc(cwd, 'advance');
  assert.equal(result.status, 0, result.stderr);
}

// A launched change taken right to the end, with every step really done.
function finished(c, slug = 'csv', id = ID) {
  const dir = launched(c, slug, id);
  touch(dir, `src/${slug}.py`);
  touch(dir, itemFile('', 'evidence/reviews/S1.md', id), 'Verdict: pass\n');
  advance(c, dir);
  commitAll(c, dir);
  assert.equal(c.sdlc(dir, 'verify').status, 0);
  advance(c, dir);
  touch(dir, itemFile('', 'evidence/review.md', id), 'Verdict: pass\n');
  advance(c, dir);
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

test('a draft on the default branch stays uncommitted and leaves main clean of commits', (t) => {
  const c = repo(t);
  const before = c.gitOut(c.root, 'rev-parse', 'HEAD');
  approvedDraft(c);
  assert.equal(c.gitOut(c.root, 'rev-parse', 'HEAD'), before);
  assert.ok(fs.existsSync(itemFile(c.root, 'spec.md')));
});

test('an approved draft waits to be launched, and advancing can\'t skip that', (t) => {
  const c = repo(t);
  approvedDraft(c);
  const { next } = JSON.parse(c.sdlc(c.root, 'status', 'csv', '--json').stdout);
  assert.equal(next.action, 'launch');
  const refused = c.sdlc(c.root, 'advance', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /\/sdlc:launch/);
  assert.equal(state(c.root).stage, 'spec');
});

test('launching needs both approvals', (t) => {
  const c = repo(t);
  c.sdlc(c.root, 'new', 'csv');
  fs.writeFileSync(itemFile(c.root, 'intent.md'), 'the intent');
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 1);

  c.human(c.root, 'approve', 'csv');
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 1);

  c.sdlc(c.root, 'advance', 'csv');
  fs.writeFileSync(itemFile(c.root, 'spec.md'), SPEC);
  const refused = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /approve/);
  assert.equal(fs.existsSync(path.join(c.root, '.claude', 'worktrees', 'csv')), false);
  assert.doesNotMatch(c.calls(), /--bg/);
});

test('editing an approved spec stops it being launched', (t) => {
  const c = repo(t);
  approvedDraft(c);
  fs.appendFileSync(itemFile(c.root, 'spec.md'), 'one more thing\n');
  const refused = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /changed after approval/);
});

test('launching moves the draft to a committed worktree and starts a session there', (t) => {
  const c = repo(t);
  const dir = launched(c);

  assert.equal(fs.existsSync(itemFile(c.root, 'state.json')), false);
  assert.equal(c.gitOut(dir, 'branch', '--show-current'), 'worktree-csv');
  assert.equal(c.gitOut(dir, 'status', '--porcelain'), '');
  assert.match(c.gitOut(dir, 'ls-files', '.sdlc/work'), /approvals\/spec\.json/);
  assert.equal(c.gitOut(c.root, 'status', '--porcelain'), '');

  const item = state(dir);
  assert.equal(item.stage, 'build');
  assert.equal(item.branch, 'worktree-csv');
  assert.equal(item.base, c.gitOut(c.root, 'rev-parse', 'main'));
  const { items } = JSON.parse(c.sdlc(dir, 'status', '--json').stdout);
  assert.equal(items[0].next.action, 'advance');

  const call = c.calls().split('\n').find((line) => line.includes('--bg'));
  assert.equal(call.split('|')[0], dir);
  assert.match(call, /--bg --settings .*AGENT_TEAMS.* --model sonnet -n sdlc-csv \/sdlc:next/);
  assert.match(call, /\s0$/, 'the session must not look like a child of this one');
});

test('a project can choose the model its builds run on', (t) => {
  const c = repo(t);
  const file = path.join(c.root, '.sdlc', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...config, build_model: 'opus' }));
  c.git(c.root, 'commit', '-q', '-am', 'builds on opus');
  launched(c);
  assert.match(c.calls(), /--bg .*--model opus -n sdlc-csv/);
});

test('a worktree that can\'t commit leaves the draft where it was', (t) => {
  const c = repo(t);
  approvedDraft(c);
  touch(c.root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(c.root, '.git/hooks/pre-commit'), 0o755);
  const refused = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /stays here/);
  assert.ok(fs.existsSync(itemFile(c.root, 'spec.md')));
  assert.equal(fs.existsSync(path.join(c.root, '.claude', 'worktrees', 'csv')), false);
  assert.equal(c.gitOut(c.root, 'branch', '--list', 'worktree-csv'), '');
  assert.equal(state(c.root).stage, 'spec');
});

test('a draft committed on the default branch is refused rather than split in two', (t) => {
  const c = repo(t);
  approvedDraft(c);
  commitAll(c, c.root);
  const refused = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /committed on main/);
});

test('a session that won\'t start says why, and launching again carries on', (t) => {
  const c = repo(t);
  approvedDraft(c);
  touch(c.fake, 'refuse');
  const failed = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Workspace not trusted/);

  fs.rmSync(path.join(c.fake, 'refuse'));
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 0);
  assert.equal(c.calls().match(/--bg/g).length, 2);
});

test('launching doesn\'t wait on a service that outlives the session start', (t) => {
  const c = repo(t);
  approvedDraft(c);
  touch(c.fake, 'service');
  const started = Date.now();
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 0);
  assert.ok(Date.now() - started < 4000);
});

test('launching again refuses a build that\'s running, and restarts one that\'s blocked or stopped', (t) => {
  const c = repo(t);
  const dir = launched(c);
  const session = { kind: 'background', id: 'abc', cwd: dir, startedAt: 1 };

  c.sessions([{ ...session, status: 'busy', state: 'working' }]);
  assert.match(c.sdlc(c.root, 'launch', 'csv').stderr, /still running/);

  // Blocked is how a session looks once it has ended its turn with a message, too.
  c.sessions([{ ...session, status: 'idle', state: 'blocked' }]);
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 0);
  assert.equal(c.calls().match(/stop abc/g).length, 1);
  assert.equal(c.calls().match(/--bg/g).length, 2);

  c.sessions([{ ...session, status: 'idle', state: 'working' }]);
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 0);
  assert.equal(c.calls().match(/stop abc/g).length, 2);
  assert.equal(c.calls().match(/--bg/g).length, 3);
});

test('launching waits for Claude\'s settings to be committed, or the build would start without the plugin', (t) => {
  const c = repo(t);
  approvedDraft(c);
  const settings = path.join(c.root, '.claude', 'settings.json');
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('}', ', "enabledPlugins": {}\n}'));
  const refused = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /commit \.claude\/settings\.json first/);
  assert.ok(fs.existsSync(itemFile(c.root, 'spec.md')), 'the draft stays here');
  assert.doesNotMatch(c.calls(), /--bg/);

  c.git(c.root, 'commit', '-q', '-m', 'settings', '--', '.claude/settings.json');
  assert.equal(c.sdlc(c.root, 'launch', 'csv').status, 0);
});

test('launching can\'t get past a gate that reopened', (t) => {
  const c = repo(t);
  const dir = launched(c);
  fs.appendFileSync(itemFile(dir, 'spec.md'), 'an amendment\n');
  const refused = c.sdlc(c.root, 'launch', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /approve/);
});

test('changes in flight never share a number', (t) => {
  const c = repo(t);
  launched(c);
  const result = c.sdlc(c.root, 'new', 'other');
  assert.match(result.stdout, /^0002-other/);
});

test('a change can be named by its slug', (t) => {
  const c = repo(t);
  approvedDraft(c);
  assert.equal(JSON.parse(c.sdlc(c.root, 'status', 'csv', '--json').stdout).items[0].id, ID);
});

test('status on the main session shows each build and its session', (t) => {
  const c = repo(t);
  const dir = launched(c);
  c.sessions([{ kind: 'background', id: 'abc', cwd: dir, startedAt: 1, status: 'idle', state: 'blocked' }]);
  assert.match(c.sdlc(c.root, 'status').stdout, /0001-csv .*session waiting on you/);
  c.sessions([]);
  assert.match(c.sdlc(c.root, 'status').stdout, /session stopped/);
});

test('sync fixes the update that used to trip the scope check', (t) => {
  const c = repo(t);
  const dir = launched(c);
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
  const dir = launched(c);
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
  assert.doesNotMatch(result.stdout, /started again/, 'the session asking is the build');
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
  const dir = launched(c);
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
  const dir = launched(c);
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

test('sync refuses uncommitted work, a draft, and a change that already merged', (t) => {
  const c = repo(t);
  const dir = launched(c);
  touch(dir, 'src/csv.py');
  mainMoves(c, 'docs/x.md');
  assert.match(c.sdlc(dir, 'sync').stderr, /uncommitted/);

  commitAll(c, dir);
  c.git(c.root, 'merge', '-q', '--no-edit', 'worktree-csv');
  assert.match(c.sdlc(dir, 'sync').stderr, /already merged/);

  c.sdlc(c.root, 'new', 'draft');
  assert.match(c.sdlc(c.root, 'sync', 'draft').stderr, /still a draft/);
  assert.match(c.sdlc(c.root, 'sync').stderr, /name the change/);
});

test('syncing from the main session leaves a running build alone', (t) => {
  const c = repo(t);
  const dir = launched(c);
  mainMoves(c, 'docs/x.md');
  c.sessions([{ kind: 'background', id: 'abc', cwd: dir, startedAt: 1, status: 'busy', state: 'working' }]);
  const refused = c.sdlc(c.root, 'sync', 'csv');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /still running/);
  assert.equal(fs.existsSync(path.join(dir, 'docs/x.md')), false);
});

test('syncing from the main session brings in main past a blocked build, then restarts it', (t) => {
  const c = repo(t);
  const dir = launched(c);
  mainMoves(c, 'docs/x.md');
  c.sessions([{ kind: 'background', id: 'abc', cwd: dir, startedAt: 1, status: 'idle', state: 'blocked' }]);
  const result = c.sdlc(c.root, 'sync', 'csv');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /now includes main\. Its build has started again/);
  assert.equal(fs.existsSync(path.join(dir, 'docs/x.md')), true);
  assert.match(c.calls(), /stop abc/);
  assert.equal(c.calls().match(/--bg/g).length, 2);
});

test('syncing from the main session restarts a build that has work left', (t) => {
  const c = repo(t);
  const dir = finished(c);
  fs.writeFileSync(path.join(dir, 'src/shared.py'), 'mine\n');
  mainMoves(c, 'src/shared.py', 'theirs\n');
  commitAll(c, dir);
  c.sessions([{ kind: 'background', id: 'abc', cwd: dir, startedAt: 1, status: 'idle', state: 'done' }]);

  assert.equal(c.sdlc(c.root, 'sync', 'csv').status, 1);
  assert.equal(c.calls().match(/--bg/g).length, 2);
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
  const open = launched(c, 'other', '0002-other');
  c.sessions([{ kind: 'background', id: 'abc', cwd: merged, startedAt: 1, status: 'idle', state: 'done' }]);

  assert.match(c.sdlc(c.root, 'cleanup', 'csv').stderr, /isn't merged yet/);
  assert.match(c.sdlc(c.root, 'cleanup').stdout, /No merged changes/);
  assert.ok(fs.existsSync(merged));

  c.git(c.root, 'merge', '-q', '--no-edit', 'worktree-csv');
  assert.match(c.sdlc(c.root, 'cleanup').stdout, /Removed 0001-csv/);
  assert.equal(fs.existsSync(merged), false);
  assert.equal(c.gitOut(c.root, 'branch', '--list', 'worktree-csv'), '');
  assert.ok(fs.existsSync(open));
  assert.match(c.calls(), /stop abc/);
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

test('an approval restarts the background build that was waiting on it', (t) => {
  const c = repo(t);
  const dir = launched(c);
  fs.appendFileSync(itemFile(dir, 'spec.md'), 'an amendment\n');
  c.sessions([{ kind: 'background', id: 'abc', cwd: dir, startedAt: 1, status: 'idle', state: 'done' }]);

  const { additionalContext } = c.human(c.root, 'approve', 'csv').hookSpecificOutput;
  assert.match(additionalContext, /Approval recorded/);
  assert.match(additionalContext, /running again/);
  assert.match(c.calls(), /stop abc/);
  assert.equal(c.calls().match(/--bg/g).length, 2);
});

test('an approval leaves a worktree session a person is running alone', (t) => {
  const c = repo(t);
  const dir = launched(c);
  fs.appendFileSync(itemFile(dir, 'spec.md'), 'an amendment\n');
  c.sessions([]);
  const { additionalContext } = c.human(c.root, 'approve', 'csv').hookSpecificOutput;
  assert.doesNotMatch(additionalContext, /running again/);
  assert.equal(c.calls().match(/--bg/g).length, 1);
});

test('abandoning a change stops its build', (t) => {
  const c = repo(t);
  const dir = launched(c);
  c.sessions([{ kind: 'background', id: 'abc', cwd: dir, startedAt: 1, status: 'busy', state: 'working' }]);
  c.human(c.root, 'abandon', 'csv no longer needed');
  assert.match(c.calls(), /stop abc/);
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

test('a main session hears when a build needs an approval', async (t) => {
  const c = repo(t);
  const dir = launched(c);
  fs.appendFileSync(itemFile(dir, 'spec.md'), 'an amendment\n');
  const result = await outcome(watch(c, c.root));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /0001-csv needs you/);
});

test('a main session hears when a build is stuck or has stopped', async (t) => {
  const c = repo(t);
  const dir = launched(c);
  const session = { kind: 'background', id: 'abc', cwd: dir, startedAt: 1 };

  // The shape `claude agents --json` gives a session at a prompt: no detail on what it's asking.
  c.sessions([{ ...session, status: 'idle', state: 'blocked' }]);
  const stuck = (await outcome(watch(c, c.root))).stderr;
  assert.match(stuck, /0001-csv's build is waiting for a reply\. .*claude attach sdlc-csv.*\/sdlc:launch csv/);
  assert.doesNotMatch(stuck, /undefined/);

  c.sessions([]);
  assert.match((await outcome(watch(c, c.root))).stderr, /stopped at build/);
});

test('a main session hears when a build finishes, once the session is done with it', async (t) => {
  const c = repo(t);
  const dir = finished(c);
  const session = { kind: 'background', id: 'abc', cwd: dir, startedAt: 1 };
  c.sessions([{ ...session, status: 'busy', state: 'working' }]);
  assert.equal((await outcome(watch(c, c.root), 400)).code, null, 'still opening its pull request');

  c.sessions([{ ...session, status: 'idle', state: 'done' }]);
  assert.match((await outcome(watch(c, c.root))).stderr, /ready to merge/);
});

test('a main session isn\'t told the same thing twice, or woken by a healthy build', async (t) => {
  const c = repo(t);
  const dir = launched(c);
  const session = { kind: 'background', id: 'abc', cwd: dir, startedAt: 1 };
  c.sessions([{ ...session, status: 'busy', state: 'working' }]);
  assert.equal((await outcome(watch(c, c.root), 400)).code, null);

  c.sessions([{ ...session, status: 'idle', state: 'blocked' }]);
  assert.equal((await outcome(watch(c, c.root))).code, 2);
  assert.equal((await outcome(watch(c, c.root), 400)).code, null);

  c.sessions([{ ...session, status: 'busy', state: 'working' }]);
  await outcome(watch(c, c.root), 1000);
  c.sessions([{ ...session, status: 'idle', state: 'blocked' }]);
  assert.equal((await outcome(watch(c, c.root))).code, 2, 'stuck again is news again');
});

test('a main session carries on when any of its drafts is approved', async (t) => {
  const c = repo(t);
  c.sdlc(c.root, 'new', 'csv');
  c.sdlc(c.root, 'new', 'other');
  fs.writeFileSync(itemFile(c.root, 'intent.md'), 'the intent');
  fs.writeFileSync(itemFile(c.root, 'intent.md', '0002-other'), 'another');

  const watcher = watch(c, c.root);
  await new Promise((resolve) => setTimeout(resolve, 150));
  c.human(c.root, 'approve', 'other');
  const result = await outcome(watcher);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /approved 0002-other, so continue with \/sdlc:next 0002-other/);
});

test('a build\'s own session doesn\'t watch the others', async (t) => {
  const c = repo(t);
  const dir = launched(c);
  launched(c, 'other', '0002-other');
  const watcher = watch(c, dir);
  assert.equal((await outcome(watcher, 400)).code, 0);
});
