# What's proven

This is new software, so here's what has and hasn't been tested.

**Tested on real work**

- Three real changes went through an earlier version on one project, with no rework
- One real change went through this one-path process, with two approvals and no rework
- Forged approvals and a gutted gate were both blocked on GitHub
- `/sdlc:approve` works from the terminal and the VS Code panel
- Installing from GitHub works
- Two builds ran side by side on a throwaway repo. The second hit real conflicts with the first, synced, and resolved them unattended
- A subagent with `isolation: worktree` starts from the change's branch once `worktree.baseRef` is `head`, and the factory's hooks see its worktree, so a slice builder there gets the same checks

**Not proven yet**

- **A change in its own window hasn't run on real work.** Starting a change from the main session, its window opening, and slices merging back are tested, but nobody has yet taken a real change through it
- **Slices built at the same time haven't run on real work.** An eval checks the lead spawns them together, but merging them back and reviewing them has only been tested with scripted builders
- **The speedups haven't been timed on a real change.** The full suite now runs once per change, small fixes default to one slice, and builds run on Sonnet. Each part is tested, and the one-slice rule is checked by an eval, but the time saved is an estimate
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

Agent teams are experimental in Claude Code and need a terminal session. In the VS Code panel, the same roles run as plain subagents, and slices built at the same time are always plain subagents, because giving a builder a worktree of its own makes it a plain subagent.
