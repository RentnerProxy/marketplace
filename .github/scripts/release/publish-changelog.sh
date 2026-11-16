#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${RELEASE_TAG:?Release tag is required}"
bash .github/scripts/release/validate-tag.sh
asset="Marketplace-$RELEASE_TAG-CHANGELOG.md"
source="$RUNNER_TEMP/$asset"
[[ -s "$source" && ! -L "$source" ]] || { echo 'Prepared changelog is missing.' >&2; exit 1; }
assets=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG" --jq '.assets[].name')
if grep -Fxq "$asset" <<< "$assets"; then
    directory=$(mktemp -d "$RUNNER_TEMP/marketplace-changelog.XXXXXXXX")
    trap 'rm -f "$directory/changelog.md"; rmdir "$directory"' EXIT
    gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$asset" --output "$directory/changelog.md"
    cmp -- "$source" "$directory/changelog.md" || { echo 'Published changelog differs; refusing to overwrite it.' >&2; exit 1; }
else
    gh release upload "$RELEASE_TAG" "$source" --repo "$GITHUB_REPOSITORY"
fi
