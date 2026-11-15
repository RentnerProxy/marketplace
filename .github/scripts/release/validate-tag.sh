#!/usr/bin/env bash
set -euo pipefail
[[ "$GITHUB_REF_TYPE" == tag ]]
[[ "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$ ]]
[[ "$GITHUB_REPOSITORY" == RentnerProxy/marketplace ]]
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]
# Resolve the current remote tag, including annotated tags, before every publication.
[[ "$(gh api "repos/$GITHUB_REPOSITORY/commits/$RELEASE_TAG" --jq .sha)" == "$GITHUB_SHA" ]]
# GitHub's comparison must prove main contains this exact tagged commit.
status=$(gh api "repos/$GITHUB_REPOSITORY/compare/$GITHUB_SHA...main" --jq .status)
[[ "$status" == ahead || "$status" == identical ]]
