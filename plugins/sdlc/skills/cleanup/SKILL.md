---
description: Remove the worktrees and branches of merged changes. Use from the main session after pull requests have merged.
argument-hint: "[name]"
---

Run `sdlc cleanup $ARGUMENTS`, on its own, and report what it printed.

With no name it removes every change that has merged. It leaves anything unmerged, and refuses to delete uncommitted work. If it says a change isn't merged, and the pull request was squashed, say so: only the person can delete that branch.
