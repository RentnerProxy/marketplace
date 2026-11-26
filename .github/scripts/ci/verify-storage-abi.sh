#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."
expected_storage_abi="$(bun --no-env-file -e '
    import { CORE_RUNTIME } from "./web/src/config/core.config.ts";
    console.log(CORE_RUNTIME.storageFfi.abiVersion);
')"

docker run --rm --network none --env "EXPECTED_STORAGE_ABI=$expected_storage_abi" \
    --entrypoint bun "$RUNTIME_IMAGE_ID" -e '
    import { dlopen, FFIType } from "bun:ffi";
    const expected = process.env.EXPECTED_STORAGE_ABI;
    const library = dlopen("/usr/local/bin/libmarketplace_storage.so", {
        marketplace_storage_abi_version: { returns: FFIType.u32 },
    });
    try {
        const actual = library.symbols.marketplace_storage_abi_version();
        if (String(actual) !== expected)
            throw new Error(`Incompatible native storage ABI (expected ${expected}, got ${actual})`);
    } finally {
        library.close();
    }
'
