'use strict';

// Compares what a build really changed against what the spec allowed. It reads
// the diff rather than watching edits, because Bash can reach around any edit
// hook, and a diff can't be dodged by committing the work.

const { classify, isOpen, matchesAny, raiseTrack, reviewVerdict, trackRank } = require('./machine');
const workspace = require('./workspace');

const SCOPE_BLOCK = /^```scope[^\n]*\n([\s\S]*?)^```/gm;

// spec.md lists each slice under a heading such as `### S1: Parse the file`, with
// what it may touch in a fenced ```scope block, one glob a line. 
function parseScope(text) {
  const globs = [];
  for (const [, body] of text.matchAll(SCOPE_BLOCK)) {
    globs.push(...body.split('\n').map((line) => line.trim()).filter(Boolean));
  }
  return globs;
}

// A spec with no slice headings is one slice.
function parseSlices(text) {
  const ids = [...(text ?? '').matchAll(/^#{2,4}\s+(S\d+)\b/gm)].map((match) => match[1]);
  return ids.length > 0 ? [...new Set(ids)] : ['S1'];
}

// Test files are always in scope: the spec names the code, and the verifier adds
// tests it couldn't have listed.
function outOfScope(changed, scope, testGlobs) {
  return changed.filter((file) => !matchesAny(file, scope) && !matchesAny(file, testGlobs));
}

// Returns every reason this build can't leave `build`, with the item on the track
// its real files call for.
function reviewBuild(root, item, config) {
  const problems = [];
  const changed = workspace.changedFiles(root, item.base);
  const needed = classify(changed, config);
  const shouldRaise = isOpen(item) && trackRank(needed) > trackRank(item.track);
  const raised = shouldRaise ? raiseTrack(item, needed).item : item;

  const scope = parseScope(workspace.readArtifact(root, raised, 'spec.md') ?? '');
  if (scope.length === 0 && item.base) {
    problems.push('spec.md has no ```scope block saying which files this change may touch');
  } else {
    const outside = outOfScope(changed, scope, config.tests);
    if (outside.length > 0) problems.push(`outside the spec's scope: ${outside.join(', ')}`);
  }
  return { item: raised, problems };
}

// Each slice needs its own passing review before the build can finish, so a mistake
// in one slice is caught before the next builds on it.
function reviewSlices(root, item) {
  return parseSlices(workspace.readArtifact(root, item, 'spec.md')).flatMap((id) => {
    const report = workspace.readArtifact(root, item, `evidence/reviews/${id}.md`);
    if (report === null) return [`slice ${id} has no review`];
    return reviewVerdict(report) === 'pass' ? [] : [`slice ${id} didn't pass its review`];
  });
}

// Advice, never a refusal. Size alone can't say a change is wrong, only that a
// person should look. Tests outweighing code by this much is usually repetition.
const TEST_RATIO = 3;
const TEST_FLOOR = 200;

function sizeWarnings(root, item, config) {
  const { code, tests } = workspace.changedLines(root, item.base, config.tests);
  const limit = config.limits.pr_warn_lines ?? 600;
  const warnings = [];
  if (limit > 0 && code + tests > limit) {
    warnings.push(`${code + tests} changed lines, over the ${limit} a reviewer can read well. Consider splitting it.`);
  }
  if (tests > TEST_FLOOR && tests > code * TEST_RATIO) {
    warnings.push(`${tests} lines of tests for ${code} lines of code. Check they aren't repeating each other.`);
  }
  return warnings;
}

// Also advice. A person approves these, so they're held to what a person will
// read: the intent fits on a screen, and the spec opens with what's being approved.
// Code blocks don't count, because the scope blocks are the point.
const INTENT_WORDS = 250;
const SPEC_WORDS = 350;
const SPEC_WORDS_PER_SLICE = 150;
const SUMMARY_HEADING = "## What you're approving";
const SUMMARY_LINES = 12;

function proseWords(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '').split(/\s+/).filter(Boolean).length;
}

function sectionAfter(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.trim());
}

function documentWarnings(artifact, text) {
  if (text === null) return [];
  const words = proseWords(text);
  if (artifact === 'intent.md') {
    return words > INTENT_WORDS ? [`intent.md is ${words} words, over the ${INTENT_WORDS} that fit on one screen.`] : [];
  }
  if (artifact !== 'spec.md') return [];
  const warnings = [];
  const firstSection = text.split('\n').find((line) => /^##\s/.test(line));
  if (firstSection?.trim() !== SUMMARY_HEADING) {
    warnings.push(`spec.md doesn't open with "${SUMMARY_HEADING}", so a person has to read all of it.`);
  } else if (sectionAfter(text, SUMMARY_HEADING).length > SUMMARY_LINES) {
    warnings.push(`"${SUMMARY_HEADING}" runs past ${SUMMARY_LINES} lines.`);
  }
  const slices = parseSlices(text).length;
  const limit = SPEC_WORDS + SPEC_WORDS_PER_SLICE * (slices - 1);
  if (words > limit) {
    const what = slices === 1 ? 'one slice' : `${slices} slices`;
    warnings.push(`spec.md is ${words} words, over the ${limit} for ${what}. Move working-out to notes.md.`);
  }
  return warnings;
}

module.exports = {
  documentWarnings,
  outOfScope,
  parseScope,
  parseSlices,
  proseWords,
  reviewBuild,
  reviewSlices,
  sizeWarnings,
};
