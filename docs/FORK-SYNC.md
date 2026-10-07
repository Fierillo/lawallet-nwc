# Walletilla upstream updates

`Sync upstream` checks `lawalletio/lawallet-nwc/main` daily at 12:00 UTC
(09:00 Argentina), or manually from GitHub Actions. GitHub may delay scheduled runs.
The workflow runs only in `Fierillo/lawallet-nwc`.

- Merges into `automation/sync-upstream`, retaining fork commits.
- Opens or updates a PR to `main`. No automatic merge, reset, or force-push.
- Explicitly dispatches `CI` on that branch (tests, typecheck, lint and build).
  GitHub does not trigger PR workflows for PRs created with `GITHUB_TOKEN`.
  Check the branch's CI run in Actions before merging; this manual run is not
  necessarily presented as a required PR check. E2E is not dispatched by this job.
- Conflicts stop the run without pushing the conflicted merge. Other sync
  failures and failed CI runs also open an issue mentioning `@Fierillo`.
- An existing open alert is reused without repeated comments or emails. Close it
  after resolving the problem, then rerun `Sync upstream`.

No personal access token is needed. Repository Actions settings must allow
GitHub Actions to create pull requests. Fork schedules must be enabled, and the
workflow must be on the default branch.

For email alerts, enable email notifications for mentions and failed Actions
runs in your personal GitHub notification settings. A mention creates a GitHub
notification; email delivery depends on those preferences.

Review and resolve conflicts on the sync branch. Do not use GitHub's destructive
"Discard commits" fork sync option. Merge update PRs with **Create a merge
commit**, not squash/rebase, to retain upstream ancestry and avoid repeatedly
merging the same upstream commits.

Vercel, DNS, and database settings are outside Git and are not overwritten by
the sync. Merging a PR to `main` can trigger the normal production deployment;
review release notes for migrations or configuration changes first.
