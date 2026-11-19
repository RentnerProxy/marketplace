#!/usr/bin/env bash
set -euo pipefail
bash .github/scripts/release/validate-tag.sh
bun --no-env-file .github/scripts/release/release-blog.ts
bun --no-env-file .github/scripts/release/release-identity.ts image-id
image="ghcr.io/rentnerproxy/marketplace:$RELEASE_TAG"
channel=$(bun --no-env-file .github/scripts/release/release-identity.ts)
channel_image="ghcr.io/rentnerproxy/marketplace:$channel"
auth_directory=$(mktemp -d "$RUNNER_TEMP/marketplace-auth.XXXXXXXX")
trap 'rm -rf -- "$auth_directory"' EXIT
export DOCKER_CONFIG="$auth_directory"
printf '%s' "$GH_TOKEN" | docker login ghcr.io --username "$REGISTRY_ACTOR" --password-stdin >/dev/null
# A published version tag may be retried only with the identical image configuration.
if docker manifest inspect "$image" > "$auth_directory/manifest.json" 2> "$auth_directory/manifest-error"; then
    bun --no-env-file .github/scripts/release/release-identity.ts existing-image "$auth_directory/manifest.json"
else
    if ! grep -Eqi 'manifest unknown|no such manifest|name unknown' "$auth_directory/manifest-error"; then
        printf '%s\n' 'Could not verify version image availability; refusing publication.' >&2
        exit 1
    fi
    docker tag "$IMAGE_ID" "$image"
    docker push "$image"
fi
# Move the appropriate channel only after the immutable version has been published.
docker tag "$IMAGE_ID" "$channel_image"
docker push "$channel_image"
digest=$(docker buildx imagetools inspect "$image" --format '{{.Manifest.Digest}}')
channel_digest=$(docker buildx imagetools inspect "$channel_image" --format '{{.Manifest.Digest}}')
reference=$(bun --no-env-file .github/scripts/release/release-identity.ts published-image "$digest" "$channel_digest")
printf 'image=%s\n' "$reference" >> "$GITHUB_OUTPUT"
printf 'Published tested appliance: %s (%s, %s)\n' "$image" "$channel" "$digest" >> "$GITHUB_STEP_SUMMARY"
