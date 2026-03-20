#!/usr/bin/env bash
# Shared helper: commit all pending changes on a new branch and open a PR.
# Usage: auto_commit_pr <flow_name> <run_stamp> <repo_root>

auto_commit_pr() {
  local flow_name="$1"
  local run_stamp="$2"
  local repo_root="$3"
  local branch="backtester/${flow_name}-${run_stamp}"
  local original_branch

  original_branch="$(git -C "${repo_root}" rev-parse --abbrev-ref HEAD)"

  # Nothing to do if the tree is already clean
  if git -C "${repo_root}" diff --quiet && \
     git -C "${repo_root}" diff --cached --quiet && \
     [ -z "$(git -C "${repo_root}" ls-files --others --exclude-standard)" ]; then
    echo "Working tree clean — nothing to commit."
    return 0
  fi

  echo
  echo "== Auto-commit: ${branch} =="

  git -C "${repo_root}" checkout -b "${branch}"
  git -C "${repo_root}" add -A
  git -C "${repo_root}" commit -m "backtester: ${flow_name} flow ${run_stamp}"
  git -C "${repo_root}" push -u origin "${branch}"

  gh pr create \
    --repo "$(git -C "${repo_root}" remote get-url origin)" \
    --head "${branch}" \
    --base "${original_branch}" \
    --title "backtester: ${flow_name} ${run_stamp}" \
    --body "Automated ${flow_name} flow run outputs."

  # Return to original branch with a clean tree
  git -C "${repo_root}" checkout "${original_branch}"
  # Remove untracked files that are now on the PR branch
  git -C "${repo_root}" clean -fd backtester/var/local-workflows/"${run_stamp}" 2>/dev/null || true

  echo "PR created. Working tree is clean."
}
