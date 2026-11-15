#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
# Verify bytes before passing the archive to any container tooling.
bun --no-env-file .github/scripts/deploy/dev-image.ts hashes
skopeo inspect --raw "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" > "$CANDIDATE_DIRECTORY/manifest.json"
skopeo inspect --raw --config "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" > "$CANDIDATE_DIRECTORY/config.json"
bun --no-env-file .github/scripts/deploy/dev-image.ts verify
