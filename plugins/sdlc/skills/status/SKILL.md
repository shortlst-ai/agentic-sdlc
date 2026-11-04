---
description: Show the factory state of the current repo. Use when asked what stage work is in or whether a repo uses the factory.
allowed-tools: Bash(sdlc status *), Bash(sdlc status)
---

Run `sdlc status` and report its output as written. Don't add your own view of what should happen next.

Each change in a worktree is worked on in that worktree's own window, which `sdlc status` names. If the person asks what one is doing, read its state there, and tell them its window has the session.
