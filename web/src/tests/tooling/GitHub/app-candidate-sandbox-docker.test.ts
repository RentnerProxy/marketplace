import { expect, spyOn, test } from 'bun:test'
import { withSandbox } from '../../../../../.github/scripts/ci/app-candidates/sandbox-docker.ts'

const options = {
    target: 'linux-amd64' as const,
    memoryMiB: 128,
    processLimit: 8,
    mounts: [],
    command: ['/usr/bin/true'],
}

test.each(['create', 'run'] as const)(
    'preserves the %s error and attempts cleanup when both operations fail',
    async (phase) => {
        const primaryError = new Error('Primary sandbox failure')
        const cleanupError = new Error('synthetic-sensitive-docker-output')
        const calls: [string, string][] = []
        const warning = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const result = withSandbox(
                options,
                async (name) => {
                    calls.push(['run', name])
                    throw primaryError
                },
                {
                    async create(name) {
                        calls.push(['create', name])
                        if (phase === 'create') throw primaryError
                    },
                    async remove(name) {
                        calls.push(['remove', name])
                        throw cleanupError
                    },
                },
            )
            await expect(result).rejects.toBe(primaryError)
            const name = calls[0][1]
            expect(calls.map(([operation]) => operation)).toEqual(
                phase === 'create'
                    ? ['create', 'remove']
                    : ['create', 'run', 'remove'],
            )
            expect(calls.every(([, container]) => container === name)).toBe(
                true,
            )
            expect(warning.mock.calls).toEqual([
                [`Candidate sandbox cleanup failed for ${name}.`],
            ])
        } finally {
            warning.mockRestore()
        }
    },
)

test('rejects an otherwise successful sandbox run when cleanup fails', async () => {
    await expect(
        withSandbox(options, async () => 'complete', {
            async create() {},
            async remove() {
                throw new Error('synthetic-sensitive-docker-output')
            },
        }),
    ).rejects.toThrow(
        /^Candidate sandbox cleanup failed for marketplace-candidate-[a-f0-9-]+\.$/,
    )
})
