#!/usr/bin/env bash
set -euo pipefail
# Public vulnerability databases and a local image need no registry or GitHub token.
unset GH_TOKEN GITHUB_TOKEN TRIVY_USERNAME TRIVY_PASSWORD TRIVY_REGISTRY_TOKEN
image="${1:?Scan image is required}"
source=("$image")
if [[ "$#" == 2 && "$2" == --input ]]; then
    source=(--input "$image")
elif [[ "$#" != 1 ]]; then
    echo 'Expected one image reference, optionally followed by --input for an archive.' >&2
    exit 1
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
    "${source[@]}"
