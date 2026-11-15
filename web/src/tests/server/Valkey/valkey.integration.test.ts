import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Queue, QueueEvents, Worker } from 'bullmq'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Valkey from 'ioredis'
import {
    createDedicatedValkeyConnection,
    getBullMqConnectionOptions,
    getBullMqProducerConnectionOptions,
    getValkeyConnection,
    getValkeyPublisher,
} from '@/server/Valkey/valkey.service.ts'
import { parseValkeyUrl } from '@/server/Valkey/valkeyUrl.ts'
import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import {
    finishLoginAttemptService,
    reserveLoginAttemptService,
} from '@/server/RateLimit/login-attempt.service.ts'
import {
    CLAIM_ATTEMPT_SCRIPT,
    RESERVE_ATTEMPT_SCRIPT,
} from '@/server/Auth/Login/recovery.script.ts'

const testUrl = process.env.TEST_VALKEY_URL
const runId = randomUUID()
const keyPrefix = `rentnerproxy-marketplace:test:valkey:${runId}`
const queueName = `rentnerproxy-marketplace-valkey-test-${runId}`
const previousValkeyUrl = process.env.VALKEY_URL
const previousConnection = globalThis.appValkeyConnection
const previousPublisher = globalThis.appValkeyPublisher
const ownedKeys: Array<string> = []
let control: Valkey | undefined
let subscriber: ReturnType<typeof createDedicatedValkeyConnection> | undefined
let queue: Queue<{ value: number }, number> | undefined
let queueEvents: QueueEvents | undefined
let worker: Worker<{ value: number }, number> | undefined

function getControlConnection() {
    if (!control) throw new Error('Valkey test connection is missing')
    return control
}

describe.skipIf(!testUrl)(
    'Valkey integration with existing application clients',
    function () {
        beforeAll(async function () {
            if (!testUrl) throw new Error('TEST_VALKEY_URL is required')
            const parsed = parseValkeyUrl(testUrl)
            if (
                !['127.0.0.1', 'localhost', '::1'].includes(parsed.host) ||
                parsed.port !== 6379
            ) {
                throw new Error(
                    'Valkey integration tests require local port 6379',
                )
            }

            control = new Valkey(testUrl, {
                lazyConnect: true,
                connectTimeout: 3_000,
                commandTimeout: 3_000,
                maxRetriesPerRequest: 1,
                retryStrategy: () => null,
            })
            const serverInfo = await control.info('server')
            if (!/^server_name:valkey\r?$/m.test(serverInfo)) {
                throw new Error(
                    'The test service must identify itself as Valkey',
                )
            }

            process.env.VALKEY_URL = testUrl
            delete globalThis.appValkeyConnection
            delete globalThis.appValkeyPublisher
        })

        afterAll(async function () {
            try {
                await worker?.close()
                await queueEvents?.close()
                await queue?.obliterate({ force: true })
                if (control && ownedKeys.length > 0) {
                    await control.del(...ownedKeys)
                }
            } finally {
                subscriber?.disconnect()
                control?.disconnect()
                const connection = globalThis.appValkeyConnection
                const publisher = globalThis.appValkeyPublisher
                if (connection !== previousConnection) connection?.disconnect()
                if (publisher !== previousPublisher) publisher?.disconnect()
                globalThis.appValkeyConnection = previousConnection
                globalThis.appValkeyPublisher = previousPublisher
                if (previousValkeyUrl === undefined) {
                    delete process.env.VALKEY_URL
                } else {
                    process.env.VALKEY_URL = previousValkeyUrl
                }
                await queue?.close()
            }
        }, 10_000)

        it('connects through the application client and keeps expiring NX writes', async function () {
            const key = `${keyPrefix}:expiry`
            ownedKeys.push(key)
            const connection = getValkeyConnection()

            expect(await connection.ping()).toBe('PONG')
            expect(
                await connection.set(key, 'synthetic', 'PX', 60_000, 'NX'),
            ).toBe('OK')
            expect(
                await connection.set(key, 'replacement', 'PX', 60_000, 'NX'),
            ).toBe(null)
            expect(await connection.get(key)).toBe('synthetic')
            const ttl = await getControlConnection().pttl(key)
            expect(ttl).toBeGreaterThan(0)
            expect(ttl).toBeLessThanOrEqual(60_000)
        })

        it('enforces the real atomic Lua rate limit with a bounded TTL', async function () {
            const scope = `valkey-test-${runId}`
            const identifier = `synthetic-${runId}`
            const hash = createHash('sha256').update(identifier).digest('hex')
            const key = `rentnerproxy-marketplace:rate-limit:${scope}:${hash}`
            ownedKeys.push(key)
            const options = {
                scope,
                identifiers: [identifier],
                includeClientIp: false,
                limit: 1,
                windowMs: 60_000,
            }

            await enforceRateLimit(options)
            await expect(enforceRateLimit(options)).rejects.toBeInstanceOf(
                RateLimitError,
            )
            expect(await getControlConnection().get(key)).toBe('2')
            const ttl = await getControlConnection().pttl(key)
            expect(ttl).toBeGreaterThan(0)
            expect(ttl).toBeLessThanOrEqual(60_000)
        })

        it('keeps login reservations atomic and rejects corrupted state through Valkey Lua', async function () {
            const username = `vkt-${runId}`
            const hash = createHash('sha256').update(username).digest('hex')
            const prefix = `rentnerproxy-marketplace:rate-limit:login:${hash}`
            ownedKeys.push(
                ...['state', 'lock', 'generation', 'inflight'].map(
                    function (suffix) {
                        return `${prefix}:${suffix}`
                    },
                ),
            )

            const reservation = await reserveLoginAttemptService(username)
            if (!reservation.allowed) {
                throw new Error('Synthetic login reservation was rejected')
            }
            expect(
                await finishLoginAttemptService(
                    username,
                    reservation.attempt,
                    'neutral',
                ),
            ).toMatchObject({ applied: true, lockCreated: false })
            expect(
                await finishLoginAttemptService(
                    username,
                    reservation.attempt,
                    'neutral',
                ),
            ).toMatchObject({ applied: false, lockCreated: false })
            await getControlConnection().set(
                `${prefix}:state`,
                'invalid',
                'PX',
                60_000,
            )
            await expect(reserveLoginAttemptService(username)).rejects.toThrow(
                'Invalid login attempt state',
            )
        })

        it('preserves recovery grant expiry and consumes an admitted attempt only once', async function () {
            const key = `${keyPrefix}:recovery`
            const attemptId = randomBytes(32).toString('base64url')
            const userId = `synthetic-${runId}`
            const usernameHash = createHash('sha256')
                .update(runId)
                .digest('hex')
            const passwordVersion = createHash('sha256')
                .update(userId)
                .digest('hex')
            ownedKeys.push(key)
            const connection = getValkeyConnection()
            await connection.set(
                key,
                JSON.stringify({
                    purpose: 'login-recovery-v1',
                    userId,
                    usernameHash,
                    passwordVersion,
                    expiresAt: Date.now() + 60_000,
                    attemptIds: [],
                }),
                'PX',
                60_000,
                'NX',
            )
            const originalTtl = await getControlConnection().pttl(key)
            const reserveArguments = [usernameHash, attemptId, '3', '60000']
            expect(
                await connection.eval(
                    RESERVE_ATTEMPT_SCRIPT,
                    1,
                    key,
                    ...reserveArguments,
                ),
            ).toBe(1)
            expect(
                await connection.eval(
                    RESERVE_ATTEMPT_SCRIPT,
                    1,
                    key,
                    ...reserveArguments,
                ),
            ).toBe(0)
            expect(await getControlConnection().pttl(key)).toBeLessThanOrEqual(
                originalTtl,
            )
            const claimArguments = [
                attemptId,
                userId,
                usernameHash,
                passwordVersion,
                '3',
                '60000',
            ]
            expect(
                await connection.eval(
                    CLAIM_ATTEMPT_SCRIPT,
                    1,
                    key,
                    ...claimArguments,
                ),
            ).toBe(1)
            expect(
                await connection.eval(
                    CLAIM_ATTEMPT_SCRIPT,
                    1,
                    key,
                    ...claimArguments,
                ),
            ).toBe(0)
            expect(await connection.get(key)).toBeNull()
        })

        it('delivers Pub/Sub messages through dedicated and publisher clients', async function () {
            const channel = `${keyPrefix}:realtime`
            const message = JSON.stringify({ type: 'synthetic', runId })
            subscriber = createDedicatedValkeyConnection()
            await subscriber.subscribe(channel)
            const received = Promise.withResolvers<string>()
            const timeout = setTimeout(function () {
                received.reject(new Error('Valkey Pub/Sub test timed out'))
            }, 3_000)
            subscriber.on('message', function (receivedChannel, payload) {
                if (receivedChannel === channel) received.resolve(payload)
            })

            try {
                expect(
                    await getValkeyPublisher().publish(channel, message),
                ).toBe(1)
                expect(await received.promise).toBe(message)
            } finally {
                clearTimeout(timeout)
            }
        })

        it('processes BullMQ jobs, retries and delayed jobs through both connection options', async function () {
            queue = new Queue<{ value: number }, number>(queueName, {
                connection: getBullMqProducerConnectionOptions(),
            })
            queueEvents = new QueueEvents(queueName, {
                connection: getBullMqConnectionOptions(),
            })
            worker = new Worker<{ value: number }, number>(
                queueName,
                async function (job) {
                    if (job.name === 'retry' && job.attemptsMade === 0) {
                        throw new Error('Synthetic retry')
                    }
                    return job.data.value * 2
                },
                { connection: getBullMqConnectionOptions() },
            )
            await Promise.all([
                queue.waitUntilReady(),
                queueEvents.waitUntilReady(),
                worker.waitUntilReady(),
            ])

            const job = await queue.add('regular', { value: 3 })
            expect(await job.waitUntilFinished(queueEvents, 10_000)).toBe(6)
            const retry = await queue.add(
                'retry',
                { value: 4 },
                {
                    attempts: 2,
                    backoff: { type: 'fixed', delay: 50 },
                },
            )
            expect(await retry.waitUntilFinished(queueEvents, 10_000)).toBe(8)
            expect((await queue.getJob(retry.id!))?.attemptsMade).toBe(2)
            const delayed = await queue.add(
                'delayed',
                { value: 5 },
                { delay: 50 },
            )
            expect(await delayed.waitUntilFinished(queueEvents, 10_000)).toBe(
                10,
            )
        }, 30_000)

        it('creates and removes BullMQ job schedulers', async function () {
            if (!queue) throw new Error('Valkey test queue is missing')
            const schedulerId = `scheduler-${runId}`
            await queue.upsertJobScheduler(
                schedulerId,
                { every: 60_000 },
                { name: 'scheduled', data: { value: 6 } },
            )
            expect((await queue.getJobScheduler(schedulerId))?.name).toBe(
                'scheduled',
            )
            expect(await queue.removeJobScheduler(schedulerId)).toBe(true)
            expect(await queue.getJobScheduler(schedulerId)).toBeUndefined()
        })
    },
)
