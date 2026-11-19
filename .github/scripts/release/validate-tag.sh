#!/usr/bin/env bash
set -euo pipefail
revision=$(git rev-parse HEAD)
bun --no-env-file .github/scripts/release/release-identity.ts context "$revision"
# Resolve the current remote tag, including annotated tags, before every publication.
remote=$(gh api "repos/$GITHUB_REPOSITORY/commits/$RELEASE_TAG" --jq .sha)
# GitHub's comparison must prove main contains this exact tagged commit.
status=$(gh api "repos/$GITHUB_REPOSITORY/compare/$GITHUB_SHA...main" --jq .status)
bun --no-env-file .github/scripts/release/release-identity.ts provenance "$revision" "$remote" "$status"
