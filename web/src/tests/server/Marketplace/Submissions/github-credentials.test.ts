import { afterEach, beforeEach, expect, test, vi } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jwtVerify } from 'jose'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import {
    candidateBuildsConfigured,
    candidateGitHubToken,
    publicRepositoryGitHubToken,
} from '@/server/Marketplace/Submissions/github-credentials.service.ts'
import { readPublicRepository } from '@/server/Marketplace/Submissions/ownership.service.ts'

const client = 'MARKETPLACE_CANDIDATE_GITHUB_APP_CLIENT_ID'
const installation = 'MARKETPLACE_CANDIDATE_GITHUB_APP_INSTALLATION_ID'
const keyFile = 'MARKETPLACE_CANDIDATE_GITHUB_APP_PRIVATE_KEY_FILE'
const legacy = 'MARKETPLACE_CANDIDATE_GITHUB_TOKEN'
const settings = [client, installation, keyFile, legacy]
const original = settings.map((key) => [key, process.env[key]] as const)
const clientId = 'Iv1.fixture-builder'
const installationId = '123456789'
const exchangeUrl = `https://api.github.com/app/installations/${installationId}/access_tokens`
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
})
const now = 1_800_000_000_000
let directory: string | undefined

beforeEach(() => {
    for (const key of settings) delete process.env[key]
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const [key, value] of original) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    if (directory) {
        await rm(directory, { recursive: true, force: true })
        directory = undefined
    }
})

async function configureApp(
    pem = privateKey.export({ type: 'pkcs1', format: 'pem' }),
) {
    directory = await mkdtemp(join(tmpdir(), 'candidate-builder-'))
    const path = join(directory, 'builder.pem')
    await writeFile(path, pem, { mode: 0o600 })
    process.env[client] = clientId
    process.env[installation] = installationId
    process.env[keyFile] = path
}

function installationToken(token: string, lifetime = 3_600_000) {
    return Response.json({
        token,
        expires_at: new Date(Date.now() + lifetime).toISOString(),
    })
}

function mockGitHub(
    handler: (...args: Parameters<typeof fetch>) => Promise<Response>,
) {
    return vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
            Object.assign(handler, { preconnect: fetch.preconnect }),
        )
}

test('shares one scoped exchange and renews the token before expiry', async () => {
    await configureApp()
    process.env[legacy] = 'unused-legacy-fixture'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    let exchanges = 0
    const fetcher = mockGitHub(async (url, init) => {
        expect(url).toBe(exchangeUrl)
        expect(init?.method).toBe('POST')
        expect(init?.redirect).toBe('error')
        const body: unknown = JSON.parse(String(init?.body))
        expect(body).toEqual({
            repository_ids: [Number(pipeline.repositoryId)],
            permissions: { actions: 'write' },
        })
        const authorization =
            new Headers(init?.headers).get('authorization') ?? ''
        expect(authorization.startsWith('Bearer ')).toBe(true)
        const { payload } = await jwtVerify(authorization.slice(7), publicKey, {
            algorithms: ['RS256'],
            issuer: clientId,
            currentDate: new Date(Date.now()),
        })
        const second = Date.now() / 1000
        expect(payload.iat).toBe(second - 60)
        expect(payload.exp).toBe(second + 300)
        exchanges += 1
        return installationToken(`fixture-installation-${exchanges}`)
    })

    expect(candidateBuildsConfigured()).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    expect(
        await Promise.all([candidateGitHubToken(), candidateGitHubToken()]),
    ).toEqual(['fixture-installation-1', 'fixture-installation-1'])
    clock.mockReturnValue(now + 3_539_000)
    expect(await candidateGitHubToken()).toBe('fixture-installation-1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(now + 3_540_000)
    expect(await candidateGitHubToken()).toBe('fixture-installation-2')
    expect(fetcher).toHaveBeenCalledTimes(2)
})

test('keeps public repository requests separate from a cached installation token', async () => {
    await configureApp()
    const repository = 'RentnerProxy/app-greeting'
    const fetcher = mockGitHub((url, init) => {
        if (url === exchangeUrl)
            return Promise.resolve(installationToken('fixture-installation'))
        expect(url).toBe(`https://api.github.com/repos/${repository}`)
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        return Promise.resolve(
            Response.json({
                id: 123,
                full_name: repository,
                private: false,
                owner: { id: 456 },
            }),
        )
    })
    expect(await candidateGitHubToken()).toBe('fixture-installation')
    expect(await readPublicRepository(repository)).toEqual({
        repository,
        repositoryId: '123',
        ownerId: '456',
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
})

test('does not use the legacy token if App settings are incomplete', async () => {
    expect(candidateBuildsConfigured()).toBe(false)
    expect(await candidateGitHubToken()).toBeUndefined()
    process.env[legacy] = ' legacy-fixture '
    expect(candidateBuildsConfigured()).toBe(true)
    expect(await candidateGitHubToken()).toBe('legacy-fixture')
    expect(publicRepositoryGitHubToken()).toBe('legacy-fixture')

    process.env[client] = clientId
    expect(candidateBuildsConfigured()).toBe(false)
    expect(await candidateGitHubToken()).toBeUndefined()
    expect(publicRepositoryGitHubToken()).toBeUndefined()
})

test('retries a failed exchange without caching the invalid token', async () => {
    await configureApp()
    const fetcher = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(installationToken('expired-fixture', -1))
        .mockResolvedValueOnce(installationToken('fresh-fixture'))
    await expect(candidateGitHubToken()).rejects.toThrow('expires too soon')
    expect(await candidateGitHubToken()).toBe('fresh-fixture')
    expect(fetcher).toHaveBeenCalledTimes(2)
})

test('rejects oversized key files before sending a credential to GitHub', async () => {
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' })
    await configureApp(pem + ' '.repeat(8192))
    const fetcher = vi.spyOn(globalThis, 'fetch')
    await expect(candidateGitHubToken()).rejects.toThrow(
        'private key is unavailable or invalid',
    )
    expect(fetcher).not.toHaveBeenCalled()
})
