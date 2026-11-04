---
description: Start a work item. Use when asked to start a feature, change, or fix through the factory, or to start work on an issue.
argument-hint: "<slug> [files]"
---

Start a work item for: $ARGUMENTS

Run `git branch --show-current`.

**On the default branch,** this is the main session, and the change gets a worktree and window of its own:

1. Run `sdlc new <slug> --request "<what the person asked for>"`. Put in everything they said about it, and the issue's text if they named one, because the session in the new window can't see this conversation. If you know it touches a critical path, add `--files a,b`, so the extra sign-offs apply.
2. It creates the worktree and branch, commits the item there, and opens a VS Code window on it when it can. Report what it printed, and stop. Everything else for this change happens in that window, starting with `/sdlc:next` there. Don't write anything for it here.

**On any other branch,** this session works on the change itself:

1. If the session start context asked for it, run `sdlc setup`.
2. Run `sdlc new <slug>`, with `--files a,b` for a critical path as above, then commit the new item.
3. Use `/sdlc:next <slug>` straight away, in this same turn. Starting the item isn't a stopping point, and the person shouldn't have to prompt you. Pass on what they asked for, because the spec writer can't see this conversation.
