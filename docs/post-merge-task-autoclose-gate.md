# Post-merge task auto-close + verification gate

## What it does
When a PR is merged to `main`, Mission Control can now:
1. Map PR metadata to `cortana_tasks` IDs (`#46`, `task: 46`, `task-id:46`, `cortana_tasks-46`) from:
   - PR title
   - PR body
   - PR labels
   - PR commit messages
2. Mark mapped tasks as done:
   - `status='done'`
   - `completed_at=NOW()`
   - `outcome='auto-closed from merged PR #<n> | repo=<owner/repo> | commit=<sha>'`
3. Verify all mapped tasks are truly done.
4. Retry bounded times (default 3 attempts, 1s interval).
5. Emit clear failure alert/log when verification still fails.
6. Emit a merge receipt summary (`PR`, `commit`, `task IDs`).

## Trigger paths

### 1) GitHub Actions primary trigger (recommended)
Workflow: `.github/workflows/post-merge-task-autoclose.yml`
- Trigger: merged PR to `main`
- Runs: `pnpm task-autoclose:post-merge --event-path $GITHUB_EVENT_PATH`

### 2) CLI/manual trigger
```bash
cd apps/mission-control
pnpm task-autoclose:post-merge --pr <PR_NUMBER> --repo <owner/repo>
```

### 3) Cron fallback
Same workflow includes a `schedule` trigger every 30 minutes:
- scans recent merged PRs on `main`
- replays closure flow for latest PRs (idempotent for already-done tasks)

## Optional webhook trigger
Route: `POST /api/github/post-merge-task-autoclose`
- payload: GitHub `pull_request` event (`action=closed`, `merged=true`)
- optional auth: set `GITHUB_MERGE_HOOK_TOKEN` and send `Authorization: Bearer <token>`

## Operator setup
1. In repo secrets, set:
   - `DATABASE_URL` (Mission Control DB)
   - `CORTANA_DATABASE_URL` (Cortana DB where real `cortana_tasks` live)
2. Ensure GitHub Actions enabled for the repo.
3. Merge the workflow file to `main`.
4. Verify via manual dispatch:
   - Actions → **Post-merge task auto-close** → Run workflow with `pr=<known merged PR>`
5. Confirm output includes receipt + mapped IDs and exits 0.

## Rollout notes
- Start with manual dispatch on a small known PR containing explicit task refs.
- Then allow automatic `pull_request.closed` trigger.
- Keep cron fallback enabled for recovery/backfill.

## Rollback notes
- Fast rollback: disable or remove `.github/workflows/post-merge-task-autoclose.yml`.
- Code rollback: revert commit introducing:
  - `lib/post-merge-task-autoclose.ts`
  - `scripts/post-merge-task-autoclose.ts`
  - `app/api/github/post-merge-task-autoclose/route.ts`
- No schema migration required for rollback.
