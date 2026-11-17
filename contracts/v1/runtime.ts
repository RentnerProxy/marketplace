import { z } from 'zod'
import { capabilityRequest } from './manifest.ts'
import {
    appId,
    formatVersion,
    positiveInteger,
    protocolVersion,
    recordId,
    runtimeProfile,
    stateVersion,
    timestamp,
} from './primitives.ts'
import { providerSchemas } from './provider-api.ts'

const socketCredential = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{32,128}$/)
    .describe(
        'Opaque credential issued for one socket direction and installation generation.',
    )

function socketPath(name: 'app' | 'core') {
    const directory = '/[a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)*'
    return z
        .string()
        .max(107)
        .regex(new RegExp('^(?:' + directory + ')+/' + name + '\\.sock$'))
}

const versions = z.strictObject({
    appProtocol: protocolVersion,
    platformApi: protocolVersion,
    uiBridge: protocolVersion.optional(),
})

const installation = {
    appId,
    installationId: recordId,
    generation: positiveInteger,
}

const bootstrapDescriptor = z
    .strictObject({
        formatVersion,
        ...installation,
        runtimeProfile,
        versions,
        appSocket: socketPath('app'),
        coreSocket: socketPath('core'),
        appCredential: socketCredential,
        coreCredential: socketCredential,
    })
    .refine(
        ({ appCredential, coreCredential }) => appCredential !== coreCredential,
        'Socket credentials must be distinct.',
    )
    .describe(
        'The manager hands this descriptor to the restricted app process through a private inherited file descriptor. The SDK rejects reuse of a credential across socket directions. Keep the descriptor and credentials out of command lines, process environments, browser messages, and logs. The manager verifies socket ownership and the private run directory.',
    )

const appHealth = z.looseObject({ healthy: z.literal(true) })

const appReadiness = z
    .looseObject({
        ready: z.literal(true),
        protocolVersion,
        dataVersion: stateVersion.optional(),
        providers: z.array(providerSchemas.ProviderRegistration).max(32),
    })
    .refine(
        ({ providers }) =>
            new Set(providers.map(({ id }) => id)).size === providers.length,
        'Provider registration IDs must be unique.',
    )
    .describe(
        'An absent dataVersion denotes an app without persisted data. The SDK checks unique provider registration IDs. Advertised providers become live only after the manager activates this generation.',
    )

const platformContext = z
    .looseObject({
        ...installation,
        runtimeProfile,
        versions,
        capabilities: z.array(capabilityRequest).max(32),
    })
    .describe(
        'The platform derives this context from the authenticated installation. For each operation the platform rechecks current grants, actor permissions, resource scope, and generation.',
    )

const authorizationRequest = z
    .strictObject({ capability: capabilityRequest, resourceId: recordId })
    .describe(
        'Check a specific capability and resource. For installation scope resourceId is the verified installation ID. The platform derives actor identity from its issued delegation.',
    )

const authorizationResult = z
    .looseObject({ allowed: z.boolean() })
    .describe(
        'A point-in-time check. Mutating operations authorize the actor and resource again.',
    )

const eventCursor = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,256}$/)
    .describe(
        'Opaque resume cursor. Reconnect with the cursor from the last processed event.',
    )

const platformEvent = z
    .looseObject({
        id: recordId,
        cursor: eventCursor,
        type: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
        occurredAt: timestamp,
        resourceId: recordId.optional(),
        revision: recordId.optional(),
    })
    .describe(
        'Durable authorized event data delivered at least once. Deduplicate by id. An absent resourceId or revision means the event carries no corresponding resource or revision.',
    )

export const runtimeSchemas = {
    RecordId: recordId,
    Generation: positiveInteger,
    BootstrapDescriptor: bootstrapDescriptor,
    AppHealth: appHealth,
    AppReadiness: appReadiness,
    PlatformContext: platformContext,
    AuthorizationRequest: authorizationRequest,
    AuthorizationResult: authorizationResult,
    EventCursor: eventCursor,
    PlatformEvent: platformEvent,
}
