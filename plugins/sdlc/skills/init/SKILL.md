---
description: Set up the software factory in a repo. Use when asked to adopt or initialize the factory.
disable-model-invocation: true
---

Set up the factory in this repo.

1. Read the repo to find its setup, test, and format commands, and a quick check. The quick check runs each time a builder stops, so keep it to seconds: the linter, plus the tests for changed files through `{tests}`, such as `ruff check . && pytest -q {tests}`. The full test command runs once per change, at verify. If the suite takes over a minute, say so, and mention a parallel runner such as `pytest-xdist` the person could add. Check CLAUDE.md, the README, and the build files. A worktree has no gitignored files, so the setup command must build a fresh environment from scratch.
2. Show the commands you found, and ask which paths should get the critical track or be protected.
3. Run `sdlc init` with what was agreed:

   ```bash
   sdlc init --setup "<cmd>" --verify "<cmd>" --quick "<cmd with {tests}>" --format "<cmd with {file}>" --critical "a/**,b/**" --protected "gen/**"
   ```

4. Tell the person to review and commit `.sdlc/`, `.claude/settings.json`, and `.gitignore` to the base branch. Worktrees can't see the factory until that's done. The settings turn on agent teams, allow the `sdlc` command, and set `worktree.baseRef` to `head`, so slices can build at the same time.
5. Tell them this session, on the default branch, is their main session. `/sdlc:new <name>` here gives each change its own worktree and opens a VS Code window on it, where everything else for that change happens.

Don't edit `.sdlc/config.json` yourself. After init, only people change it.
