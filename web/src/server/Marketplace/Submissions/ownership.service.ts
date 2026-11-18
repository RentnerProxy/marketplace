import { z } from 'zod'
import { CANDIDATE_PIPELINE as pipeline } from '@/config/submissions.config.ts'
import type { marketplaceRepositoryClaims } from '@/db/schema.ts'
import { repositoryName } from '@/lib/Marketplace/sourceRequest.ts'
import { commit } from '../../../../../contracts/v1/primitives.ts'
import {
    GitHubRequestError,
    githubJson,
    githubNumericId,
} from './github.service.ts'

export class RepositoryOwnershipError extends Error {
    constructor() {
        super('ownershipChanged')
    }
}

const repositoryResponse = z.object({
    id: githubNumericId,
    full_name: repositoryName,
    private: z.boolean(),
    owner: z.object({ id: githubNumericId }),
})

export async function readPublicRepository(repository: string) {
    try {
        const info = repositoryResponse.parse(
            await githubJson('/repos/' + repository, { redirect: 'manual' }),
        )
        if (
            info.private ||
            info.full_name.toLowerCase() !== repository.toLowerCase()
        ) {
            throw new RepositoryOwnershipError()
        }
        return {
            repository: info.full_name,
            repositoryId: info.id,
            ownerId: info.owner.id,
        }
    } catch (error) {
        if (
            error instanceof GitHubRequestError &&
            [301, 302, 307, 404].includes(error.status)
        ) {
            throw new RepositoryOwnershipError()
        }
        throw error
    }
}

const proofFile = z.object({
    type: z.literal('file'),
    encoding: z.literal('base64'),
    content: z.string().max(200),
})

export function repositoryChallenge(id: string) {
    return 'rentnerproxy-marketplace:' + id
}

export async function verifyRepositoryClaim(
    claim: typeof marketplaceRepositoryClaims.$inferSelect,
    sourceCommit?: string,
) {
    try {
        const info = await readPublicRepository(claim.repository)
        if (
            info.repositoryId !== claim.repositoryId ||
            info.ownerId !== claim.ownerId
        ) {
            throw new RepositoryOwnershipError()
        }
        // A commit or PR supplied by the developer cannot choose this ref.
        const proof = proofFile.safeParse(
            await githubJson(
                '/repos/' + info.repository + '/contents/' + pipeline.proofPath,
            ),
        )
        if (
            !proof.success ||
            Buffer.from(proof.data.content, 'base64')
                .toString('utf8')
                .trim() !== repositoryChallenge(claim.id)
        ) {
            throw new RepositoryOwnershipError()
        }
        if (sourceCommit) {
            const infoAtCommit = z
                .object({ sha: commit })
                .parse(
                    await githubJson(
                        '/repos/' +
                            info.repository +
                            '/git/commits/' +
                            sourceCommit,
                    ),
                )
            if (infoAtCommit.sha !== sourceCommit)
                throw new RepositoryOwnershipError()
        }
    } catch (error) {
        if (
            error instanceof GitHubRequestError &&
            [404, 409].includes(error.status)
        ) {
            throw new RepositoryOwnershipError()
        }
        throw error
    }
}

export function candidateNamespace(ownerId: string, repositoryId: string) {
    return (
        'gh-' +
        BigInt(ownerId).toString(36) +
        '-' +
        BigInt(repositoryId).toString(36)
    )
}
