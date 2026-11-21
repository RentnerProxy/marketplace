#!/usr/bin/env bash
set -euo pipefail

mdm_file=/var/lib/cloudflare-warp/mdm.xml

disconnect() {
    sudo rm -f -- "$mdm_file"
    if command -v warp-cli >/dev/null; then
        if ! sudo warp-cli --accept-tos registration delete >/dev/null 2>&1; then
            echo '::warning::WARP did not confirm removal of the runner registration'
        fi
        sudo systemctl stop warp-svc
    fi
}

connect() {
    local team=${APP_CATALOG_WARP_TEAM:-}
    local vnet=${APP_CATALOG_WARP_VNET:-}
    local client_id=${APP_CATALOG_WARP_CLIENT_ID:-}
    local client_secret=${APP_CATALOG_WARP_CLIENT_SECRET:-}
    if [[ ! $team =~ ^[a-z0-9][a-z0-9-]{0,62}$ || ! $client_id =~ ^[a-zA-Z0-9._-]+$ || ! $client_secret =~ ^[a-zA-Z0-9._-]+$ || ! $vnet =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ ]]; then
        echo 'Invalid or missing Cloudflare publisher enrollment configuration' >&2
        exit 1
    fi

    local package="$RUNNER_TEMP/rentnerproxy-cloudflare-warp.deb"
    curl --fail --silent --show-error --proto '=https' --max-time 120 \
        --output "$package" \
        https://pkg.cloudflareclient.com/pool/noble/main/c/cloudflare-warp/cloudflare-warp_2026.8.2115.0_amd64.deb
    printf '%s  %s\n' 0209107860c3c6851a9ab8fd03690121a3dea3199b084f8197620072c671cd68 "$package" \
        | sha256sum --check --status
    sudo apt-get -o Acquire::Retries=3 update
    sudo apt-get install --yes --no-install-recommends "$package"

    sudo install -d -m 0700 "$(dirname -- "$mdm_file")"
    sudo install -m 0600 /dev/null "$mdm_file"
    sudo tee "$mdm_file" >/dev/null <<EOF
<dict>
    <key>auth_client_id</key>
    <string>$client_id</string>
    <key>auth_client_secret</key>
    <string>$client_secret</string>
    <key>auto_connect</key>
    <integer>1</integer>
    <key>onboarding</key>
    <false/>
    <key>organization</key>
    <string>$team</string>
</dict>
EOF
    sudo systemctl restart warp-svc

    local selected=false
    for _ in {1..30}; do
        if sudo warp-cli --accept-tos status 2>/dev/null | grep -Eq '^Status update: Connected[[:space:]]*$'; then
            if [[ $selected == true ]]; then
                echo 'Cloudflare publisher network connected'
                return
            fi
            if sudo warp-cli --accept-tos vnet "$vnet" >/dev/null 2>&1; then
                selected=true
            fi
        fi
        sleep 2
    done
    sudo warp-cli --accept-tos status >&2 || true
    echo 'Cloudflare publisher network did not connect' >&2
    exit 1
}

case "${1:-}" in
    connect) connect ;;
    disconnect) disconnect ;;
    *) echo 'Usage: warp.sh {connect|disconnect}' >&2; exit 2 ;;
esac
