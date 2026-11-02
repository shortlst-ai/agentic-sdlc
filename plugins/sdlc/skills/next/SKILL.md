---
description: Run the next step of the factory for the current work item. Use to continue work, or after a gate is approved.
---

You are the team lead. You decide nothing about what comes next: `sdlc` does.

If the session start context asked for it, run `sdlc setup` first.

Run `sdlc status --json` and act on `next`. If you were given a name, or this conversation is about one item among several, run `sdlc status <name> --json` and pass the name to `sdlc advance` too:

| `next.action` | What to do |
| --- | --- |
| `new` | Ask what to work on, then use `/sdlc:new` |
| `choose` | Ask which item, using the ids listed |
| `produce` | Use the stage's skill, in the table below. If `next.stage` is `verify` but the item is already past it, the code changed after it was tested, so run `sdlc rework --reason "<what changed>"` |
| `approve` | Stop. Show what the person needs to decide, as below, and ask them to type `/sdlc:approve <name of this item>`, here or in any other session on this repo. This session carries on by itself once they have. You can't approve anything |
| `advance` | Run `sdlc advance`, except at `build` as noted below, then run this skill again |
| `launch` | Stop. Both documents are approved. Tell the person they can type `/sdlc:launch <name of this item>`. Don't advance it: it can't be built on the default branch |
| `none` | Run `sdlc sync`. If that puts the item back at build, run this skill again. Otherwise show the review's findings. With a remote, push and open a pull request naming the item, and never merge it yourself. With no remote, see below |

| Stage | Skill |
| --- | --- |
| `intent`, `spec` | `/sdlc:spec` |
| `verify` | `/sdlc:verify` |
| `review` | `/sdlc:review` |
| `merge` | `/sdlc:ship` |
| `release` | `/sdlc:release` |

At an approval, show the least the person needs:

- If `next.stale` is set, the file changed after it was approved. Run `sdlc diff <name of this item>` and show its output, rather than the whole file. If it says no copy was kept, show the file.
- Otherwise, for `spec.md`, show its `## What you're approving` section and the concerns it flags, and give the file's path for the rest. If it has a diagram, say so: it shows as code here, so the person opens the file in a Markdown viewer to see it. For anything else, show the file.
- Say how many words it is, from `next.words`, and pass on anything in `next.warnings`.

At `build`, `next.action` is always `advance`, because the stage has no file to wait for. Use `/sdlc:build` first, and advance only once the work is done.

With no remote, nothing has reached the base branch yet. Run `sdlc gates --base <item's base>` and show the result. If it passes, give the person the merge to run themselves, with the real path and branch:

```bash
git -C <main checkout> merge --no-ff <item's branch>
```

Tell them to merge before ending this session and removing the worktree, because removing it deletes the branch and its commits. You don't run the merge: it's theirs, as a pull request's would be.

`sdlc advance` commits the item's records itself, so a resumed session can pick up from Git. Commit the code and reports you write between steps. On the default branch, commit nothing: a draft stays uncommitted until `/sdlc:launch` moves it.

To bring in changes from the default branch, run `sdlc sync`, and never merge or rebase by hand. It keeps the item's records straight. If it reports conflicts, the item is back at build: resolve them, run the tests, and commit.

You don't need to read the factory's own source. `sdlc --help`, these skills, and what a command prints tell you everything, and reading outside this repo stops the session at a permission prompt.

Run each command on its own, without `;`, `&&`, or `echo` added. The project allows `sdlc` commands, and a chained command needs every part allowed, so chaining stops the work at a permission prompt.

If a command refuses, read why and fix the cause. Never work around a refusal. If you can't fix it, stop and tell the person.
