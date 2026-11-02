---
description: Set up the software factory in a repo. Use when asked to adopt or initialize the factory.
disable-model-invocation: true
---

Set up the factory in this repo.

1. Read the repo to find its setup, test, and format commands. Check CLAUDE.md, the README, and the build files. A worktree has no gitignored files, so the setup command must build a fresh environment from scratch.
2. Show the commands you found, and ask which paths should get the critical track or be protected.
3. Run `sdlc init` with what was agreed:

   ```bash
   sdlc init --setup "<cmd>" --verify "<cmd>" --format "<cmd with {file}>" --critical "a/**,b/**" --protected "gen/**"
   ```

4. Tell the person to review and commit `.sdlc/`, `.claude/settings.json`, and `.gitignore` to the base branch. Worktrees can't see the factory until that's done.
5. Tell them this session, on the default branch, is where they start and approve changes, beginning with `/sdlc:new <name>`. Each build then runs in the background in its own worktree after `/sdlc:launch`.

Don't edit `.sdlc/config.json` yourself. After init, only people change it.
