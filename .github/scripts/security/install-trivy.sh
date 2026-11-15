#!/usr/bin/env bash
set -euo pipefail
version=0.76.2
archive="trivy_${version}_Linux-64bit.tar.gz"
archive_path="$RUNNER_TEMP/$archive"
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --output "$archive_path" "https://github.com/aquasecurity/trivy/releases/download/v${version}/$archive"
printf '%s  %s\n' bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf "$archive_path" | sha256sum --check --strict
tar -xzf "$archive_path" -C "$RUNNER_TEMP" trivy
