import { FailureContext } from './types'

const MAX_LABEL_LENGTH = 50

/**
 * Builds the issue title: [CI Failure] {workflow} / {jobName}
 */
export function buildIssueTitle(ctx: FailureContext): string {
  return `[CI Failure] ${ctx.workflow} / ${ctx.jobName}`
}

/**
 * Builds a workflow-specific label for deduplication.
 * Format: ci-workflow:{workflow}/{job}, truncated to 50 chars.
 */
export function buildWorkflowLabel(ctx: FailureContext): string {
  const raw = `ci-workflow:${ctx.workflow}/${ctx.jobName}`
  // Replace spaces and special chars that are invalid in label names
  const sanitized = raw.replace(/[^\w:.\-/]/g, '-').replace(/-+/g, '-')
  return sanitized.slice(0, MAX_LABEL_LENGTH)
}

/**
 * Builds a branch-specific label.
 * Strips the refs/heads/ or refs/tags/ prefix, sanitizes, and prefixes with "branch:".
 * Format: branch:{name}, truncated to 50 chars.
 */
export function buildBranchLabel(ctx: FailureContext): string {
  const branchName = ctx.ref
    .replace(/^refs\/(heads|tags)\//, '')
    .replace(/[^\w.\-/]/g, '-')
    .replace(/-+/g, '-')
  const raw = `branch:${branchName}`
  return raw.slice(0, MAX_LABEL_LENGTH)
}

/**
 * Builds the full issue body with a Markdown table, log snippet, and run URL.
 */
export function buildIssueBody(ctx: FailureContext, logTail: string): string {
  const logSection = logTail
    ? `\n## Log Tail\n\n\`\`\`\n${logTail}\n\`\`\``
    : '\n## Log Tail\n\n_Logs not available._'

  return `## CI Failure Report

| Field | Value |
|---|---|
| **Workflow** | \`${ctx.workflow}\` |
| **Job** | \`${ctx.jobName}\` |
| **Branch/Ref** | \`${ctx.ref}\` |
| **Commit** | \`${ctx.sha.slice(0, 8)}\` |
| **Triggered by** | \`${ctx.actor}\` |
| **Event** | \`${ctx.eventName}\` |
| **Run #** | [${ctx.runNumber}](${ctx.runUrl}) |
${logSection}

---
*This issue was automatically created by [action-failure-notifier](https://github.com/marketplace/actions/action-failure-notifier). Re-running the workflow successfully will not close this issue automatically.*`
}

/**
 * Builds a shorter comment body for duplicate issues.
 */
export function buildCommentBody(ctx: FailureContext, logTail: string): string {
  const logSection = logTail
    ? `\n<details>\n<summary>Log tail</summary>\n\n\`\`\`\n${logTail}\n\`\`\`\n</details>`
    : ''

  return `## Failure recurred

| Field | Value |
|---|---|
| **Branch/Ref** | \`${ctx.ref}\` |
| **Commit** | \`${ctx.sha.slice(0, 8)}\` |
| **Triggered by** | \`${ctx.actor}\` |
| **Run #** | [${ctx.runNumber}](${ctx.runUrl}) |
${logSection}`
}
