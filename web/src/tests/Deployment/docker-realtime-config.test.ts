import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'bun:test'

const instructions = (
    await readFile(new URL('../../../../Dockerfile', import.meta.url), 'utf8')
)
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())

function dockerStage(name: string) {
    const start = instructions.findIndex((line) =>
        new RegExp('^FROM\\s+\\S+\\s+AS\\s+' + name + '$', 'i').test(line),
    )
    if (start < 0) throw new Error('Missing expected Docker stage')
    const next = instructions.findIndex(
        (line, index) => index > start && /^FROM\s/i.test(line),
    )
    return instructions.slice(start, next < 0 ? undefined : next)
}

describe('shared public WebSocket build and runtime configuration', function () {
    it.each(['builder', 'runner'])(
        'keeps the optional public URL argument authoritative in the %s stage',
        function (name) {
            const stage = dockerStage(name)
            const argument = stage.indexOf('ARG VITE_REALTIME_WS_URL=')
            const declarations = stage.filter((line) =>
                /^ARG VITE_REALTIME_WS_URL(?:=|$)/.test(line),
            )
            expect(argument).toBeGreaterThanOrEqual(0)
            expect(declarations).toEqual(['ARG VITE_REALTIME_WS_URL='])

            const environmentLines = stage.filter((line) =>
                line.startsWith('ENV '),
            )
            const assignments = environmentLines
                .flatMap((line) => line.slice(4).split(/\s+/))
                .filter((assignment) =>
                    assignment.startsWith('VITE_REALTIME_WS_URL='),
                )
            expect(assignments).toEqual([
                'VITE_REALTIME_WS_URL=$VITE_REALTIME_WS_URL',
            ])
            const environment = stage.findIndex(
                (line) =>
                    line.startsWith('ENV ') &&
                    line.includes('VITE_REALTIME_WS_URL='),
            )
            expect(environment).toBeGreaterThan(argument)
            const execution = stage.findIndex((line) =>
                name === 'builder'
                    ? line === 'RUN bun run build'
                    : line.startsWith('CMD '),
            )
            expect(execution).toBeGreaterThan(environment)
        },
    )

    it('does not introduce the public browser setting into dependency-install stages', function () {
        for (const stage of ['deps', 'production-deps']) {
            expect(
                dockerStage(stage).some((line) =>
                    line.includes('VITE_REALTIME_WS_URL'),
                ),
            ).toBe(false)
        }
    })
})
