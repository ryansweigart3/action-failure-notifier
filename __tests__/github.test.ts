import {
  findCurrentJob,
  fetchJobLogTail,
  ensureLabelExists,
  findExistingIssue,
  createIssue,
  addCommentToIssue,
} from '../src/github'
import { FailureContext } from '../src/types'

const baseCtx: FailureContext = {
  owner: 'acme-org',
  repo: 'my-app',
  workflow: 'CI Pipeline',
  jobName: 'build-and-test',
  runId: 123456,
  runNumber: 42,
  runUrl: 'https://github.com/acme-org/my-app/actions/runs/123456',
  sha: 'abc1234567890',
  ref: 'refs/heads/main',
  actor: 'octocat',
  eventName: 'push',
}

function makeOctokit(overrides: Record<string, any> = {}): any {
  return {
    rest: {
      actions: {
        listJobsForWorkflowRun: jest.fn().mockResolvedValue({
          data: {
            jobs: [
              {
                id: 999,
                name: 'build-and-test',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'https://github.com/acme-org/my-app/runs/999',
              },
            ],
          },
        }),
      },
      issues: {
        createLabel: jest.fn().mockResolvedValue({ data: {} }),
        create: jest.fn().mockResolvedValue({
          data: {
            number: 1,
            html_url: 'https://github.com/acme-org/my-app/issues/1',
            title: '[CI Failure] CI Pipeline / build-and-test',
            state: 'open',
          },
        }),
        createComment: jest.fn().mockResolvedValue({
          data: { html_url: 'https://github.com/acme-org/my-app/issues/1#issuecomment-1' },
        }),
      },
      search: {
        issuesAndPullRequests: jest.fn().mockResolvedValue({
          data: { total_count: 0, items: [] },
        }),
      },
    },
    request: jest.fn().mockResolvedValue({ data: 'Line 1\nLine 2\nLine 3' }),
    ...overrides,
  }
}

describe('findCurrentJob', () => {
  it('returns the matching job by name', async () => {
    const octokit = makeOctokit()
    const job = await findCurrentJob(octokit, baseCtx)
    expect(job).not.toBeNull()
    expect(job!.name).toBe('build-and-test')
    expect(job!.id).toBe(999)
  })

  it('returns null when API call fails', async () => {
    const octokit = makeOctokit({
      rest: {
        ...makeOctokit().rest,
        actions: {
          listJobsForWorkflowRun: jest.fn().mockRejectedValue(new Error('Network error')),
        },
      },
    })
    const job = await findCurrentJob(octokit, baseCtx)
    expect(job).toBeNull()
  })

  it('falls back to first job when name does not match', async () => {
    const octokit = makeOctokit()
    const ctx = { ...baseCtx, jobName: 'nonexistent-job' }
    const job = await findCurrentJob(octokit, ctx)
    expect(job).not.toBeNull()
    expect(job!.name).toBe('build-and-test')
  })

  it('returns null when job list is empty', async () => {
    const octokit = makeOctokit()
    octokit.rest.actions.listJobsForWorkflowRun.mockResolvedValue({ data: { jobs: [] } })
    const job = await findCurrentJob(octokit, baseCtx)
    expect(job).toBeNull()
  })
})

describe('fetchJobLogTail', () => {
  it('returns last N lines of logs', async () => {
    const octokit = makeOctokit()
    octokit.request.mockResolvedValue({ data: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5' })
    const tail = await fetchJobLogTail(octokit, baseCtx, 999, 3)
    const lines = tail.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('Line 3')
  })

  it('returns empty string on API error', async () => {
    const octokit = makeOctokit()
    octokit.request.mockRejectedValue(new Error('Forbidden'))
    const tail = await fetchJobLogTail(octokit, baseCtx, 999, 50)
    expect(tail).toBe('')
  })

  it('handles non-string response data gracefully', async () => {
    const octokit = makeOctokit()
    octokit.request.mockResolvedValue({ data: null })
    const tail = await fetchJobLogTail(octokit, baseCtx, 999, 50)
    expect(tail).toBe('')
  })
})

describe('ensureLabelExists', () => {
  it('calls createLabel with correct params', async () => {
    const octokit = makeOctokit()
    await ensureLabelExists(octokit, 'acme-org', 'my-app', 'ci-failure', 'e11d48', 'CI failure')
    expect(octokit.rest.issues.createLabel).toHaveBeenCalledWith({
      owner: 'acme-org',
      repo: 'my-app',
      name: 'ci-failure',
      color: 'e11d48',
      description: 'CI failure',
    })
  })

  it('swallows 422 errors (label already exists)', async () => {
    const octokit = makeOctokit()
    const err = Object.assign(new Error('Already exists'), { status: 422 })
    octokit.rest.issues.createLabel.mockRejectedValue(err)
    // Should not throw
    await expect(
      ensureLabelExists(octokit, 'acme-org', 'my-app', 'ci-failure')
    ).resolves.toBeUndefined()
  })

  it('logs warning for non-422 errors', async () => {
    const octokit = makeOctokit()
    const err = Object.assign(new Error('Server error'), { status: 500 })
    octokit.rest.issues.createLabel.mockRejectedValue(err)
    // Should not throw — logs a warning
    await expect(
      ensureLabelExists(octokit, 'acme-org', 'my-app', 'ci-failure')
    ).resolves.toBeUndefined()
  })
})

describe('findExistingIssue', () => {
  it('returns null when no issues found', async () => {
    const octokit = makeOctokit()
    const issue = await findExistingIssue(
      octokit,
      'acme-org',
      'my-app',
      'ci-failure',
      'ci-workflow:CI-Pipeline/build-and-test'
    )
    expect(issue).toBeNull()
  })

  it('returns the first matching issue', async () => {
    const octokit = makeOctokit()
    octokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: {
        total_count: 1,
        items: [
          {
            number: 7,
            html_url: 'https://github.com/acme-org/my-app/issues/7',
            title: '[CI Failure] CI Pipeline / build-and-test',
            state: 'open',
          },
        ],
      },
    })
    const issue = await findExistingIssue(
      octokit,
      'acme-org',
      'my-app',
      'ci-failure',
      'ci-workflow:CI-Pipeline/build-and-test'
    )
    expect(issue).not.toBeNull()
    expect(issue!.number).toBe(7)
  })

  it('returns null on search API error', async () => {
    const octokit = makeOctokit()
    octokit.rest.search.issuesAndPullRequests.mockRejectedValue(new Error('Rate limited'))
    const issue = await findExistingIssue(
      octokit,
      'acme-org',
      'my-app',
      'ci-failure',
      'ci-workflow:test'
    )
    expect(issue).toBeNull()
  })

  it('uses correct search query with both labels', async () => {
    const octokit = makeOctokit()
    await findExistingIssue(
      octokit,
      'acme-org',
      'my-app',
      'ci-failure',
      'ci-workflow:CI-Pipeline/build'
    )
    const call = octokit.rest.search.issuesAndPullRequests.mock.calls[0][0]
    expect(call.q).toContain('label:"ci-failure"')
    expect(call.q).toContain('label:"ci-workflow:CI-Pipeline/build"')
    expect(call.q).toContain('is:open')
    expect(call.q).toContain('is:issue')
  })
})

describe('createIssue', () => {
  it('creates an issue with the correct parameters', async () => {
    const octokit = makeOctokit()
    const issue = await createIssue(
      octokit,
      'acme-org',
      'my-app',
      '[CI Failure] CI Pipeline / build-and-test',
      'body content',
      ['ci-failure', 'ci-workflow:CI-Pipeline/build-and-test']
    )
    expect(issue.number).toBe(1)
    expect(issue.html_url).toContain('/issues/1')
    expect(octokit.rest.issues.create).toHaveBeenCalledWith({
      owner: 'acme-org',
      repo: 'my-app',
      title: '[CI Failure] CI Pipeline / build-and-test',
      body: 'body content',
      labels: ['ci-failure', 'ci-workflow:CI-Pipeline/build-and-test'],
    })
  })
})

describe('addCommentToIssue', () => {
  it('adds a comment and returns the comment URL', async () => {
    const octokit = makeOctokit()
    const url = await addCommentToIssue(octokit, 'acme-org', 'my-app', 1, 'comment body')
    expect(url).toContain('#issuecomment-')
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'acme-org',
      repo: 'my-app',
      issue_number: 1,
      body: 'comment body',
    })
  })
})
