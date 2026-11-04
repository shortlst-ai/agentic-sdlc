---
description: Bring the default branch into a change. Use after another change merges, or when asked to update a change.
argument-hint: "[name]"
---

Run `sdlc sync $ARGUMENTS`, on its own, with a timeout of 10 minutes, because it can run the project's tests.

A change syncs only in its own window, because the session there owns its files. In the main session, tell the person to run `/sdlc:sync` in each change's window instead: `sdlc status` shows where they are.

- **Up to date, or now includes the default branch:** nothing else is needed.
- **Back at build, or conflicts:** the change's tests failed or its code changed, so it goes back through verify and review. Use `/sdlc:next`.

Report what it printed.
