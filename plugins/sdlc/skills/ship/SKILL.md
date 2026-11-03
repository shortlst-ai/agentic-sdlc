---
description: Ask a person to sign off a work item whose review didn't plainly pass, or a track that always needs it. Use at the merge stage when next.action is approve.
---

Show the person the review findings and the verify result.

Then ask them to type `/sdlc:approve <name of this item>`, in this session or any other on this repo, if they want it merged. Their sign-off is the merge: once they've typed it, the pull request opens and merges by itself when its checks pass, or with no remote, the branch merges into the default branch. They don't merge it again. On a track with a release sign-off still to come, the merge waits for that one.

This session picks up by itself once they have. If it doesn't, they can use `/sdlc:next`.
