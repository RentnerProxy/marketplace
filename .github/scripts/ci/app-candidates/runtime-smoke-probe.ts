import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import {
    httpOperations,
    parseAppManifest,
    parseHttpResponse,
    parseProtocolDocument,
    rpcLimits,
    type AppManifest,
    type ProtocolDocument,
} from '../../../../contracts/v1/index.ts'

type Bootstrap = ProtocolDocument<'BootstrapDescriptor'>
type ProbeOperation = 'getAppHealth' | 'getAppReadiness'

function installationHeaders(bootstrap: Bootstrap, credential: string) {
    return {
        authorization: `Bearer ${credential}`,
        'x-app-installation': bootstrap.installationId,
        'x-app-generation': String(bootstrap.generation),
    }
}

function serveCoreContext(bootstrap: Bootstrap, manifest: AppManifest) {
    mkdirSync('/run-fixture/core', { mode: 0o770 })
    const expected = installationHeaders(bootstrap, bootstrap.coreCredential)
    const context = parseProtocolDocument('PlatformContext', {
        appId: bootstrap.appId,
        installationId: bootstrap.installationId,
        generation: bootstrap.generation,
        runtimeProfile: bootstrap.runtimeProfile,
        versions: bootstrap.versions,
        capabilities: manifest.capabilities,
    })
    const server = Bun.serve({
        unix: bootstrap.coreSocket,
        maxRequestBodySize: 4096,
        fetch(request) {
            const path = new URL(request.url).pathname
            if (
                path !== httpOperations.getPlatformContext.path ||
                request.method !== 'GET'
            ) {
                return new Response(null, { status: 404 })
            }
            for (const [name, value] of Object.entries(expected)) {
                if (request.headers.get(name) !== value)
                    return new Response(null, { status: 403 })
            }
            return Response.json(context)
        },
    })
    chmodSync(bootstrap.coreSocket, 0o660)
    return server
}

async function readJson(response: Response): Promise<unknown> {
    const contentType = response.headers
        .get('content-type')
        ?.split(';')[0]
        ?.trim()
        .toLowerCase()
    if (contentType !== 'application/json' || !response.body) {
        await response.body?.cancel()
        throw new Error('App did not return JSON')
    }
    const buffer = new Uint8Array(rpcLimits.maxJsonBytes)
    let length = 0
    for await (const chunk of response.body) {
        if (length + chunk.byteLength > buffer.byteLength)
            throw new Error('App response exceeds the v1 HTTP limit')
        buffer.set(chunk, length)
        length += chunk.byteLength
    }
    return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
            buffer.subarray(0, length),
        ),
    )
}

async function pollApp<Operation extends ProbeOperation>(
    operation: Operation,
    bootstrap: Bootstrap,
    deadline: number,
) {
    // Probe sequentially so a stalled app never accumulates overlapping requests.
    /* oxlint-disable no-await-in-loop */
    const headers = installationHeaders(bootstrap, bootstrap.appCredential)
    while (Date.now() < deadline) {
        try {
            const socket = await lstat(bootstrap.appSocket)
            if (!socket.isSocket() || socket.uid !== 21001)
                throw new Error('App socket has unexpected ownership')
            const response = await fetch(
                `http://localhost${httpOperations[operation].path}`,
                {
                    unix: bootstrap.appSocket,
                    headers,
                    redirect: 'error',
                    signal: AbortSignal.timeout(
                        Math.max(1, Math.min(1_000, deadline - Date.now())),
                    ),
                },
            )
            const result = parseHttpResponse(
                operation,
                response.status,
                await readJson(response),
            )
            if (result.ok) return result.data
        } catch {
            // Startup can briefly leave the socket unbound or unable to serve the generation.
        }
        await Bun.sleep(100)
    }
    /* oxlint-enable no-await-in-loop */
    throw new Error(`App did not pass the v1 ${operation} probe`)
}

const bootstrap = parseProtocolDocument(
    'BootstrapDescriptor',
    JSON.parse(readFileSync(0, 'utf8')),
)
const manifest = parseAppManifest(await Bun.file('/package/app.json').json())
const core = serveCoreContext(bootstrap, manifest)
try {
    const deadline = Date.now() + manifest.resources.startupTimeoutMs
    await pollApp('getAppHealth', bootstrap, deadline)
    const ready = await pollApp('getAppReadiness', bootstrap, deadline)
    if (ready.dataVersion !== manifest.data?.targetVersion)
        throw new Error(
            'App readiness disagrees with the declared data version',
        )
    const observedProfiles = new Set(
        ready.providers.map(({ profile }) => profile),
    )
    if (
        manifest.providers.length !== observedProfiles.size ||
        manifest.providers.some((profile) => !observedProfiles.has(profile))
    ) {
        throw new Error(
            'App readiness disagrees with the declared provider profiles',
        )
    }
} finally {
    await core.stop(true)
}
