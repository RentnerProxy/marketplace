#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
image="hybrid-core-integration:verify-$$"
trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT
docker build --target core-integration \
    --build-context integration-web=./web \
    --build-arg APP_VERSION=ci-test \
    --tag "$image" .
docker run --rm --network none "$image"
