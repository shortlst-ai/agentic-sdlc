# Running changes in parallel

Keep one Claude Code session open on your default branch. That's your main session. Each change you start there gets its own worktree, branch, and window:

```text
/sdlc:new add-csv-export
```

This creates `.claude/worktrees/add-csv-export` on the branch `worktree-add-csv-export` and commits the change there, with what you asked for. In VS Code, a new window opens on it. Open Claude Code in that window and type `/sdlc:next`. Everything else for that change happens in that window: the intent, the spec, your approvals, the build, and the merge. Outside VS Code, open the folder yourself and start `claude` there.

Your main session stays free, so you can start another change straight away. It's also where you:

- see every change and what it's waiting on, with `/sdlc:status`
- approve anything, with `/sdlc:approve <name>`. The change's window carries on by itself
- remove merged changes, with `/sdlc:cleanup`, once you've closed their windows

Nothing is ever committed to your default branch until a change merges.

## Slices at the same time

Inside a change, the spec splits the work into slices. A slice that needs another one first says so in its heading, as in `### S2: Export the file (after S1)`. Slices that don't depend on each other build at the same time, each by its own builder in a worktree of its own. When they finish, the change's session merges each one back with `sdlc merge-slice` and removes its worktree, then has each slice reviewed as usual. `sdlc slices` shows which slices are ready.

That needs the `worktree.baseRef` setting at `head` in `.claude/settings.json`, which `/sdlc:init` sets. Without it, Claude Code starts a builder's worktree from your remote's default branch, where the spec doesn't exist yet, so slices build one at a time instead.

If two slices that ran at the same time conflict, the second isn't merged and nothing changes. The session builds that slice again on its own, once the others are in.

## When main moves

The first change to merge moves your default branch, so the others need to catch up. In each change's window:

```text
/sdlc:sync
```

Each change also syncs itself before it opens its pull request. What happens depends on what changed:

| What main brought in | What happens |
| --- | --- |
| Nothing that touches this change's files | The change is updated, and if it was already tested, your tests run again on the combined code |
| Those tests fail | It goes back to build |
| Changes to the same files | It goes back to build, then through verify and final review again |
| A conflict | It goes back to build, and the build resolves the conflict first |

Going back this way doesn't count against the rework limit, because the change did nothing wrong. Slice reviews still stand.

Don't merge or rebase by hand, because `sync` also keeps the change's records straight. If you already have, run `/sdlc:sync` to repair them.

Changes whose specs share no files run side by side with no trouble, and the `scope` blocks show you that. Two changes to the same files will work, but the second pays for another round of verify and review.

## Limits

- **Commit `.claude/settings.json` before starting a change.** A worktree starts from the last commit, so uncommitted settings, such as which plugins are on, wouldn't reach it. `/sdlc:new` refuses until they're committed.
- **The window opens only from inside VS Code,** using VS Code's `code` command. From a terminal, open the folder `/sdlc:new` prints.
- **Files Git ignores aren't in a new worktree.** The project's setup command, which `/sdlc:init` asks for, has to build the environment from scratch. The session in the new window runs it first.
- **`/sdlc:cleanup` can't recognize a squash merge,** because the branch's commits never reach main. Remove that worktree yourself. The same goes for an abandoned change.
