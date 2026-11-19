#!/usr/bin/env bash
set -eo pipefail

archive="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
archive_path="$RUNNER_TEMP/$archive"
release_url="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${archive}"

curl --fail --location --proto '=https' --tlsv1.2 --output "$archive_path" "$release_url"
bun --no-env-file .github/scripts/security/verify-checksum.ts "$archive_path" "$ACTIONLINT_SHA256"
tar -xzf "$archive_path" -C "$RUNNER_TEMP" actionlint
