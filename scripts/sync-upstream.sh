#!/usr/bin/env bash
# Only run in a disposable checkout: never pushes main, resets, or force-pushes.
set -euo pipefail

BASE_BRANCH=${BASE_BRANCH:-main}
SYNC_BRANCH=${SYNC_BRANCH:-automation/sync-upstream}
UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/lawalletio/lawallet-nwc.git}

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Refusing to sync a dirty checkout.' >&2
  exit 1
fi
if [[ "$SYNC_BRANCH" == "$BASE_BRANCH" ]]; then
  echo 'Sync branch must differ from the base branch.' >&2
  exit 1
fi

git fetch origin
git fetch "$UPSTREAM_URL" "$BASE_BRANCH"
upstream_sha=$(git rev-parse FETCH_HEAD)
if git merge-base --is-ancestor "$upstream_sha" "origin/$BASE_BRANCH"; then
  echo 'Upstream is already included in the fork.'
  exit 0
fi

if git show-ref --verify --quiet "refs/heads/$SYNC_BRANCH"; then
  git switch "$SYNC_BRANCH"
elif git show-ref --verify --quiet "refs/remotes/origin/$SYNC_BRANCH"; then
  git switch --create "$SYNC_BRANCH" "origin/$SYNC_BRANCH"
else
  git switch --create "$SYNC_BRANCH" "origin/$BASE_BRANCH"
fi

targets=("origin/$BASE_BRANCH" "$upstream_sha")
if git show-ref --verify --quiet "refs/remotes/origin/$SYNC_BRANCH"; then
  targets=("origin/$SYNC_BRANCH" "${targets[@]}")
fi
for target in "${targets[@]}"; do
  if ! git merge --no-edit "$target"; then
    echo 'Sync blocked: resolve these conflicts manually:' >&2
    git diff --name-only --diff-filter=U >&2
    git merge --abort
    exit 1
  fi
done

git push origin "HEAD:refs/heads/$SYNC_BRANCH"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo 'has_updates=true' >> "$GITHUB_OUTPUT"
fi
