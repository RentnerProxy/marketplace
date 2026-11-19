#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
PREFLIGHT_ARCHIVE_SHA256=$(bun --no-env-file .github/scripts/deploy/dev-image.ts preflight)
export PREFLIGHT_ARCHIVE_SHA256
# Only the read-only build job imports and executes this candidate.
skopeo copy "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" "docker-daemon:marketplace-dev-runtime:tested"
docker image inspect marketplace-dev-runtime:tested > "$CANDIDATE_DIRECTORY/runtime-inspect.json"
bun --no-env-file .github/scripts/deploy/dev-image.ts loaded
