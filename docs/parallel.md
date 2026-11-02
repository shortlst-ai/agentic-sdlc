# Running changes in parallel

Nothing extra is needed. Start another draft in your main session at any time, and launch each one when its spec is approved. Name the change in your commands when several are open.

The first change to merge moves your default branch, so the others need to catch up:

```text
/sdlc:sync add-csv-export
```

Each build also syncs itself before it opens its pull request. What happens depends on what changed:

| What main brought in | What happens |
| --- | --- |
| Nothing that touches this change's files | The change is updated, and if it was already tested, your tests run again on the combined code |
| Those tests fail | It goes back to build |
| Changes to the same files | It goes back to build, then through verify and final review again |
| A conflict | It goes back to build, and the build resolves the conflict first |

Going back this way doesn't count against the rework limit, because the change did nothing wrong. Slice reviews still stand. A build that's running is left alone.

Don't merge or rebase by hand, because `sync` also keeps the change's records straight. If you already have, run `/sdlc:sync` to repair them.

Specs that share no files can run side by side with no trouble, and the `scope` blocks show you that before you launch. Two changes to the same files will work, but the second pays for another round of verify and review.

Some limits to know about:

- **You hear about builds while the main session is open and idle.** If you closed it, `/sdlc:status` shows where each one got to.
- **Background sessions need a trusted folder.** If `/sdlc:launch` says the workspace isn't trusted, run `claude` once in that project, accept the prompt, and launch again. Your work is kept.
- **Builds use your default permission mode.** A build that stops on a permission prompt shows as blocked, and `claude attach` opens it.
- **`/sdlc:cleanup` can't recognize a squash merge,** because the branch's commits never reach main. Remove that worktree yourself. The same goes for an abandoned change.
