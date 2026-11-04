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

It finds your setup, test, and format commands, and asks which paths are critical or protected. It also proposes a quick check, which runs each time a builder stops, such as your linter plus the tests for changed files. Your full test command runs once per change, at verify. Then commit what it created, because worktrees can't see it until you do:

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

Start Claude on your default branch, in the VS Code panel or in a terminal with `claude`. This is your main session, and you can keep it for all your work. Then:

```text
/sdlc:new add-csv-export

Let people export the orders table as CSV.
```

This creates a worktree at `.claude/worktrees/add-csv-export` and a branch for the change, and commits the change there with what you asked for. Your default branch doesn't move. In VS Code, a new window opens on the worktree. From a terminal, open that folder yourself.

Open Claude Code in the new window and type:

```text
/sdlc:next
```

Everything else for this change happens in that window. It builds its own environment first, then writes `intent.md`: the problem, the outcome you want, and any open questions. Your main session is free, so you can start another change there.

## 5. Approve the intent

The session stops and shows you the intent. If it's the wrong idea, stop here, because nothing else has been spent yet. Otherwise:

```text
/sdlc:approve add-csv-export
```

Typing `/sdlc:approve` alone lists what's waiting, and `/sdlc:approve all` approves all of it. You can also approve from your main session, and the change's window carries on by itself.

## 6. Approve the spec

Agents research the code and write `spec.md`, including the slices:

````markdown
## S1: Add the export query

```scope
src/orders/query.py
```

## S2: Add the download button (after S1)

```scope
src/orders/views.py
```
````

Each `scope` block lists what that slice may touch. "(after S1)" means S2 needs S1 first. Slices without it build at the same time. Anything outside it gets refused later, so check these. If you'd change something, say so, and the session updates the spec. Then approve it the same way.

The spec opens with a short "What you're approving" section, and that's what the session shows you. On most changes you can decide from that alone, and the rest is there if you want it. Research the agents did goes in `notes.md`, which you don't approve. If a document runs long, `/sdlc:status` warns you, with its word count.

When a change affects how parts connect, a flow, or states, the spec includes a Mermaid diagram under "How it fits". The terminal shows it as code, so open `spec.md` in a Markdown viewer that draws Mermaid, or on GitHub.

An approval is tied to the exact text you approved. If the spec changes afterward, the gate reopens, and the session shows you only what changed.

## 7. Let it build

Once the spec is approved, the session builds the change. For each slice, a builder writes it test-first, and a fresh reviewer checks that slice alone. Slices that don't depend on each other build at the same time, each in a worktree of its own, and are merged back before their reviews. A slice that comes after another doesn't start until that one passes. Then your tests run, and a final review checks how the slices fit together.

If a step fails, it goes back and fixes it, up to a limit. If it hits that limit, it stops. If something turns up mid-build:

- **New work** that this change doesn't need becomes an issue, so the change stays small.
- **A hole in the spec** means the build amends the spec and stops, which reopens that gate for you.

You don't need to watch it. The window stops when it needs you, and `/sdlc:status` in your main session shows every change and what it's waiting on.

## 8. Merge and clean up

When the review passes, the build opens a pull request. Read it, check that `gates` is green, and merge it yourself. If your repo has no remote, it gives you a `git merge` command instead.

If the review wasn't a plain pass, or the change touches a critical path, you're asked to approve the merge instead. That approval is the merge: the build opens the pull request and merges it once its checks pass, or with no remote, merges the branch into your default branch. You don't merge it again.

Then close the change's window, and remove its worktree and branch from your main session:

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
