#!/usr/bin/env bash
set -euo pipefail
# Public vulnerability databases and a local image need no registry or GitHub token.
unset GH_TOKEN GITHUB_TOKEN TRIVY_USERNAME TRIVY_PASSWORD TRIVY_REGISTRY_TOKEN
image="${1:?Scan image is required}"
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
    "$image"
