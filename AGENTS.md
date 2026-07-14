# Repository agent guidance

## Collaboration roles

- Codex owns implementation, file edits, validation, deployment preparation, and final integration.
- Claude Code is the default read-only reviewer and error analyst.
- Follow [AI_WORKFLOW.md](./AI_WORKFLOW.md) for the shared workflow and severity policy.

## Required review step

After a material code change and its normal tests, run:

```powershell
npm run ai:review:external
```

Run the external review only when the repository owner has explicitly approved sending the selected diff and readable repository context to Anthropic. Review Claude's report, verify every material finding against the code, fix confirmed issues, and rerun relevant tests. If approval, Claude Code, or authentication is unavailable, report that limitation explicitly rather than skipping it silently.

Do not let the reviewer modify the working tree. Do not run Codex and Claude Code as simultaneous writers in the same checkout.
