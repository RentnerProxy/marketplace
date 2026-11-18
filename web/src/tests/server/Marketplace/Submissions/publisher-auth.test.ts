import { expect, test } from 'bun:test'
import { generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import {
    catalogPublisherAudience,
    catalogPublisherEnvironment,
    catalogPublisherWorkflow,
} from '@/lib/Marketplace/catalogPublication.ts'
import {
    authenticateCatalogPublisherService,
    PublisherAuthenticationError,
} from '@/server/Marketplace/Submissions/publisher-auth.service.ts'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const workflowRef = `${pipeline.repository}/${catalogPublisherWorkflow}@refs/heads/main`
const workflowCommit = 'a'.repeat(40)

async function signedRequest(changes: JWTPayload = {}) {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
        iss: 'https://token.actions.githubusercontent.com',
        aud: catalogPublisherAudience,
        iat: now,
        nbf: now - 1,
        exp: now + 300,
        repository: pipeline.repository,
        repository_id: pipeline.repositoryId,
        repository_owner_id: pipeline.officialOwnerId,
        ref: 'refs/heads/main',
        environment: catalogPublisherEnvironment,
        event_name: 'schedule',
        workflow_ref: workflowRef,
        workflow_sha: workflowCommit,
        run_id: '18234567890',
        run_attempt: '2',
        ...changes,
    })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .sign(privateKey)
    return new Request('https://marketplace.example.test', {
        headers: { authorization: `Bearer ${token}` },
    })
}

test('derives the publication run from a verified protected-job identity', async () => {
    const request = await signedRequest()
    expect(
        await authenticateCatalogPublisherService(request, () => publicKey),
    ).toEqual({
        repositoryId: pipeline.repositoryId,
        workflowCommit,
        workflowPath: catalogPublisherWorkflow,
        runId: '18234567890',
        attempt: 2,
    })
})

test.each([
    ['wrong issuer', { iss: 'https://github.example.test' }],
    ['wrong audience', { aud: 'different-service' }],
    [
        'mixed audiences',
        { aud: [catalogPublisherAudience, 'different-service'] },
    ],
    ['wrong repository ID', { repository_id: '12' }],
    ['wrong owner ID', { repository_owner_id: '12' }],
    ['wrong branch', { ref: 'refs/heads/untrusted' }],
    ['wrong environment', { environment: 'preview' }],
    [
        'wrong workflow',
        {
            workflow_ref: workflowRef.replace(
                'app-catalog-publish',
                'app-candidate-review',
            ),
        },
    ],
    ['pull request', { event_name: 'pull_request_target' }],
    ['missing expiry', { exp: undefined }],
    ['expired token', { exp: 1 }],
    ['excessive lifetime', { exp: Math.floor(Date.now() / 1000) + 3600 }],
    ['unsafe run attempt', { run_attempt: '99999999999999999999' }],
] satisfies [string, JWTPayload][])(
    'rejects %s before deriving a publisher run',
    async (_name, claims) => {
        const request = await signedRequest(claims)
        await expect(
            authenticateCatalogPublisherService(request, () => publicKey),
        ).rejects.toBeInstanceOf(PublisherAuthenticationError)
    },
)

test('rejects anonymous and forged identities', async () => {
    const anonymous = new Request('https://marketplace.example.test')
    const request = await signedRequest()
    const forgedKey = (await generateKeyPair('RS256')).publicKey
    await expect(
        authenticateCatalogPublisherService(anonymous, () => publicKey),
    ).rejects.toBeInstanceOf(PublisherAuthenticationError)
    await expect(
        authenticateCatalogPublisherService(request, () => forgedKey),
    ).rejects.toBeInstanceOf(PublisherAuthenticationError)
})
