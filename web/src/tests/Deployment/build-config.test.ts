import { expect, it } from 'bun:test'

const root = new URL('../../../../', import.meta.url)

it('builds with Bun and fixes the Nitro runtime preset', async function () {
    const manifest = await Bun.file(new URL('package.json', root)).json()
    const config = await Bun.file(new URL('vite.config.ts', root)).text()
    expect(manifest.scripts.build).toBe('bunx --bun vite build')
    expect(config).toMatch(/nitro:\s*\{\s*preset: 'bun'/u)
    expect(config).not.toContain('@sentry')
    expect(config).not.toContain('@aws-sdk/client-s3')
})

it('uses the Vite public directory in development and keeps generated directories out of typechecking', async function () {
    const config = await Bun.file(new URL('tsconfig.json', root)).json()
    const environment = await Bun.file(new URL('.env.dev.example', root)).text()
    expect(environment).toMatch(/^APP_STORAGE_DIR=\.\/web\/public$/mu)
    expect(config.compilerOptions.target).toBe('ES2024')
    expect(config.compilerOptions.lib).toContain('ES2024')
    expect(config.exclude).toEqual(
        expect.arrayContaining([
            '.output',
            '.tools',
            '.tanstack',
            '.nitro',
            'dist',
            'web/drizzle',
        ]),
    )
})
