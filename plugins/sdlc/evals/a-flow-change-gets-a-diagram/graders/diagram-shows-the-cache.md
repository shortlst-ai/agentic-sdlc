---
type: llm
focus:
  source: file
  path: .sdlc/work/0001-feature/spec.md
---

PASS if the spec's Mermaid diagram shows a cache in the service, between the API and the store, and shows an update removing the customer from the cache.
FAIL if there is no diagram, or it leaves out the cache or the update.
