#!/usr/bin/env bash
set -euo pipefail
config_path="$(cd "$(dirname "$0")/../../.." && pwd)/.gitleaks.toml"
valid_sha() { [[ "$1" =~ ^[a-f0-9]{40}$ ]]; }
case "$EVENT_NAME" in
    pull_request)
        valid_sha "$PR_BASE_SHA" && valid_sha "$PR_HEAD_SHA"
        scan_log_opts="-m ${PR_BASE_SHA}..${PR_HEAD_SHA}"
        ;;
    push)
        valid_sha "$PUSH_AFTER_SHA"
        if [[ "$PUSH_BEFORE_SHA" == 0000000000000000000000000000000000000000 ]]; then
            scan_log_opts="-m $PUSH_AFTER_SHA"
        else
            valid_sha "$PUSH_BEFORE_SHA"
            scan_log_opts="-m ${PUSH_BEFORE_SHA}..${PUSH_AFTER_SHA}"
        fi
        ;;
    workflow_dispatch) scan_log_opts='-m --all' ;;
    *) exit 1 ;;
esac
# Never load a PR-controlled allowlist or publish raw finding artifacts.
"$RUNNER_TEMP/gitleaks" git --config="$config_path" --gitleaks-ignore-path=/dev/null \
    --redact=100 --no-banner --no-color --log-opts="$scan_log_opts" .
