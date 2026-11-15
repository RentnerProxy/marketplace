import { afterEach, describe, expect, it, vi } from 'bun:test'
import { TWO_FACTOR_SETUP_DURATION_MS } from '@/config/security.config.ts'
import {
    encryptAuthSecret,
    decryptAuthSecret,
} from '@/lib/Auth/secretEncryption.ts'
import {
    createPendingTwoFactorSetup,
    readPendingTwoFactorSetup,
} from '@/server/UserSettings/Security/two-factor-setup.service.ts'

vi.mock('@/server/Runtime/environment.service.ts', function () {
    return {
        getRequiredServerEnvironment: function () {
            return 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
        },
    }
})

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const SESSION_HASH = 'a'.repeat(64)
const CREDENTIAL_VERSION = 'c'.repeat(64)

afterEach(function () {
    vi.restoreAllMocks()
})

describe('TOTP setup authorization', function () {
    it('accepts an authenticated pending secret only for its user, session and token', async function () {
        const pending = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        expect(pending.encryptedSetup).not.toContain(SECRET)
        expect(pending.encryptedSetup).not.toContain(pending.setupToken)
        expect(
            await readPendingTwoFactorSetup(
                pending.encryptedSetup,
                pending.setupToken,
                'user-1',
                SESSION_HASH,
            ),
        ).toMatchObject({
            secret: SECRET,
            credentialVersion: CREDENTIAL_VERSION,
            purpose: 'two-factor-setup-v2',
        })
        expect(
            await readPendingTwoFactorSetup(
                pending.encryptedSetup,
                pending.setupToken,
                'user-2',
                SESSION_HASH,
            ),
        ).toBeNull()
        expect(
            await readPendingTwoFactorSetup(
                pending.encryptedSetup,
                pending.setupToken,
                'user-1',
                'b'.repeat(64),
            ),
        ).toBeNull()
        expect(
            await readPendingTwoFactorSetup(
                pending.encryptedSetup,
                crypto.randomUUID(),
                'user-1',
                SESSION_HASH,
            ),
        ).toBeNull()
    })

    it('rejects the token of an earlier setup even within the same session', async function () {
        const first = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        const second = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        expect(
            await readPendingTwoFactorSetup(
                second.encryptedSetup,
                first.setupToken,
                'user-1',
                SESSION_HASH,
            ),
        ).toBeNull()
    })

    it('rejects the proof at its expiry boundary', async function () {
        const now = 1_800_000_000_000
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
        const pending = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        clock.mockReturnValue(now + TWO_FACTOR_SETUP_DURATION_MS - 1)
        expect(
            await readPendingTwoFactorSetup(
                pending.encryptedSetup,
                pending.setupToken,
                'user-1',
                SESSION_HASH,
            ),
        ).not.toBeNull()
        clock.mockReturnValue(now + TWO_FACTOR_SETUP_DURATION_MS)
        expect(
            await readPendingTwoFactorSetup(
                pending.encryptedSetup,
                pending.setupToken,
                'user-1',
                SESSION_HASH,
            ),
        ).toBeNull()
    })

    it('rejects old seeds and plaintext JSON even if the legacy decoder accepts them', async function () {
        const pending = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        const plaintext = await decryptAuthSecret(pending.encryptedSetup)
        await Promise.all(
            [SECRET, await encryptAuthSecret(SECRET), plaintext].map(
                async function (value) {
                    expect(
                        await readPendingTwoFactorSetup(
                            value,
                            pending.setupToken,
                            'user-1',
                            SESSION_HASH,
                        ),
                    ).toBeNull()
                },
            ),
        )
    })

    it('rejects modified ciphertext and additional envelope segments', async function () {
        const pending = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        const parts = pending.encryptedSetup.split('.')
        const ciphertext = Buffer.from(parts[2], 'base64url')
        ciphertext[0] = ciphertext[0]! ^ 1
        parts[2] = ciphertext.toString('base64url')
        await Promise.all(
            [parts.join('.'), pending.encryptedSetup + '.ignored'].map(
                async function (value) {
                    expect(
                        await readPendingTwoFactorSetup(
                            value,
                            pending.setupToken,
                            'user-1',
                            SESSION_HASH,
                        ),
                    ).toBeNull()
                },
            ),
        )
    })

    it('rejects unknown purposes and additional metadata', async function () {
        const pending = await createPendingTwoFactorSetup(
            SECRET,
            'user-1',
            SESSION_HASH,
            CREDENTIAL_VERSION,
        )
        const plaintext = await decryptAuthSecret(pending.encryptedSetup)
        const changes = [
            plaintext.replace('two-factor-setup-v2', 'two-factor-setup-v1'),
            JSON.stringify({ ...JSON.parse(plaintext), unexpected: true }),
        ]
        await Promise.all(
            changes.map(async function (value) {
                expect(
                    await readPendingTwoFactorSetup(
                        await encryptAuthSecret(value),
                        pending.setupToken,
                        'user-1',
                        SESSION_HASH,
                    ),
                ).toBeNull()
            }),
        )
    })
})
