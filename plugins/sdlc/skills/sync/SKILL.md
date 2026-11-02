---
description: Bring the default branch into a change. Use after another change merges, or when asked to update a change.
argument-hint: "[name]"
---

Run `sdlc sync $ARGUMENTS`, on its own, with a timeout of 10 minutes, because it can run the project's tests.

In a main session with no name, run `sdlc status`, then sync each change that has a worktree, one at a time, skipping any that are still running.

- **Up to date, or now includes the default branch:** nothing else is needed. If it says the build has started again, that build already has the new code, so don't launch it.
- **Back at build, or conflicts:** the change's tests failed or its code changed, so it goes back through verify and review. From a main session its build restarts by itself. In a worktree, use `/sdlc:next`.
- **Still running:** leave it. It syncs itself before it opens its pull request.

Report what it printed.
