---
description: Start a work item. Use when asked to start a feature, change, or fix through the factory.
argument-hint: "<slug> [files]"
---

Start a work item for: $ARGUMENTS

1. Run `git branch --show-current`. On the default branch this is a main session, and the item starts as a draft: it stays uncommitted here while the person approves its intent and spec, then `/sdlc:launch` moves it to its own worktree. Several drafts can be open at once.
2. If the session start context asked for it, run `sdlc setup`.
3. Run `sdlc new <slug>`. Every change takes the same path. If you know it touches a critical path, pass the files with `--files a,b`, so the extra sign-offs apply.
4. On any other branch, commit the new item. Never commit a draft to the default branch.
5. Use `/sdlc:next <slug>` straight away, in this same turn. Starting the item isn't a stopping point, and the person shouldn't have to prompt you. Pass on what they asked for, because the spec writer can't see this conversation.
