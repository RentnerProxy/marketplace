#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE_ID:?Built appliance image is required}"
: "${RUNNER_TEMP:?Runner temporary directory is required}"
export CANDIDATE_DIRECTORY="$RUNNER_TEMP/marketplace-oci-scan-fixture"
mkdir -p "$CANDIDATE_DIRECTORY"
tag=marketplace-oci-scan-fixture:test
docker tag "$IMAGE_ID" "$tag"
trap 'docker image rm "$tag" >/dev/null' EXIT
# Exercise the OCI scanner transport with real packages from the built appliance.
skopeo copy --format oci "docker-daemon:$tag" "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar"
export SCAN_ARCHIVE_SHA256
SCAN_ARCHIVE_SHA256=$(sha256sum "$CANDIDATE_DIRECTORY/candidate-image.tar" | cut -d ' ' -f 1)
bash .github/scripts/deploy/scan-dev-image.sh
