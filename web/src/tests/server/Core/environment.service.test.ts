import { expect, it } from 'bun:test'
import { getCoreCommandEnvironmentService } from '@/server/Core/environment.service.ts'

it('passes the platform temp and PostgreSQL discovery paths through the Core allowlist', function () {
    const { TMPDIR, ProgramFiles, NODE_OPTIONS } = process.env
    try {
        process.env.TMPDIR = '/tmp/core-fixture'
        process.env.ProgramFiles = 'D:\\Program Files'
        process.env.NODE_OPTIONS = 'synthetic-parent-setting'

        const environment = getCoreCommandEnvironmentService()
        expect(environment.TMPDIR).toBe('/tmp/core-fixture')
        expect(environment.ProgramFiles).toBe('D:\\Program Files')
        expect(environment).not.toHaveProperty('NODE_OPTIONS')
    } finally {
        for (const [key, value] of Object.entries({
            TMPDIR,
            ProgramFiles,
            NODE_OPTIONS,
        })) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
})
