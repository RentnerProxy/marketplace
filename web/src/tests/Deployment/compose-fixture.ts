import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export async function readComposeFixture() {
    const source = await readFile(
        new URL('../../../../docker-compose.yml', import.meta.url),
        'utf8',
    )
    return z.record(z.string(), z.unknown()).parse(Bun.YAML.parse(source))
}

export async function readValkeyStartupFixture() {
    return readFile(
        new URL(
            '../../../../docker/valkey/valkey-entrypoint.sh',
            import.meta.url,
        ),
        'utf8',
    )
}

export async function readValkeyHealthcheckFixture() {
    return readFile(
        new URL(
            '../../../../docker/valkey/valkey-healthcheck.sh',
            import.meta.url,
        ),
        'utf8',
    )
}
