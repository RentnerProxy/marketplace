import { beforeEach, describe, expect, it, vi } from 'bun:test'
import path from 'node:path'
import type { CoreCommandOptions } from '@/server/Core/Types/core.types.ts'

const command = vi.fn(async function (
    _binary: string,
    _request: Record<string, unknown>,
    _options?: CoreCommandOptions,
): Promise<unknown> {
    return ''
})
vi.mock('@/server/Core/command.service.ts', function () {
    return { runCoreCommandService: command }
})
vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})
import { createPrivateTempDirectory } from '@/server/Admin/Backups/archive-files.service.ts'

beforeEach(function () {
    command.mockReset()
})

describe('native temporary directory reply', function () {
    it('akzeptiert ausschließlich den angeforderten privaten Elternpfad und UUID-Präfix', async function () {
        const parent = path.resolve('/synthetic/private')
        const prefix = '.restore-'
        const name = `${prefix}00000000-0000-4000-8000-000000000040`
        const directory = path.join(parent, name)
        command.mockResolvedValue(directory)
        await createPrivateTempDirectory(parent, prefix)
        const validate = command.mock.calls[0]?.[2]?.validateResult
        if (!validate) throw new Error('Missing result validator')
        expect(validate(directory)).toBe(directory)
        for (const result of [
            null,
            { path: directory },
            '../outside',
            path.resolve('/outside', name),
            path.join(parent, '.other-00000000-0000-4000-8000-000000000040'),
            path.join(parent, `${prefix}invalid`),
            `${directory}\0`,
        ]) {
            expect(function () {
                validate(result)
            }).toThrow()
        }
    })
})
