# action-failure-notifier

A reusable GitHub Action that automatically creates (or comments on) a GitHub issue when a workflow job fails. Drop a single step into any workflow and get instant, deduplicated failure tracking — with log tails included.

## Features

- **Auto-creates issues** on job failure with workflow details, commit info, and log tail
- **Deduplicates** — if an open issue for this workflow/job already exists, adds a comment instead of creating a duplicate
- **Cross-repo support** — write issues to a centralized issue board in a different repo
- **Log tails** — fetches the last N lines of job logs and embeds them in the issue
- **Configurable labels** — tag issues with custom labels for easy filtering

## Usage

```yaml
permissions:
  issues: write
  actions: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  notify-on-failure:
    needs: build
    runs-on: ubuntu-latest
    if: failure()
    steps:
      - uses: your-username/action-failure-notifier@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Cross-repo (centralized issue board)

Pass a PAT with `issues: write` on the target repo and set `issue-repo`:

```yaml
  notify-on-failure:
    needs: [build, test, deploy]
    runs-on: ubuntu-latest
    if: failure()
    steps:
      - uses: your-username/action-failure-notifier@v1
        with:
          github-token: ${{ secrets.CI_ISSUES_PAT }}
          issue-repo: 'your-org/ci-issues'
          labels: 'ci-failure,production'
          max-log-lines: '100'
```

### Using outputs

```yaml
      - uses: your-username/action-failure-notifier@v1
        id: notifier
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Print issue URL
        run: echo "Issue at ${{ steps.notifier.outputs.issue-url }}"
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | Yes | — | GitHub token with `issues: write` and `actions: read` |
| `issue-repo` | No | current repo | Target repo in `owner/repo` format |
| `max-log-lines` | No | `50` | Number of log lines to include |
| `labels` | No | `ci-failure` | Comma-separated labels to apply |

## Outputs

| Output | Description |
|---|---|
| `issue-number` | Number of the issue created or commented on |
| `issue-url` | URL of the issue |
| `action-taken` | `created` (new issue) or `comment` (added to existing) |

## Token Permissions

| Use case | Token |
|---|---|
| Same-repo issues | `secrets.GITHUB_TOKEN` with `issues: write` + `actions: read` |
| Cross-repo issues | PAT with `issues: write` on the target repo |

## Deduplication

The action uses the GitHub Search API to find open issues that have **both** the `ci-failure` label (or your custom label) **and** a workflow-specific label (`ci-workflow:{workflow}/{job}`). If found, a comment is added. This means:

- One issue per workflow job until it's manually closed
- Each new failure adds a comment with fresh log context
- Closing the issue resets deduplication — the next failure creates a new issue

## Labels Created

| Label | Description |
|---|---|
| `ci-failure` (configurable) | Applied to all failure issues |
| `ci-workflow:{workflow}/{job}` | Unique per workflow+job combo, used for deduplication |

## Local Development

```bash
npm ci
npm run all        # format check + lint + tests + build
```

Test with [`act`](https://github.com/nektos/act):

```bash
brew install act
act push
```

## License

MIT
