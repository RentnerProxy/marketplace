import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
    resolve: { tsconfigPaths: true },
    publicDir: 'web/public',

    server: {
        watch: {
            // Large generated trees can stall Nitro's initial module load on Windows.
            ignored: ['**/.tools/**', '**/core/target/**'],
        },
    },

    optimizeDeps: {
        exclude: ['bun', 'bun:ffi'],
    },

    build: {
        rollupOptions: {
            external: ['bun', 'bun:ffi'],
        },
    },
    nitro: {
        preset: 'bun',
        serverEntry: './web/src/server/Runtime/nitro-server-entry.ts',
    },
    plugins: [
        devtools({
            // Die Server-Event-Bridge blockiert Nitros Modultransport unter Bun.
            eventBusConfig: { enabled: false },
        }),
        {
            name: 'strip-form-devtools',
            apply: 'build',
            transform(_code, id) {
                // Form Core imports its diagnostics even in production builds.
                return id.endsWith(
                    '/@tanstack/form-core/dist/esm/EventClient.js',
                )
                    ? 'export const formEventClient = { emit() {}, on() { return () => {} } }'
                    : null
            },
        },
        nitro({
            publicAssets: [{ dir: 'web/public' }],
            plugins: [
                './web/src/server/Runtime/core-worker-lifecycle.service.ts',
                './web/src/server/Runtime/backup-request-timeout.service.ts',
            ],
            routes: {
                '/api/user/background':
                    './web/src/server/Runtime/user-background-route.service.ts',
            },
            rollupConfig: {
                external: [
                    // WebAuthn must load the Reflect polyfill before X.509.
                    '@simplewebauthn/server',
                    'bun',
                    'bun:ffi',
                ],
            },
        }),
        tailwindcss(),
        tanstackStart({ srcDirectory: 'web/src' }),
        viteReact(),
    ],
})

export default config
