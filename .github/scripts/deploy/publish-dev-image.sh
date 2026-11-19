#!/usr/bin/env bash
set -euo pipefail
: "${REGISTRY_TOKEN:?Registry token is required}"
: "${REGISTRY_USER:?Registry user is required}"
: "${CANDIDATE_DIRECTORY:?Candidate directory is required}"
# Revalidate the handoff without exposing publication credentials to Bun.
immutable_tag=$(env -u REGISTRY_TOKEN bun --no-env-file .github/scripts/deploy/dev-image.ts ready)
image=ghcr.io/rentnerproxy/marketplace
# An older queued run must not move dev after main has advanced.
current_main=$(curl --fail --silent --show-error --retry 2 \
    --header 'Accept: application/vnd.github+json' \
    https://api.github.com/repos/RentnerProxy/marketplace/git/ref/heads/main | jq -er '.object.sha')
env -u REGISTRY_TOKEN bun --no-env-file .github/scripts/deploy/dev-image.ts registry-main "$current_main"
umask 077
auth_directory=$(mktemp -d "${RUNNER_TEMP:?}/marketplace-dev-auth.XXXXXX")
authfile="$auth_directory/auth.json"
trap 'rm -f "$authfile"; rmdir "$auth_directory"' EXIT
printf '%s' "$REGISTRY_TOKEN" | skopeo login --authfile "$authfile" --username "$REGISTRY_USER" --password-stdin ghcr.io
unset REGISTRY_TOKEN
# Unique run/attempt tags are immutable. Only an identical idempotent retry is accepted.
existing_manifest="$auth_directory/existing.json"
existing_error="$auth_directory/inspect-error.txt"
trap 'rm -f "$authfile" "$existing_manifest" "$existing_error"; rmdir "$auth_directory"' EXIT
if skopeo inspect --authfile "$authfile" --raw "docker://$image:$immutable_tag" > "$existing_manifest" 2> "$existing_error"; then
    bun --no-env-file .github/scripts/deploy/dev-image.ts registry-digest "$existing_manifest" "$EXPECTED_DIGEST" >/dev/null
elif ! grep -Eqi 'manifest unknown|name unknown|MANIFEST_UNKNOWN|NAME_UNKNOWN' "$existing_error"; then
    cat "$existing_error" >&2
    exit 1
fi
for tag in "$immutable_tag" dev; do
    skopeo copy --all --preserve-digests --authfile "$authfile" \
        "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" "docker://$image:$tag"
    skopeo inspect --authfile "$authfile" --raw "docker://$image:$tag" > "$existing_manifest"
    remote_digest=$(bun --no-env-file .github/scripts/deploy/dev-image.ts registry-digest "$existing_manifest" "$EXPECTED_DIGEST")
    if [[ "$tag" == dev ]]; then
        export REMOTE_DEV_DIGEST="$remote_digest"
    else
        export REMOTE_IMMUTABLE_DIGEST="$remote_digest"
    fi
done
bun --no-env-file .github/scripts/deploy/dev-image.ts published
printf 'Published %s@%s (linux/amd64), tags %s and dev.\n' "$image" "$EXPECTED_DIGEST" "$immutable_tag"
