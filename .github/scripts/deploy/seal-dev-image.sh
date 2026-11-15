#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
: "${IMAGE_ID:?OCI config digest is required}"
# The archive is never converted or rebuilt after runtime checks.
skopeo inspect --raw "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" > "$CANDIDATE_DIRECTORY/manifest.json"
skopeo inspect --raw --config "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" > "$CANDIDATE_DIRECTORY/config.json"
bun --no-env-file .github/scripts/deploy/dev-image.ts candidate
