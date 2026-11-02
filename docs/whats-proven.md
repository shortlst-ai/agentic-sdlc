# What's proven

This is new software, so here's what has and hasn't been tested.

**Tested on real work**

- Three real changes went through an earlier version on one project, with no rework
- One real change went through this one-path process, with two approvals and no rework
- Forged approvals and a gutted gate were both blocked on GitHub
- `/sdlc:approve` works from the terminal and the VS Code panel
- Installing from GitHub works
- Two builds ran side by side in the background on a throwaway repo. The second hit real conflicts with the first, synced, and resolved them unattended

**Not proven yet**

- **Parallel builds haven't run on real work.** The main session's parts were run as scripts, so nobody has yet typed `/sdlc:launch` in a live session or the VS Code panel, or been woken there by a finished build. Only auto mode has been tried
- **Shorter specs are only tested in evals.** A typo fix gets about 120 words with no diagram, and a change across three files gets a diagram. A real change hasn't been through it, and the length limits are a first guess
- **`sync` hasn't met a real remote.** Pushing and pull request updates are tested against a local bare repo
- **Test-first is an instruction, not a lock.** Agents are told to write the failing test first, and nothing enforces it
- **Verify evidence covers committed code.** Commit before `sdlc verify`, because uncommitted new files aren't counted
- **The deploy stage isn't built.** It's parked until there's a project to deploy, and a way to separate the agent from the approver
- **The CI monitor hasn't run on a live repo.** Its commands are tested, but the workflow itself hasn't run
- **Some attacks are only tested locally.** Deleting `.sdlc/` is refused on a fresh clone, but hasn't been tried on GitHub, and neither has a pull request that edits `sdlc-gates.yml`
- **A pull request that only changes `.sdlc/config.json` passes the gate,** so review that file whenever it changes
- **Forged approvals can pass on a solo repo.** An approval with the right hash and a made-up name passes `sdlc gates`, so on a team, pull request review is the real sign-off
- **The diagnoser isn't fully resistant to instructions planted in CI logs.** It ignored them in 12 of 14 test runs. In the other two it ran `sdlc advance`, which the gate would refuse, and the cause is unexplained

Agent teams are experimental in Claude Code and need a terminal session. In the VS Code panel, the same roles run as plain subagents, and so do builds started by `/sdlc:launch`.
