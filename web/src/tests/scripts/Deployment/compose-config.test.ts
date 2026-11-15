import { describe, expect, it } from 'bun:test'
import { parseComposeConfigOutput } from '@/scripts/Deployment/compose-config.ts'

describe('rendered Docker Compose configuration', function () {
    it('restores literal credentials and shell commands through the same boundary', function () {
        const output = JSON.stringify({
            services: {
                app: {
                    environment: {
                        VALKEY_PASSWORD:
                            'synthetic $$() ; % "\' \\ unicode-ä-only',
                    },
                },
                valkey: {
                    command: [
                        'sh',
                        '-ec',
                        'hash=$$(printf %s "$$VALKEY_PASSWORD")',
                    ],
                    healthcheck: {
                        test: [
                            'CMD-SHELL',
                            'reply=$$(valkey-cli ping) && [ "$$reply" = PONG ]',
                        ],
                    },
                },
            },
        })

        expect(parseComposeConfigOutput(output)).toEqual({
            services: {
                app: {
                    environment: {
                        VALKEY_PASSWORD:
                            'synthetic $() ; % "\' \\ unicode-ä-only',
                    },
                },
                valkey: {
                    command: [
                        'sh',
                        '-ec',
                        'hash=$(printf %s "$VALKEY_PASSWORD")',
                    ],
                    healthcheck: {
                        test: [
                            'CMD-SHELL',
                            'reply=$(valkey-cli ping) && [ "$reply" = PONG ]',
                        ],
                    },
                },
            },
        })
    })

    it.each([
        ['$$', '$'],
        ['$$$$', '$$'],
        ['$$$$$$', '$$$'],
        ['$${NAME}', '${NAME}'],
        ['$$NAME', '$NAME'],
        ['$$(command)', '$(command)'],
        ['plain "quotes" \\ ü\n', 'plain "quotes" \\ ü\n'],
    ])(
        'decodes %s exactly once without expanding its value',
        function (rendered, expected) {
            expect(
                parseComposeConfigOutput(
                    JSON.stringify({ password: rendered }),
                ),
            ).toEqual({
                password: expected,
            })
        },
    )

    it('also restores map keys and preserves non-string values', function () {
        expect(
            parseComposeConfigOutput('{"$$label":[false,0,null,"$$$$"]}'),
        ).toEqual({
            $label: [false, 0, null, '$$'],
        })
    })

    it('rejects malformed JSON instead of silently changing the result', function () {
        expect(() => parseComposeConfigOutput('{"password":')).toThrow(
            SyntaxError,
        )
    })
})
