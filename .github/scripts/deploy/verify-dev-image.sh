#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
# Verify job-bound artifact bytes before interpreting the archive or receipt.
bun --no-env-file .github/scripts/deploy/dev-image.ts hashes
bun --no-env-file .github/scripts/deploy/dev-image.ts verify
