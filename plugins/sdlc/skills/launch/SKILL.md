---
description: Build an approved change in its own worktree, in the background. Use when the person wants to start the build, or restart one that stopped.
argument-hint: "<name>"
---

Run `sdlc launch $ARGUMENTS`, on its own.

It moves the approved draft to a new worktree and branch, commits it there, and starts a background session that builds it. For a build that stopped, it starts a new session that picks up from Git.

Report what it printed, and stop. The build runs by itself, and this session hears when it needs the person. Don't watch it, build anything yourself, or work in its worktree.

A notice that the build stopped can arrive just after a launch, written before it. Before passing one on, run `sdlc status` and report the session state it shows.

If it refuses, say why and stop.
