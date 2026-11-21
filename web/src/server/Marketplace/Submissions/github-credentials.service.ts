import { createPrivateKey } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { SignJWT } from 'jose'
import { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import { githubJson } from './github.service.ts'

const appConfig = z.object({
    clientId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/u),
    installationId: z.string().regex(/^[1-9][0-9]{0,15}$/u),
    privateKeyFile: z.string().max(4096).refine(isAbsolute),
})
type AppConfig = z.infer<typeof appConfig>

const tokenResponse = z.object({
    token: z.string().regex(/^[!-~]{1,8192}$/u),
    expires_at: z.iso.datetime({ offset: true }),
})
const maxKeyBytes = 8192
const refreshBeforeExpiryMs = 60_000

type InstallationToken = { token: string; expiresAt: number }
let appSession:
    | {
          identity: string
          current?: InstallationToken
          refresh?: Promise<InstallationToken>
      }
    | undefined

function candidateCredentials() {
    const clientId =
        process.env.MARKETPLACE_CANDIDATE_GITHUB_APP_CLIENT_ID?.trim()
    const installationId =
        process.env.MARKETPLACE_CANDIDATE_GITHUB_APP_INSTALLATION_ID?.trim()
    const privateKeyFile =
        process.env.MARKETPLACE_CANDIDATE_GITHUB_APP_PRIVATE_KEY_FILE?.trim()
    if (clientId || installationId || privateKeyFile) {
        const app = appConfig.safeParse({
            clientId,
            installationId,
            privateKeyFile,
        })
        return app.success ? { app: app.data } : undefined
    }
    const token = process.env.MARKETPLACE_CANDIDATE_GITHUB_TOKEN?.trim()
    return token ? { token } : undefined
}

export function candidateBuildsConfigured() {
    return candidateCredentials() !== undefined
}

export function publicRepositoryGitHubToken() {
    // The builder installation is scoped to Marketplace Actions.
    return candidateCredentials()?.token
}

async function signAppAssertion(config: AppConfig) {
    try {
        const pem = await Bun.file(config.privateKeyFile)
            .slice(0, maxKeyBytes + 1)
            .arrayBuffer()
        if (pem.byteLength > maxKeyBytes)
            throw new Error('Key exceeds its byte budget')
        const key = createPrivateKey(Buffer.from(pem))
        const now = Math.floor(Date.now() / 1000)
        return await new SignJWT()
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuer(config.clientId)
            .setIssuedAt(now - 60)
            .setExpirationTime(now + 300)
            .sign(key)
    } catch {
        throw new Error('GitHub App private key is unavailable or invalid')
    }
}

async function issueInstallationToken(
    config: AppConfig,
): Promise<InstallationToken> {
    const assertion = await signAppAssertion(config)
    const response = tokenResponse.safeParse(
        await githubJson(
            `/app/installations/${config.installationId}/access_tokens`,
            {
                token: assertion,
                input: {
                    repository_ids: [Number(pipeline.repositoryId)],
                    permissions: { actions: 'write' },
                },
            },
        ),
    )
    if (!response.success)
        throw new Error('Invalid GitHub installation token response')
    const expiresAt = Date.parse(response.data.expires_at)
    if (!(expiresAt > Date.now() + refreshBeforeExpiryMs)) {
        throw new Error('GitHub installation token expires too soon')
    }
    return { token: response.data.token, expiresAt }
}

export async function candidateGitHubToken() {
    const credentials = candidateCredentials()
    if (!credentials?.app) return credentials?.token

    const { app } = credentials
    const identity = JSON.stringify([
        app.clientId,
        app.installationId,
        app.privateKeyFile,
    ])
    if (appSession?.identity !== identity) appSession = { identity }
    const session = appSession
    if (
        session.current &&
        session.current.expiresAt > Date.now() + refreshBeforeExpiryMs
    ) {
        return session.current.token
    }
    session.refresh ??= issueInstallationToken(app)
        .then((current) => {
            session.current = current
            return current
        })
        .finally(() => {
            session.refresh = undefined
        })
    return (await session.refresh).token
}
