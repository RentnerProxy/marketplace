#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${RELEASE_TAG:?Release tag is required}"
bash .github/scripts/release/validate-tag.sh
validator=.github/scripts/release/release-identity.ts
asset=$(bun --no-env-file "$validator" changelog)
source="$RUNNER_TEMP/$asset"
assets=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG" --jq '.assets[].name')
if grep -Fxq "$asset" <<< "$assets"; then
    directory=$(mktemp -d "$RUNNER_TEMP/marketplace-changelog.XXXXXXXX")
    trap 'rm -f "$directory/changelog.md"; rmdir "$directory"' EXIT
    gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$asset" --output "$directory/changelog.md"
    bun --no-env-file "$validator" changelog "$directory/changelog.md" >/dev/null
else
    gh release upload "$RELEASE_TAG" "$source" --repo "$GITHUB_REPOSITORY"
fi
