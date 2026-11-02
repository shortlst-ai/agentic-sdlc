#!/usr/bin/env node
'use strict';

// Stop hook, run in the background with asyncRewake. A session stopped at a gate
// has nothing to wake it, and the person may approve from another session. So this
// waits for the state to move, and exit 2 wakes the session to carry on. It only
// watches: approvals are recorded by the hook on the command a person types.
//
// In a main session it also looks after the builds running in worktrees, and wakes
// the session when one needs a person, so nobody has to go and check.

const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');

const machine = require('../lib/machine');
const parallel = require('../lib/parallel');
const workspace = require('../lib/workspace');

const POLL_MS = Number(process.env.SDLC_AWAIT_POLL_MS) || 5000;

// Asking Claude Code about sessions costs more than reading files, so it's rarer.
const POLLS_PER_BUILD_CHECK = 6;

function atGate(root, item) {
  return machine.nextAction(item, workspace.readFacts(root, item)).action === 'approve';
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claim(marker) {
  const holder = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;
  if (holder && isAlive(holder)) return false;
  fs.writeFileSync(marker, String(process.pid));
  return true;
}

function notifiedFile(root) {
  return workspace.git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'sdlc-notified']);
}

function readNotified(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// What's new since the person was last told. A session between two turns can look
// stopped, so a build has to need attention on two checks in a row. What's been
// said is kept on disk, so a later stop doesn't repeat it, and an item that's
// recovered is forgotten, so it can be reported again if it stops again.
function newsFrom(root, pending) {
  const sessions = parallel.backgroundSessions();
  const file = notifiedFile(root);
  const notified = readNotified(file);
  const found = workspace.launchedItems(root).map((entry) => [entry.item.id, parallel.attention(entry, sessions)]);
  const messages = Object.fromEntries(found.filter(([, message]) => message));
  const steady = Object.entries(messages).filter(([id, message]) => pending[id] === message);
  const news = steady.filter(([id, message]) => notified[id] !== message).map(([, message]) => message);
  const kept = Object.entries(messages).filter(([id, message]) => notified[id] === message || pending[id] === message);
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(kept)));
  for (const id of Object.keys(pending)) delete pending[id];
  Object.assign(pending, messages);
  return news;
}

async function wait(root, gates, watchBuilds) {
  const parent = process.ppid;
  const pending = {};
  // A session that ended leaves this process to its own devices, so leave too.
  for (let poll = 1; process.ppid === parent; poll += 1) {
    await sleep(POLL_MS);
    for (const id of [...gates]) {
      const item = workspace.loadItem(root, id);
      if (!machine.isOpen(item)) gates.delete(id);
      else if (!atGate(root, item)) {
        console.error(`A person approved ${id}, so continue with /sdlc:next ${id}.`);
        return 2;
      }
    }
    if (watchBuilds && poll % POLLS_PER_BUILD_CHECK === 0) {
      const news = newsFrom(root, pending);
      if (news.length > 0) {
        console.error(`${news.join('\n')}\nTell the person, and don't start anything yourself.`);
        return 2;
      }
    }
    if (gates.size === 0 && !watchBuilds) return 0;
  }
  return 0;
}

async function main() {
  // Nobody can approve in an unattended session, and waiting would keep `claude -p`
  // running until the hook's timeout.
  if (process.env.CLAUDE_CODE_SESSION_ATTENDED === '0') return 0;
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const root = workspace.findRoot(input.cwd);
  if (!root) return 0;
  const waiting = workspace
    .ownItems(root)
    .filter(machine.isOpen)
    .filter((item) => atGate(root, item))
    .map((item) => item.id);
  const isMain = !workspace.isLinkedWorktree(root);
  const watchBuilds = isMain && workspace.launchedItems(root).length > 0;
  if (!isMain && waiting.length !== 1) return 0;
  if (waiting.length === 0 && !watchBuilds) return 0;
  const marker = workspace.waitMarker(root, isMain ? 'main' : waiting[0]);
  if (marker === null || !claim(marker)) return 0;
  try {
    return await wait(root, new Set(waiting), watchBuilds);
  } finally {
    fs.rmSync(marker, { force: true });
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 0;
  },
);
