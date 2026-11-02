# Contributing

```bash
npm run check   # tests and plugin validation
npm run evals   # real model calls, about $1
```

- Design: [docs/proposal.md](docs/proposal.md)
- Notes from the first real runs: [docs/phase-1-notes.md](docs/phase-1-notes.md)
- Roadmap: [milestones](../../milestones)

Each change goes on its own branch and through a pull request, and `main` requires the `gates` check.

## Releasing

Installs only update when the version changes, so every release raises `version` in `plugins/sdlc/.claude-plugin/plugin.json`:

1. Raise the version in the release's pull request, and merge it.
2. From `plugins/sdlc` on the updated `main`, run `claude plugin tag --push`. It tags the release as `sdlc--v<version>`.

The directory listing follows release tags, not `main`.
