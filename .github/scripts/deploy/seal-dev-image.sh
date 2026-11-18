#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
: "${IMAGE_ID:?OCI config digest is required}"
# The archive is never converted or rebuilt after runtime checks.
bun --no-env-file .github/scripts/deploy/dev-image.ts candidate
