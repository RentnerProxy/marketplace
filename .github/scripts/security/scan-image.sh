#!/usr/bin/env bash
set -euo pipefail
# Public vulnerability databases and a local image need no registry or GitHub token.
unset GH_TOKEN GITHUB_TOKEN TRIVY_USERNAME TRIVY_PASSWORD TRIVY_REGISTRY_TOKEN
image="${1:?Scan image is required}"
script_directory=$(dirname -- "${BASH_SOURCE[0]}")
source=("$image")
patch_policy=()
proof=()
if [[ "$#" == 2 && "$2" == --input ]]; then
    source=(--input "$image")
    if [[ -f "$image/index.json" ]]; then
        proof=("$image" --input)
    fi
elif [[ "$#" != 1 ]]; then
    echo 'Expected one image reference, optionally followed by --input for an archive.' >&2
    exit 1
elif [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    source=(--image-src docker "$image")
    proof=("$image")
fi
if [[ -n "${proof[0]:-}" ]] && bun --no-env-file "$script_directory/verify-image-picomatch.ts" "${proof[@]}"; then
    echo 'Verified the installed picomatch patch for CVE-2026-112366.' >&2
    if [[ "${source[0]}" == --input ]]; then
        source=(--input "$image:scan")
    fi
    patch_policy=(--ignore-policy "$script_directory/picomatch-image.rego" --show-suppressed)
fi
"${TRIVY_BINARY:-trivy}" image \
    --db-repository public.ecr.aws/aquasecurity/trivy-db:2 \
    --db-repository mirror.gcr.io/aquasec/trivy-db:2 \
    --db-repository ghcr.io/aquasecurity/trivy-db:2 \
    --scanners vuln \
    --pkg-types os,library \
    --severity HIGH,CRITICAL \
    --exit-code 1 \
    --format table \
    --no-progress \
    "${patch_policy[@]}" \
    "${source[@]}"
