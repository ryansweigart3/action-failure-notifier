import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import { ExistingIssue, FailureContext, WorkflowJob } from './types'

type Octokit = ReturnType<typeof getOctokit>

/**
 * Finds the currently running job within the workflow run.
 * Matches by job name from the GITHUB_JOB env var.
 */
export async function findCurrentJob(
  octokit: Octokit,
  ctx: FailureContext
): Promise<WorkflowJob | null> {
  try {
    const { data } = await octokit.rest.actions.listJobsForWorkflowRun({
      owner: ctx.owner,
      repo: ctx.repo,
      run_id: ctx.runId,
      filter: 'latest',
      per_page: 100,
    })

    const job =
      data.jobs.find((j: { name: string }) => j.name === ctx.jobName) ?? data.jobs[0] ?? null
    if (!job) return null

    return {
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion ?? null,
      html_url: job.html_url ?? '',
    }
  } catch (err) {
    core.warning(`Could not find current job: ${err}`)
    return null
  }
}

/**
 * Fetches the tail of the job log.
 * Uses octokit.request() directly instead of the typed helper because
 * downloadJobLogsForWorkflowRun discards the 302 redirect body.
 */
export async function fetchJobLogTail(
  octokit: Octokit,
  ctx: FailureContext,
  jobId: number,
  maxLines: number
): Promise<string> {
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
      owner: ctx.owner,
      repo: ctx.repo,
      job_id: jobId,
      request: { redirect: 'follow' },
    })

    const text: string = typeof response.data === 'string' ? response.data : ''
    const lines = text.split('\n')
    return lines.slice(-maxLines).join('\n').trim()
  } catch (err) {
    core.warning(`Could not fetch job logs: ${err}`)
    return ''
  }
}

/**
 * Ensures a label exists in the target repo, creating it if necessary.
 * Swallows 422 (already exists) errors.
 */
export async function ensureLabelExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
  color = 'e11d48',
  description = ''
): Promise<void> {
  try {
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name,
      color,
      description,
    })
  } catch (err: unknown) {
    // 422 means label already exists — that's fine
    const status = (err as { status?: number }).status
    if (status !== 422) {
      core.warning(`Could not create label "${name}": ${err}`)
    }
  }
}

/**
 * Searches for an existing open issue with the given labels using the Search API.
 * The Search API provides AND semantics for multiple label filters.
 */
export async function findExistingIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  ciFailureLabel: string,
  workflowLabel: string
): Promise<ExistingIssue | null> {
  try {
    const q = `repo:${owner}/${repo} is:issue is:open label:"${ciFailureLabel}" label:"${workflowLabel}"`
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q,
      sort: 'updated',
      order: 'desc',
      per_page: 1,
    })

    if (data.total_count === 0 || data.items.length === 0) return null

    const item = data.items[0]
    return {
      number: item.number,
      html_url: item.html_url,
      title: item.title,
      state: item.state,
    }
  } catch (err) {
    core.warning(`Could not search for existing issues: ${err}`)
    return null
  }
}

/**
 * Creates a new GitHub issue.
 */
export async function createIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[]
): Promise<ExistingIssue> {
  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels,
  })

  return {
    number: data.number,
    html_url: data.html_url,
    title: data.title,
    state: data.state,
  }
}

/**
 * Adds a comment to an existing issue.
 */
export async function addCommentToIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<string> {
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  })

  return data.html_url
}
