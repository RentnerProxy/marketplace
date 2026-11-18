import { timingSafeEqual } from 'node:crypto'
import { chmodSync, closeSync, readFileSync } from 'node:fs'
import manifest from './manifest.json'

interface Bootstrap {
    installationId: string
    generation: number
    appSocket: string
    coreSocket: string
    appCredential: string
    coreCredential: string
    versions: { appProtocol: string }
}

function readBootstrap(): Bootstrap {
    const descriptor = 3
    try {
        const input: unknown = JSON.parse(readFileSync(descriptor, 'utf8'))
        if (
            input === null ||
            typeof input !== 'object' ||
            !('installationId' in input) ||
            typeof input.installationId !== 'string' ||
            !('generation' in input) ||
            typeof input.generation !== 'number' ||
            !('appSocket' in input) ||
            typeof input.appSocket !== 'string' ||
            !('coreSocket' in input) ||
            typeof input.coreSocket !== 'string' ||
            !('appCredential' in input) ||
            typeof input.appCredential !== 'string' ||
            !('coreCredential' in input) ||
            typeof input.coreCredential !== 'string' ||
            !('versions' in input) ||
            input.versions === null ||
            typeof input.versions !== 'object' ||
            !('appProtocol' in input.versions) ||
            input.versions.appProtocol !== '1.0.0'
        ) {
            throw new Error('Invalid v1 fixture bootstrap')
        }
        return {
            installationId: input.installationId,
            generation: input.generation,
            appSocket: input.appSocket,
            coreSocket: input.coreSocket,
            appCredential: input.appCredential,
            coreCredential: input.coreCredential,
            versions: { appProtocol: input.versions.appProtocol },
        }
    } finally {
        closeSync(descriptor)
    }
}

const bootstrap = readBootstrap()
const installationHeaders = {
    'x-app-installation': bootstrap.installationId,
    'x-app-generation': String(bootstrap.generation),
}
const expected = Buffer.from(`Bearer ${bootstrap.appCredential}`)

function problem(code: string, status: number) {
    return Response.json(
        {
            type: `urn:rentnerproxy:problem:${code}`,
            title: code,
            status,
            code,
            requestId: 'candidate-reference',
        },
        { status, headers: { 'content-type': 'application/problem+json' } },
    )
}

async function ready() {
    try {
        const core = await fetch('http://localhost/platform/v1/context', {
            unix: bootstrap.coreSocket,
            headers: {
                ...installationHeaders,
                authorization: `Bearer ${bootstrap.coreCredential}`,
            },
            redirect: 'error',
            signal: AbortSignal.timeout(500),
        })
        await core.body?.cancel()
        if (core.status === 200) {
            return Response.json({
                ready: true,
                protocolVersion: bootstrap.versions.appProtocol,
                dataVersion: manifest.data.targetVersion,
                providers: [],
            })
        }
    } catch {
        // The synthetic core may still be binding its private socket at startup.
    }
    return problem('coreUnavailable', 503)
}

process.umask(0o117)
Bun.serve({
    unix: bootstrap.appSocket,
    maxRequestBodySize: 4096,
    fetch(request) {
        const received = Buffer.from(request.headers.get('authorization') ?? '')
        if (
            received.length !== expected.length ||
            !timingSafeEqual(received, expected)
        ) {
            return problem('invalidAppCredential', 401)
        }
        for (const [name, value] of Object.entries(installationHeaders)) {
            if (request.headers.get(name) !== value)
                return problem('invalidGeneration', 403)
        }

        const path = new URL(request.url).pathname
        if (request.method === 'GET' && path === '/app/v1/health') {
            return Response.json({ healthy: true })
        }
        if (request.method === 'GET' && path === '/app/v1/ready') return ready()
        if (request.method === 'POST' && path === '/app/v1/api/getVersion') {
            return Response.json({ version: manifest.version })
        }
        return problem('notFound', 404)
    },
})
chmodSync(bootstrap.appSocket, 0o660)
