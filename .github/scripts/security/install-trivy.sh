#!/usr/bin/env bash
set -euo pipefail
version=0.76.2
case "$(uname -m)" in
    x86_64)
        platform=64bit
        digest=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf
        ;;
    aarch64)
        platform=ARM64
        digest=ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3
        ;;
    *) echo 'Trivy requires native Linux AMD64 or ARM64.' >&2; exit 1 ;;
esac
archive="trivy_${version}_Linux-${platform}.tar.gz"
archive_path="$RUNNER_TEMP/$archive"
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --output "$archive_path" "https://github.com/aquasecurity/trivy/releases/download/v${version}/$archive"
printf '%s  %s\n' "$digest" "$archive_path" | sha256sum --check --strict
tar -xzf "$archive_path" -C "$RUNNER_TEMP" trivy
