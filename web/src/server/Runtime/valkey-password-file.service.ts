/* oxlint-disable no-await-in-loop -- Wait only for the atomic credential bootstrap, without requiring a healthy Valkey server. */
import {
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    openSync,
    readFileSync,
} from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import type { Environment } from './Types/environment.types.ts'
import { optionalEnvironmentValue } from './environment-schema.service.ts'

const maximumPasswordFileBytes = 16_386
const passwordFileSchema = optionalEnvironmentValue.pipe(
    z
        .string()
        .max(4_096)
        .refine(
            (value) => isAbsolute(value) && !hasControlCharacters(value),
            'VALKEY_PASSWORD_FILE muss ein absoluter Pfad ohne Steuerzeichen sein.',
        )
        .optional(),
)

export function readValkeyPasswordFileService(value: unknown) {
    const path = passwordFileSchema.parse(value)
    if (!path) return undefined

    try {
        if (!lstatSync(path).isFile())
            throw new Error('Invalid credential file')
        const descriptor = openSync(
            path,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        )
        try {
            const entry = fstatSync(descriptor)
            if (!entry.isFile() || entry.size > maximumPasswordFileBytes) {
                throw new Error('Invalid credential file')
            }
            const contents = readFileSync(descriptor)
            if (contents.length > maximumPasswordFileBytes) {
                throw new Error('Invalid credential file')
            }
            return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
                .decode(contents)
                .replace(/\r?\n$/u, '')
        } finally {
            closeSync(descriptor)
        }
    } catch {
        throw new Error(
            'VALKEY_PASSWORD_FILE muss eine lesbare, reguläre UTF-8-Datei mit begrenzter Größe sein.',
        )
    }
}

export async function waitForValkeyPasswordFileService(
    environment: Environment = process.env,
    timeoutMs = 30_000,
) {
    if (environment.VALKEY_PASSWORD) return
    const path = passwordFileSchema.parse(environment.VALKEY_PASSWORD_FILE)
    if (!path) return

    const deadline = Date.now() + timeoutMs
    while (true) {
        try {
            lstatSync(path)
            readValkeyPasswordFileService(path)
            return
        } catch (error) {
            if (
                !(error instanceof Error) ||
                !('code' in error) ||
                error.code !== 'ENOENT'
            ) {
                // oxlint-disable-next-line preserve-caught-error -- Keep filesystem details out of the secret boundary error.
                throw new Error(
                    'VALKEY_PASSWORD_FILE konnte nicht geladen werden.',
                )
            }
        }
        if (Date.now() >= deadline) {
            throw new Error(
                'VALKEY_PASSWORD_FILE wurde beim Start nicht rechtzeitig bereitgestellt.',
            )
        }
        await Bun.sleep(100)
    }
}
