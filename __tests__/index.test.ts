import * as core from '@actions/core'
import * as github from '@actions/github'

// Mock modules before importing the module under test
jest.mock('@actions/core')
jest.mock('@actions/github')
jest.mock('../src/github')

import {
  findCurrentJob,
  fetchJobLogTail,
  ensureLabelExists,
  findExistingIssue,
  createIssue,
  addCommentToIssue,
} from '../src/github'
import { parseInputs, buildFailureContext } from '../src/index'

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>
const mockFindCurrentJob = findCurrentJob as jest.MockedFunction<typeof findCurrentJob>
const mockFetchJobLogTail = fetchJobLogTail as jest.MockedFunction<typeof fetchJobLogTail>
const mockEnsureLabelExists = ensureLabelExists as jest.MockedFunction<typeof ensureLabelExists>
const mockFindExistingIssue = findExistingIssue as jest.MockedFunction<typeof findExistingIssue>
const mockCreateIssue = createIssue as jest.MockedFunction<typeof createIssue>
const mockAddCommentToIssue = addCommentToIssue as jest.MockedFunction<typeof addCommentToIssue>

describe('parseInputs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCore.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'ghs_testtoken',
        'issue-repo': '',
        'max-log-lines': '50',
        labels: 'ci-failure',
      }
      return inputs[name] ?? ''
    })
  })

  it('parses valid inputs correctly', () => {
    const inputs = parseInputs()
    expect(inputs.githubToken).toBe('ghs_testtoken')
    expect(inputs.issueRepo).toBe('')
    expect(inputs.maxLogLines).toBe(50)
    expect(inputs.labels).toEqual(['ci-failure'])
  })

  it('parses multiple labels', () => {
    mockCore.getInput.mockImplementation((name: string) => {
      if (name === 'labels') return 'ci-failure, bug, automated'
      if (name === 'github-token') return 'ghs_test'
      if (name === 'max-log-lines') return '50'
      return ''
    })
    const inputs = parseInputs()
    expect(inputs.labels).toEqual(['ci-failure', 'bug', 'automated'])
  })

  it('throws on invalid max-log-lines', () => {
    mockCore.getInput.mockImplementation((name: string) => {
      if (name === 'max-log-lines') return 'not-a-number'
      if (name === 'github-token') return 'ghs_test'
      return ''
    })
    expect(() => parseInputs()).toThrow('Invalid max-log-lines value')
  })
})

describe('buildFailureContext', () => {
  beforeEach(() => {
    process.env.GITHUB_JOB = 'test-job'
    process.env.GITHUB_SERVER_URL = 'https://github.com'
    Object.defineProperty(mockGithub, 'context', {
      value: {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        runId: 99,
        runNumber: 5,
        ref: 'refs/heads/feature',
        sha: 'deadbeef1234',
        actor: 'tester',
        eventName: 'push',
        workflow: 'Test Workflow',
        job: 'test-job',
      },
      writable: true,
    })
  })

  afterEach(() => {
    delete process.env.GITHUB_JOB
    delete process.env.GITHUB_SERVER_URL
  })

  it('builds context from github.context', () => {
    const ctx = buildFailureContext()
    expect(ctx.owner).toBe('test-owner')
    expect(ctx.repo).toBe('test-repo')
    expect(ctx.runId).toBe(99)
    expect(ctx.workflow).toBe('Test Workflow')
    expect(ctx.jobName).toBe('test-job')
  })

  it('constructs runUrl correctly', () => {
    const ctx = buildFailureContext()
    expect(ctx.runUrl).toBe('https://github.com/test-owner/test-repo/actions/runs/99')
  })
})

describe('action branching logic', () => {
  const mockOctokit = {} as any

  beforeEach(() => {
    jest.clearAllMocks()
    mockCore.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'ghs_testtoken',
        'issue-repo': '',
        'max-log-lines': '50',
        labels: 'ci-failure',
      }
      return inputs[name] ?? ''
    })
    mockCore.setOutput.mockImplementation(() => {})
    mockCore.info.mockImplementation(() => {})
    mockCore.warning.mockImplementation(() => {})
    mockCore.setFailed.mockImplementation(() => {})
    ;(mockGithub.getOctokit as jest.Mock).mockReturnValue(mockOctokit)
    Object.defineProperty(mockGithub, 'context', {
      value: {
        repo: { owner: 'acme-org', repo: 'my-app' },
        runId: 123456,
        runNumber: 42,
        ref: 'refs/heads/main',
        sha: 'abc1234567890',
        actor: 'octocat',
        eventName: 'push',
        workflow: 'CI Pipeline',
        job: 'build-and-test',
      },
      writable: true,
    })
    process.env.GITHUB_JOB = 'build-and-test'
    process.env.GITHUB_SERVER_URL = 'https://github.com'

    mockFindCurrentJob.mockResolvedValue({
      id: 999,
      name: 'build-and-test',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/acme-org/my-app/runs/999',
    })
    mockFetchJobLogTail.mockResolvedValue('Error: test failed')
    mockEnsureLabelExists.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.GITHUB_JOB
    delete process.env.GITHUB_SERVER_URL
  })

  it('creates a new issue when no existing issue found', async () => {
    mockFindExistingIssue.mockResolvedValue(null)
    mockCreateIssue.mockResolvedValue({
      number: 1,
      html_url: 'https://github.com/acme-org/my-app/issues/1',
      title: '[CI Failure] CI Pipeline / build-and-test',
      state: 'open',
    })

    // Dynamically import to trigger run()
    jest.isolateModules(() => {
      require('../src/index')
    })

    // Allow promises to settle
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockCreateIssue).toHaveBeenCalled()
    expect(mockAddCommentToIssue).not.toHaveBeenCalled()
  })

  it('adds a comment when an existing issue is found', async () => {
    mockFindExistingIssue.mockResolvedValue({
      number: 7,
      html_url: 'https://github.com/acme-org/my-app/issues/7',
      title: '[CI Failure] CI Pipeline / build-and-test',
      state: 'open',
    })
    mockAddCommentToIssue.mockResolvedValue(
      'https://github.com/acme-org/my-app/issues/7#issuecomment-1'
    )

    jest.isolateModules(() => {
      require('../src/index')
    })

    await new Promise((resolve) => setImmediate(resolve))

    expect(mockAddCommentToIssue).toHaveBeenCalled()
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it('uses cross-repo target when issue-repo is set', async () => {
    mockCore.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'ghs_testtoken',
        'issue-repo': 'other-org/ci-issues',
        'max-log-lines': '50',
        labels: 'ci-failure',
      }
      return inputs[name] ?? ''
    })
    mockFindExistingIssue.mockResolvedValue(null)
    mockCreateIssue.mockResolvedValue({
      number: 5,
      html_url: 'https://github.com/other-org/ci-issues/issues/5',
      title: '[CI Failure] CI Pipeline / build-and-test',
      state: 'open',
    })

    jest.isolateModules(() => {
      require('../src/index')
    })

    await new Promise((resolve) => setImmediate(resolve))

    expect(mockCreateIssue).toHaveBeenCalledWith(
      mockOctokit,
      'other-org',
      'ci-issues',
      expect.any(String),
      expect.any(String),
      expect.any(Array)
    )
  })

  it('fails with setFailed when issue-repo format is invalid', async () => {
    mockCore.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'ghs_testtoken',
        'issue-repo': 'invalid-no-slash',
        'max-log-lines': '50',
        labels: 'ci-failure',
      }
      return inputs[name] ?? ''
    })

    jest.isolateModules(() => {
      require('../src/index')
    })

    await new Promise((resolve) => setImmediate(resolve))

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid issue-repo format')
    )
  })

  it('proceeds without job ID when findCurrentJob returns null', async () => {
    mockFindCurrentJob.mockResolvedValue(null)
    mockFindExistingIssue.mockResolvedValue(null)
    mockCreateIssue.mockResolvedValue({
      number: 2,
      html_url: 'https://github.com/acme-org/my-app/issues/2',
      title: '[CI Failure] CI Pipeline / build-and-test',
      state: 'open',
    })

    jest.isolateModules(() => {
      require('../src/index')
    })

    await new Promise((resolve) => setImmediate(resolve))

    // fetchJobLogTail should not be called since no job was found
    expect(mockFetchJobLogTail).not.toHaveBeenCalled()
    expect(mockCreateIssue).toHaveBeenCalled()
  })
})
