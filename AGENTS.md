# Repository agent guidance

## Collaboration roles

- Codex owns implementation, file edits, validation, deployment preparation, and final integration.
- Claude Code is the default read-only reviewer and error analyst.
- Follow [AI_WORKFLOW.md](./AI_WORKFLOW.md) for the shared workflow and severity policy.

## Local review ingestion

- At the start of each task, inspect `.ai/reviews/latest-claude-review.json` when it exists. The repository owner does not need to ask Codex to check the latest Claude review.
- Compare the report's generation time and base reference with the current Git state. Verify every finding against the current code, apply only unresolved confirmed findings, and rerun relevant tests.
- A missing, stale, malformed, or already-resolved report is not a reason to change working code. State that condition when it affects the task.

## External review boundary

After a material code change and its normal tests, the repository owner may run `npm run ai:review:external` from an approved local terminal. This sends the selected diff and readable repository context to Anthropic and therefore must never be launched automatically. It requires the repository owner's explicit approval each time external data disclosure occurs.

Successful reviews are written to timestamped files and the stable `.ai/reviews/latest-claude-review.json` alias. Codex automatically ingests that alias on the next task. If approval, Claude Code, or authentication is unavailable, report that limitation explicitly rather than silently treating the review as complete.

Do not let the reviewer modify the working tree. Do not run Codex and Claude Code as simultaneous writers in the same checkout.
