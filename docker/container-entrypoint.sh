#!/bin/sh
set -eu

case "${1:-start}" in
    start|maintenance)
        exec marketplace-appliance "${1:-start}"
        ;;
    *)
        exec su-exec bun:bun "$@"
        ;;
esac
