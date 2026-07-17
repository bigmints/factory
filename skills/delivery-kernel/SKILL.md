---
name: Factory Pi Delivery Kernel
description: Deterministic delivery rules for Pi SDK builds running against local DGX models.
category: delivery
tags: [pi-sdk, dgx, worktree, pull-request, verification]
trigger: delivery|claim|worktree|pull request|pi sdk|dgx
enabled: true
---

## Instructions

Factory is the TPM. Pi SDK is the only coding executor, and its model must come from the configured local DGX OpenAI-compatible endpoint. Never route a build to a cloud model or silently fall back to another executor.

For every coding story:

1. Refuse to start when product files are already dirty in the base checkout.
2. Claim exactly one `factory/story-<id>` branch and create a dedicated worktree.
3. Run Pi SDK only inside that worktree. The base checkout is planning and supervision state, never the coding workspace.
4. Record the provider, model, endpoint host, branch, worktree, claim time, heartbeat, and lease on the story.
5. Treat DGX reachability, model availability, SDK stalls, capacity, and transport errors as infrastructure failures. Requeue them without declaring the story implementation defective.
6. Require deterministic validation and `productFilesChanged=true` before handoff.
7. Stage only the product files detected in the worktree. Never use `git add -A` for delivery.
8. Push only the claimed story branch and open or reuse one pull request.
9. Mark the story `review` after PR creation. Only a human merge may move it to `done` and archive it.
10. Start with one Pi worker. Parallel execution requires an explicit DGX capacity decision backed by measurements.
11. Reconcile expired leases before queue execution. Preserve owned worktrees and partial product changes when requeuing infrastructure failures.
12. Treat GitHub PR state as execution authority: open means review, closed without merge means requeue, and human-merged means done/archive.
13. Enforce runtime, tool-call, changed-file, and changed-line limits even when unattended execution is disabled.

Unattended mode stays disabled by default. Never merge, approve, close the PR, push the base branch, or delete a worktree containing unsubmitted changes.
