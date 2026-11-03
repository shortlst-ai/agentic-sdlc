'use strict';

// A person's sign-off on the last gate is what merges a change. Typing
// /sdlc:approve there is the decision, so asking them to merge as well only
// repeats it. A change whose review plainly passed has no such sign-off, and the
// person merges that one themselves, as before.

const { spawnSync } = require('node:child_process');

const { runGates } = require('./gates');
const machine = require('./machine');
const workspace = require('./workspace');

const { ARTIFACTS, DONE, FLOWS } = machine;
const { SdlcError, git } = workspace;

// Long enough for a project's CI, short enough for the lead's command to return.
const CHECKS_TIMEOUT_MS = 9 * 60 * 1000;

function gh(cwd, args, timeout) {
  return spawnSync('gh', args, { cwd, encoding: 'utf8', timeout });
}

function finishedItem(root, query) {
  if (query) return workspace.findItem(root, query);
  const done = workspace.ownItems(root).filter((item) => item.stage === DONE);
  if (done.length === 0) throw new SdlcError('no finished work item on this branch');
  return { root, item: done.at(-1) };
}

// The gates from merge onwards that needed a person, each signed off on the file as it is.
function signOffs(root, item) {
  const facts = workspace.readFacts(root, item);
  const flow = FLOWS[item.track];
  const gates = flow.slice(flow.findIndex(({ stage }) => stage === 'merge')).filter(({ gate }) => machine.needsPerson(gate, facts));
  return gates.map(({ stage }) => {
    const approval = facts.approvals[stage];
    if (!approval || approval.sha256 !== facts.artifacts[ARTIFACTS[stage]]) {
      throw new SdlcError(`${item.id}'s ${stage} sign-off is missing or out of date, so a person must type /sdlc:approve again`);
    }
    return stage;
  });
}

function mainCheckout(dir) {
  return (git(dir, ['worktree', 'list', '--porcelain']) ?? '').split('\n')[0].replace(/^worktree /, '');
}

// Waits for CI, because the gates check there is the one an agent can't get around.
function mergePullRequest(dir, item) {
  if (git(dir, ['push', '-q', '-u', 'origin', item.branch]) === null) throw new SdlcError(`can't push ${item.branch}`);
  const view = gh(dir, ['pr', 'view', item.branch, '--json', 'number,state']);
  if (view.error || view.status !== 0) throw new SdlcError(`${item.id} has no pull request yet, so open one first`);
  const { number, state } = JSON.parse(view.stdout);
  if (state === 'MERGED') return `Pull request #${number} for ${item.id} is already merged.`;
  if (state !== 'OPEN') throw new SdlcError(`pull request #${number} for ${item.id} is ${state.toLowerCase()}`);
  const checks = gh(dir, ['pr', 'checks', String(number), '--watch', '--interval', '10'], CHECKS_TIMEOUT_MS);
  const said = `${checks.stdout ?? ''}${checks.stderr ?? ''}`.trim();
  if (checks.error) throw new SdlcError(`pull request #${number}'s checks are still running, so run sdlc merge again once they finish`);
  if (checks.status !== 0 && !/no checks reported/.test(said)) {
    throw new SdlcError(`pull request #${number}'s checks didn't pass, so it stays open:\n${said}`);
  }
  const merged = gh(dir, ['pr', 'merge', String(number), '--merge']);
  if (merged.status !== 0) throw new SdlcError(`can't merge pull request #${number}: ${(merged.stderr ?? '').trim()}`);
  return `Merged pull request #${number} for ${item.id}.`;
}

// With no remote, the default branch lives in the main checkout.
function mergeLocally(dir, item, target) {
  const main = mainCheckout(dir);
  if (git(main, ['rev-parse', '--abbrev-ref', 'HEAD']) !== target) {
    throw new SdlcError(`${main} isn't on ${target}, so merge ${item.branch} there yourself`);
  }
  if (git(main, ['merge', '-q', '--no-ff', '-m', `Merge ${item.branch}: ${item.id}`, item.branch]) === null) {
    git(main, ['merge', '--abort']);
    throw new SdlcError(`can't merge ${item.branch} into ${target} in ${main}, so it's left as it was: check for uncommitted changes there`);
  }
  return `Merged ${item.branch} into ${target} in ${main}.`;
}

function merge(root, query) {
  const { root: dir, item } = finishedItem(root, query);
  if (item.stage !== DONE) throw new SdlcError(`${item.id} is at ${item.stage}, not finished`);
  if (signOffs(dir, item).length === 0) {
    throw new SdlcError(`${item.id}'s review passed, so nobody signed off a merge: a person merges it`);
  }
  const target = workspace.defaultBranch(dir);
  if (!target) throw new SdlcError("can't tell which branch is the default");
  if (git(dir, ['status', '--porcelain'])) throw new SdlcError(`${item.id} has uncommitted changes, so commit them first`);
  const { problems } = runGates(dir, target);
  if (problems.length > 0) throw new SdlcError(`the gates don't pass, so ${item.id} isn't merged:\n${problems.join('\n')}`);
  const remote = git(dir, ['remote', 'get-url', 'origin']);
  return remote ? mergePullRequest(dir, item) : mergeLocally(dir, item, target);
}

module.exports = { merge };
