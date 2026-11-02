---
description: Show the factory state of the current repo. Use when asked what stage work is in or whether a repo uses the factory.
allowed-tools: Bash(sdlc status *), Bash(sdlc status)
---

Run `sdlc status` and report its output as written. Don't add your own view of what should happen next.

If the person asks why a build is stuck or what it's doing, read its state in the worktree `sdlc status` names. If it's waiting on a permission prompt, only they can answer that, with `claude attach sdlc-<name>`.
