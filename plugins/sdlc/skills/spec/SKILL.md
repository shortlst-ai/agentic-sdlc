---
description: Write the intent or spec for the current work item. Use at the intent and spec stages.
---

At the `intent` stage, spawn a `sdlc:spec-writer`, giving it the work item folder and what the person asked for. If the folder has a `request.md`, that's what they asked for when the change started, in another session.

At the `spec` stage, spawn a `sdlc:researcher` to map the code the change touches. Then spawn a `sdlc:spec-writer`, giving it the work item folder, the approved `intent.md`, and the findings.

Use `/sdlc:team` for how to spawn them. Check the file exists, then run `sdlc status <name of this item> --json`. If `next.warnings` lists anything, send the warnings to the spec-writer once to fix, and pass on any that remain.

Commit the work item folder, then use `/sdlc:next`.
