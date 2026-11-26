#!/bin/sh
set -eu

if [ "${1#-}" != "$1" ]; then
    set -- valkey-server "$@"
fi

if [ "$1" = valkey-server ]; then
    umask 077
    : "${VALKEY_PASSWORD:?VALKEY_PASSWORD is required}"
    password_hash=$(printf '%s' "$VALKEY_PASSWORD" | sha256sum)
    printf 'user default reset on #%s ~* &* +@all\n' "${password_hash%% *}" > /run/marketplace/valkey/valkey.conf
    unset VALKEY_PASSWORD
    shift
    set -- valkey-server /run/marketplace/valkey/valkey.conf \
        --bind 127.0.0.1 --protected-mode yes \
        --save "" \
        --maxmemory 256mb --maxmemory-policy noeviction "$@"
fi

exec "$@"
