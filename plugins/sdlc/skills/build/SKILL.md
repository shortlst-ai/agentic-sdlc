---
description: Build the current work item, slice by slice. Use at the build stage.
---

If `git status` shows an unfinished merge, `sdlc sync` left conflicts. Resolve them first, keeping what both sides meant, run the tests, and commit.

Run `sdlc slices --json`. It lists the slices in `spec.md`, which have passed their review, and which are `ready` to build now. A slice waits for the ones its heading says it comes after.

**If more than one slice is ready and `parallel` is true,** build the ready ones at the same time:

1. In one message, spawn one `sdlc:builder` for each, with `isolation: "worktree"`. Tell each its slice and the work item folder, and that it's in a worktree of its own, so it commits its work there with `Slice: S2` as the last line of each commit message and ends its report with its worktree's path.
2. When each stops, a hook has already checked its diff and run the project's quick check, and sends it back if they fail. If one gave up, tell the person.
3. Once they've all finished, run `sdlc merge-slice <its worktree path>` for each, one at a time. If one conflicts, nothing changes: build that slice again here on its own, as below, after the others.
4. Review each merged slice as in steps 4 to 6 below.

**Otherwise,** build the first ready slice here:

1. Spawn one `sdlc:builder`, telling it the slice and the work item folder. Use `/sdlc:team` for how.
2. When it stops, a hook has already checked its diff and run the project's quick check, and sends it back if they fail. If it gave up, tell the person.
3. Commit the work, with `Slice: S1` as the last line of each commit message.
4. Spawn a `sdlc:reviewer` for this slice only, giving it the work item folder and the slice's commits. It has seen none of the building, which is the point.
5. Save its report as written to `evidence/reviews/S1.md` in the work item folder, and commit it.
6. If the verdict isn't `pass`, send the findings to a builder for that slice and review again, up to two rounds. Then stop and tell the person.

Then run `sdlc slices --json` again, and carry on until every slice has passed. Don't start a slice before the ones it comes after have passed, so a mistake isn't built on.

If something turns up that the spec doesn't cover:

- **New work** that isn't needed for this change: open an issue for it with `gh issue create`, if there's a remote, and carry on. Otherwise tell the person. Don't add it here.
- **A hole in the spec** that this change can't be finished without: update `spec.md`, commit it, and stop. Editing it reopens the spec gate, so ask the person to type `/sdlc:approve <name of this item>`.

When every slice has passed, run `sdlc check`, then `sdlc advance`, then use `/sdlc:next`. If `sdlc check` warns that the change is large, tell the person.
