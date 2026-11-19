#!/usr/bin/env bash
set -euo pipefail
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
: "${SCAN_ARCHIVE_SHA256:?Assessed archive hash is required}"
archive="$CANDIDATE_DIRECTORY/candidate-image.tar"
verify_source() {
    bun --no-env-file .github/scripts/deploy/dev-image.ts scan-hash "$archive" "$SCAN_ARCHIVE_SHA256"
}
verify_source
temporary_root=$(realpath -e -- "${RUNNER_TEMP:?}")
scan_directory=$(mktemp -d "$temporary_root/marketplace-dev-scan.XXXXXX")
cleanup() {
    local target
    target=$(realpath -e -- "$scan_directory")
    case "$target" in
        "$temporary_root"/marketplace-dev-scan.*) rm -rf -- "$target" ;;
        *) echo 'Refusing cleanup outside the owned scan directory.' >&2; return 1 ;;
    esac
}
trap cleanup EXIT
# Trivy supports OCI layout directories, not OCI tar archives.
# Skopeo copies data only and must retain the selected manifest digest.
skopeo copy --all --preserve-digests "oci-archive:$archive" "oci:$scan_directory/layout:scan"
skopeo inspect --raw "oci-archive:$archive" > "$scan_directory/source-manifest.json"
skopeo inspect --raw "oci:$scan_directory/layout:scan" > "$scan_directory/layout-manifest.json"
bun --no-env-file .github/scripts/deploy/dev-image.ts scan-manifests "$scan_directory/source-manifest.json" "$scan_directory/layout-manifest.json"
verify_source
bash .github/scripts/security/scan-image.sh "$scan_directory/layout" --input
verify_source
