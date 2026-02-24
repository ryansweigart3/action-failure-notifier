export interface ActionInputs {
  githubToken: string
  issueRepo: string
  maxLogLines: number
  labels: string[]
}

export interface FailureContext {
  owner: string
  repo: string
  workflow: string
  jobName: string
  runId: number
  runNumber: number
  runUrl: string
  sha: string
  ref: string
  actor: string
  eventName: string
}

export interface WorkflowJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  html_url: string
  steps?: WorkflowJobStep[]
}

export interface WorkflowJobStep {
  name: string
  status: string
  conclusion: string | null
  number: number
}

export interface ExistingIssue {
  number: number
  html_url: string
  title: string
  state: string
}
