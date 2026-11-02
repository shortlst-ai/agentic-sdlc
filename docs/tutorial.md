# Tutorial: your first change

This walks through adding a CSV export to a project. You need Claude Code, Node 20 or later, and a Git repo.

## 1. Install the plugin

From your repo:

```bash
claude plugin marketplace add shortlst-ai/agentic-sdlc
claude plugin install sdlc@agentic-sdlc --scope project
```

`--scope project` turns the plugin on for this repo only.

## 2. Set up the factory

Run `claude`, then:

```text
/sdlc:init
```

It finds your setup, test, and format commands, and asks which paths are critical or protected. Then commit what it created, because worktrees can't see it until you do:

```bash
git add .sdlc .claude/settings.json .gitignore
git commit -m "Adopt the software factory"
```

## 3. Turn on the CI gate

The local checks stop mistakes. This one stops everything else, because it runs where an agent can't reach it.

```bash
mkdir -p .github/workflows
curl -o .github/workflows/sdlc-gates.yml \
  https://raw.githubusercontent.com/shortlst-ai/agentic-sdlc/main/plugins/sdlc/templates/sdlc-gates.yml
```

Then, in your repo's branch protection settings, make `gates` a required check on your default branch.

## 4. Start the change

Start Claude on your default branch, in a terminal with `claude` or in the VS Code panel. This is your main session, and you can keep it for all your work. Then:

```text
/sdlc:new add-csv-export

Let people export the orders table as CSV.
```

The session writes `intent.md`: the problem, the outcome you want, and any open questions. Until you launch it, the change is a draft: its files sit uncommitted in `.sdlc/`, and your default branch doesn't move.

## 5. Approve the intent

The session stops and shows you the intent. If it's the wrong idea, stop here, because nothing else has been spent yet. Otherwise:

```text
/sdlc:approve add-csv-export
```

Typing `/sdlc:approve` alone lists what's waiting, and `/sdlc:approve all` approves all of it.

## 6. Approve the spec

Agents research the code and write `spec.md`, including the slices:

````markdown
## S1: Add the export query

```scope
src/orders/query.py
```

## S2: Add the download button

```scope
src/orders/views.py
```
````

Each `scope` block lists what that slice may touch. Anything outside it gets refused later, so check these. If you'd change something, say so, and the session updates the spec. Then approve it the same way.

The spec opens with a short "What you're approving" section, and that's what the session shows you. On most changes you can decide from that alone, and the rest is there if you want it. Research the agents did goes in `notes.md`, which you don't approve. If a document runs long, `/sdlc:status` warns you, with its word count.

When a change affects how parts connect, a flow, or states, the spec includes a Mermaid diagram under "How it fits". The terminal shows it as code, so open `spec.md` in a Markdown viewer that draws Mermaid, or on GitHub.

An approval is tied to the exact text you approved. If the spec changes afterward, the gate reopens, and the session shows you only what changed.

## 7. Launch the build

```text
/sdlc:launch add-csv-export
```

This creates a worktree and a branch, moves the change into them, commits it, and starts a background session there. Your main session is free straight away, so you can start another change.

Background sessions only run in a folder you've trusted. If launch says the workspace isn't trusted, run `claude` once in your project, accept the prompt, and launch again. Your change is kept.

## 8. Let it run

The build builds its own environment. For each slice, a builder writes it test-first, and a fresh reviewer checks that slice alone. The next slice doesn't start until it passes. Then your tests run, and a final review checks how the slices fit together.

If a step fails, it goes back and fixes it, up to a limit. If it hits that limit, it stops. If something turns up mid-build:

- **New work** that this change doesn't need becomes an issue, so the change stays small.
- **A hole in the spec** means the build amends the spec and stops, which reopens that gate for you.

You don't need to watch it. While your main session is open and idle, it wakes up when a build needs you and says so: an approval is waiting, it stopped with work left, it's stuck on a permission prompt, or it's ready to merge. To check at any time:

```text
/sdlc:status
```

Approve in your main session as usual, and the build that was waiting starts again by itself. To restart one that stopped, run `/sdlc:launch` again.

## 9. Merge and clean up

When the review passes, the build opens a pull request. Read it, check that `gates` is green, and merge it yourself. If your repo has no remote, it gives you a `git merge` command instead.

Then remove the worktree and branch:

```text
/sdlc:cleanup
```

It only touches changes that have merged, and it won't delete uncommitted work. A squashed merge can't be told apart from an unmerged branch, so use a merge commit, or delete that branch yourself.

## A smaller change

A typo fix takes the same steps, and each one is short: a line of intent, a few lines of spec, and one slice. There's no shortcut, because small changes are where assumptions go unchecked. For a bug fix, the spec says which test should fail first.

## Next

- [Run several changes at once](parallel.md)
- [Turn on the CI monitor](ci.md#watching-ci)
- [What's proven and what isn't](whats-proven.md)
