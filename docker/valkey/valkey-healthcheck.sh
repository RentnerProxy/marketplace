#!/bin/sh
set -eu

reply=$(VALKEYCLI_AUTH="$VALKEY_PASSWORD" valkey-cli --raw ping)
[ "$reply" = PONG ]
