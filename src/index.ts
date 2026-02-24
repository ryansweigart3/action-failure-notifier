import * as core from '@actions/core'
import * as github from '@actions/github'
import { ActionInputs, FailureContext } from './types'
import {
  findCurrentJob,
  fetchJobLogTail,
  ensureLabelExists,
  findExistingIssue,
  createIssue,
  addCommentToIssue,
} from './github'
import { buildIssueTitle, buildWorkflowLabel, buildIssueBody, buildCommentBody } from './format'

export function parseInputs(): ActionInputs {
  const githubToken = core.getInput('github-token', { required: true })
  const issueRepo = core.getInput('issue-repo')
  const maxLogLinesRaw = core.getInput('max-log-lines')
  const labelsRaw = core.getInput('labels')

  const maxLogLines = parseInt(maxLogLinesRaw, 10)
  if (isNaN(maxLogLines) || maxLogLines < 0) {
    throw new Error(`Invalid max-log-lines value: "${maxLogLinesRaw}"`)
  }

  const labels = labelsRaw
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return { githubToken, issueRepo, maxLogLines, labels }
}

export function buildFailureContext(): FailureContext {
  const { repo, runId, ref, sha, actor, eventName, workflow } = github.context
  const jobName = process.env.GITHUB_JOB ?? github.context.job ?? 'unknown'
  const runNumber = github.context.runNumber
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
  const runUrl = `${serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${runId}`

  return {
    owner: repo.owner,
    repo: repo.repo,
    workflow,
    jobName,
    runId,
    runNumber,
    runUrl,
    sha,
    ref,
    actor,
    eventName,
  }
}

async function run(): Promise<void> {
  try {
    const inputs = parseInputs()
    const ctx = buildFailureContext()
    const octokit = github.getOctokit(inputs.githubToken)

    // Resolve target repo for issue creation
    let issueOwner = ctx.owner
    let issueRepo = ctx.repo

    if (inputs.issueRepo) {
      const parts = inputs.issueRepo.split('/')
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid issue-repo format: "${inputs.issueRepo}". Expected "owner/repo".`)
      }
      issueOwner = parts[0]
      issueRepo = parts[1]
    }

    core.info(`Failure context: ${ctx.workflow} / ${ctx.jobName} (run #${ctx.runNumber})`)
    core.info(`Target issue repo: ${issueOwner}/${issueRepo}`)

    // Step 1: Find the current job to get its ID for log fetching
    const job = await findCurrentJob(octokit, ctx)
    core.info(job ? `Found job: ${job.name} (id: ${job.id})` : 'Could not identify current job')

    // Step 2: Fetch log tail (best-effort)
    let logTail = ''
    if (job) {
      logTail = await fetchJobLogTail(octokit, ctx, job.id, inputs.maxLogLines)
      core.info(`Fetched ${logTail.split('\n').length} log lines`)
    }

    // Step 3: Ensure all labels exist
    const workflowLabel = buildWorkflowLabel(ctx)
    const allLabels = [...new Set([...inputs.labels, workflowLabel])]

    for (const label of inputs.labels) {
      await ensureLabelExists(octokit, issueOwner, issueRepo, label, 'e11d48', 'CI failure')
    }
    await ensureLabelExists(
      octokit,
      issueOwner,
      issueRepo,
      workflowLabel,
      'f97316',
      `CI failures for ${ctx.workflow}/${ctx.jobName}`
    )

    // Step 4: Check for an existing open issue (deduplication)
    const ciFailureLabel = inputs.labels[0] ?? 'ci-failure'
    const existingIssue = await findExistingIssue(
      octokit,
      issueOwner,
      issueRepo,
      ciFailureLabel,
      workflowLabel
    )

    if (existingIssue) {
      // Step 5a: Add a comment to the existing issue
      core.info(`Found existing issue #${existingIssue.number} — adding comment`)
      const commentBody = buildCommentBody(ctx, logTail)
      await addCommentToIssue(octokit, issueOwner, issueRepo, existingIssue.number, commentBody)

      core.setOutput('issue-number', String(existingIssue.number))
      core.setOutput('issue-url', existingIssue.html_url)
      core.setOutput('action-taken', 'comment')
      core.info(`Commented on issue #${existingIssue.number}: ${existingIssue.html_url}`)
    } else {
      // Step 5b: Create a new issue
      core.info('No existing issue found — creating new issue')
      const title = buildIssueTitle(ctx)
      const body = buildIssueBody(ctx, logTail)
      const newIssue = await createIssue(octokit, issueOwner, issueRepo, title, body, allLabels)

      core.setOutput('issue-number', String(newIssue.number))
      core.setOutput('issue-url', newIssue.html_url)
      core.setOutput('action-taken', 'created')
      core.info(`Created issue #${newIssue.number}: ${newIssue.html_url}`)
    }
  } catch (err) {
    core.setFailed(`action-failure-notifier failed: ${err}`)
  }
}

run()
