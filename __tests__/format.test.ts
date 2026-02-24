import {
  buildIssueTitle,
  buildWorkflowLabel,
  buildBranchLabel,
  buildIssueBody,
  buildCommentBody,
} from '../src/format'
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

describe('buildIssueTitle', () => {
  it('formats title with workflow and job name', () => {
    expect(buildIssueTitle(baseCtx)).toBe('[CI Failure] CI Pipeline / build-and-test')
  })

  it('handles workflow names with special characters', () => {
    const ctx = { ...baseCtx, workflow: 'Deploy: Production', jobName: 'deploy' }
    expect(buildIssueTitle(ctx)).toBe('[CI Failure] Deploy: Production / deploy')
  })
})

describe('buildWorkflowLabel', () => {
  it('produces a label with ci-workflow: prefix', () => {
    const label = buildWorkflowLabel(baseCtx)
    expect(label).toMatch(/^ci-workflow:/)
  })

  it('truncates label to 50 characters', () => {
    const ctx = {
      ...baseCtx,
      workflow: 'Very Long Workflow Name That Exceeds Limits',
      jobName: 'very-long-job-name-too',
    }
    expect(buildWorkflowLabel(ctx).length).toBeLessThanOrEqual(50)
  })

  it('replaces spaces with dashes', () => {
    const label = buildWorkflowLabel(baseCtx)
    expect(label).not.toContain(' ')
  })

  it('produces consistent labels for the same context', () => {
    expect(buildWorkflowLabel(baseCtx)).toBe(buildWorkflowLabel(baseCtx))
  })
})

describe('buildBranchLabel', () => {
  it('strips refs/heads/ prefix', () => {
    expect(buildBranchLabel(baseCtx)).toBe('branch:main')
  })

  it('strips refs/tags/ prefix', () => {
    const ctx = { ...baseCtx, ref: 'refs/tags/v1.0.0' }
    expect(buildBranchLabel(ctx)).toBe('branch:v1.0.0')
  })

  it('sanitizes slashes in branch names', () => {
    const ctx = { ...baseCtx, ref: 'refs/heads/feature/my-feature' }
    const label = buildBranchLabel(ctx)
    expect(label).toBe('branch:feature/my-feature')
  })

  it('replaces invalid characters with dashes', () => {
    const ctx = { ...baseCtx, ref: 'refs/heads/feat ure' }
    const label = buildBranchLabel(ctx)
    expect(label).not.toContain(' ')
  })

  it('truncates to 50 characters', () => {
    const ctx = {
      ...baseCtx,
      ref: 'refs/heads/very-long-branch-name-that-exceeds-the-fifty-character-limit',
    }
    expect(buildBranchLabel(ctx).length).toBeLessThanOrEqual(50)
  })

  it('always starts with branch:', () => {
    expect(buildBranchLabel(baseCtx)).toMatch(/^branch:/)
  })
})

describe('buildIssueBody', () => {
  it('includes workflow name', () => {
    const body = buildIssueBody(baseCtx, '')
    expect(body).toContain('CI Pipeline')
  })

  it('includes job name', () => {
    const body = buildIssueBody(baseCtx, '')
    expect(body).toContain('build-and-test')
  })

  it('includes run URL', () => {
    const body = buildIssueBody(baseCtx, '')
    expect(body).toContain('https://github.com/acme-org/my-app/actions/runs/123456')
  })

  it('includes short SHA (8 chars)', () => {
    const body = buildIssueBody(baseCtx, '')
    expect(body).toContain('abc12345')
    expect(body).not.toContain('abc1234567890')
  })

  it('includes log tail when provided', () => {
    const logTail = 'Error: test failed\nat line 42'
    const body = buildIssueBody(baseCtx, logTail)
    expect(body).toContain(logTail)
    expect(body).toContain('```')
  })

  it('shows unavailable message when no log tail', () => {
    const body = buildIssueBody(baseCtx, '')
    expect(body).toContain('_Logs not available._')
  })

  it('includes actor and event name', () => {
    const body = buildIssueBody(baseCtx, '')
    expect(body).toContain('octocat')
    expect(body).toContain('push')
  })
})

describe('buildCommentBody', () => {
  it('includes run URL', () => {
    const body = buildCommentBody(baseCtx, '')
    expect(body).toContain('https://github.com/acme-org/my-app/actions/runs/123456')
  })

  it('includes short SHA', () => {
    const body = buildCommentBody(baseCtx, '')
    expect(body).toContain('abc12345')
  })

  it('includes log tail in details block when provided', () => {
    const logTail = 'npm ERR! test script failed'
    const body = buildCommentBody(baseCtx, logTail)
    expect(body).toContain(logTail)
    expect(body).toContain('<details>')
  })

  it('omits details block when no log tail', () => {
    const body = buildCommentBody(baseCtx, '')
    expect(body).not.toContain('<details>')
  })
})
