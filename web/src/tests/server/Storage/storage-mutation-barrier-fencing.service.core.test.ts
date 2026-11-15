import * as fence from '@/server/Storage/storage-mutation-fence.service.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
    dropStorageMutationSqlSessionService as dropSession,
    markUnhealthy,
    reserve,
    resetStorageMutationSqlModelService,
    sqlModel,
    waitForStorageMutationTestConditionService as waitFor,
} from './storageMutationSqlModel.test.helpers.ts'
import {
    cleanupStorageMutationTestDirectoryService,
    createStorageMutationTestDirectoryService,
} from './storageMutationFence.test.helpers.ts'
import type { StorageMutationTestDirectory } from './storageMutationFence.test.types.ts'
import { RestoreRollbackError } from '@/server/Admin/Backups/archive-restore.errors.ts'
import { STORAGE_MUTATION_BARRIER_CONFIG as config } from '@/config/storage-mutation-barrier.config.ts'
import { StorageMutationFenceUnavailableError } from '@/server/Storage/storage-mutation-fence.errors.ts'

const {
    RestoreInProgressError,
    StorageMutationBarrierUnavailableError,
    withSharedStorageMutationBarrier: shared,
    withExclusiveStorageMutationBarrier: exclusive,
    tryWithExclusiveStorageMutationBarrier: tryExclusive,
} = await import('@/server/Storage/storage-mutation-barrier.service.ts')

const realRelease = fence.releaseStorageMutationFenceService
let fixture: StorageMutationTestDirectory

function session(index = 0) {
    const value = sqlModel.sessions.at(index)
    if (!value) throw new Error('Missing synthetic session.')
    return value
}

function exclusivePublished() {
    return Bun.file(
        path.join(fixture.rootDirectory, config.exclusiveFileName),
    ).exists()
}

beforeEach(async function () {
    fixture = await createStorageMutationTestDirectoryService()
    resetStorageMutationSqlModelService(fixture.rootDirectory)
})

afterEach(async function () {
    vi.restoreAllMocks()
    expect(sqlModel.waiters).toHaveLength(0)
    await cleanupStorageMutationTestDirectoryService(fixture)
})

describe('filesystem fencing across SQL session loss', function () {
    it('holds restore behind an unfinished shared write after its SQL session disappears', async function () {
        const started = Promise.withResolvers<void>()
        const writeFinished = Promise.withResolvers<void>()
        const effects: string[] = []
        const current = shared(async function () {
            started.resolve()
            await writeFinished.promise
            effects.push('write-finished')
        })
        await started.promise
        dropSession(session())
        const restored = exclusive(async function () {
            effects.push('restore-started')
        })
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(effects).toEqual([])
        expect(await tryExclusive(vi.fn())).toEqual({ acquired: false })
        writeFinished.resolve()
        await Promise.all([current, restored])
        expect(effects).toEqual(['write-finished', 'restore-started'])
        expect(markUnhealthy).not.toHaveBeenCalled()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
        expect(await exclusivePublished()).toBe(false)
    })

    it('fences shared and another exclusive callback after an exclusive SQL loss', async function () {
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const current = exclusive(async function () {
            started.resolve()
            await finish.promise
        })
        await started.promise
        dropSession(session())
        const candidate = vi.fn()
        await expect(shared(candidate)).rejects.toBeInstanceOf(
            RestoreInProgressError,
        )
        expect(await tryExclusive(candidate)).toEqual({ acquired: false })
        expect(candidate).not.toHaveBeenCalled()
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(await exclusivePublished()).toBe(true)
        finish.resolve()
        await current
        expect(await shared(async () => 1)).toBe(1)
        expect(markUnhealthy).not.toHaveBeenCalled()
    })

    it('publishes the shared lease before a delayed SQL reservation and drains failed admission', async function () {
        const reserved = Promise.withResolvers<void>()
        const continueReservation = Promise.withResolvers<void>()
        sqlModel.reserveHook = async function () {
            sqlModel.reserveHook = null
            reserved.resolve()
            await continueReservation.promise
        }
        const operation = vi.fn()
        const current = shared(operation)
        const rejected = current.catch((error: unknown) => error)
        await reserved.promise
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        dropSession(session())
        const restored = exclusive(async () => 2)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        continueReservation.resolve()
        expect(await rejected).toBeInstanceOf(Error)
        expect(await restored).toBe(2)
        expect(operation).not.toHaveBeenCalled()
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })

    it('keeps the published exclusive marker when SQL disappears just before the callback', async function () {
        sqlModel.exclusiveHook = async function (current) {
            dropSession(current)
        }
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const operation = exclusive(async function () {
            started.resolve()
            await finish.promise
        })
        await started.promise
        expect(session().active).toBe(false)
        expect(await exclusivePublished()).toBe(true)
        expect(await tryExclusive(vi.fn())).toEqual({ acquired: false })
        finish.resolve()
        await operation
        expect(await exclusivePublished()).toBe(false)
    })

    it('does not release a lease before an in-flight SQL discard finishes', async function () {
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const discarding = Promise.withResolvers<void>()
        const discardFinished = Promise.withResolvers<void>()
        sqlModel.closeHook = async function () {
            discarding.resolve()
            await discardFinished.promise
        }
        const current = shared(async function () {
            started.resolve()
            await finish.promise
        })
        await started.promise
        dropSession(session())
        finish.resolve()
        await discarding.promise
        const restored = exclusive(async () => 3)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        discardFinished.resolve()
        await current
        expect(await restored).toBe(3)
    })

    it('coalesces first and last shared ownership while retaining independent callback scopes', async function () {
        const firstStarted = Promise.withResolvers<void>()
        const secondStarted = Promise.withResolvers<void>()
        const firstFinish = Promise.withResolvers<void>()
        const secondFinish = Promise.withResolvers<void>()
        const first = shared(async () => {
            firstStarted.resolve()
            await firstFinish.promise
        })
        await firstStarted.promise
        const second = shared(async () => {
            secondStarted.resolve()
            await secondFinish.promise
        })
        await secondStarted.promise
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        firstFinish.resolve()
        await first
        expect(session().shared).toBe(true)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        secondFinish.resolve()
        await second
        expect(session().released).toBe(true)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
    })

    it('drains a registered nested callback even when its parent did not await it', async function () {
        const childStarted = Promise.withResolvers<void>()
        const childFinish = Promise.withResolvers<void>()
        let parentFinished = false
        const current = shared(async function () {
            void shared(async function () {
                childStarted.resolve()
                await childFinish.promise
            })
        }).then(() => {
            parentFinished = true
            return undefined
        })
        await childStarted.promise
        const restored = exclusive(async () => 4)
        await waitFor(exclusivePublished)
        expect(parentFinished).toBe(false)
        expect(reserve).toHaveBeenCalledTimes(1)
        childFinish.resolve()
        await current
        expect(await restored).toBe(4)
        expect(parentFinished).toBe(true)
    })

    it('drains nested work before propagating a parent failure', async function () {
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        const failure = new Error('Synthetic callback failure.')
        const current = shared(async function () {
            void shared(async function () {
                started.resolve()
                await finish.promise
            })
            throw failure
        })
        const rejected = current.catch((error: unknown) => error)
        await started.promise
        const restored = exclusive(async () => 5)
        await waitFor(exclusivePublished)
        expect(reserve).toHaveBeenCalledTimes(1)
        finish.resolve()
        expect(await rejected).toBe(failure)
        expect(await restored).toBe(5)
    })

    it('does not trust a closed inherited scope while another callback keeps the same lease', async function () {
        const firstStarted = Promise.withResolvers<void>()
        const firstFinish = Promise.withResolvers<void>()
        const secondStarted = Promise.withResolvers<void>()
        const secondFinish = Promise.withResolvers<void>()
        const triggerLate = Promise.withResolvers<void>()
        const lateOperation = vi.fn()
        let late: Promise<unknown> | undefined
        const first = shared(async function () {
            late = triggerLate.promise.then(() => shared(lateOperation))
            firstStarted.resolve()
            await firstFinish.promise
        })
        await firstStarted.promise
        const second = shared(async function () {
            secondStarted.resolve()
            await secondFinish.promise
        })
        await secondStarted.promise
        firstFinish.resolve()
        await first
        const restored = exclusive(async () => 6)
        await waitFor(exclusivePublished)
        triggerLate.resolve()
        if (!late) throw new Error('Missing late callback.')
        await expect(late).rejects.toBeInstanceOf(RestoreInProgressError)
        expect(lateOperation).not.toHaveBeenCalled()
        expect(reserve).toHaveBeenCalledTimes(1)
        secondFinish.resolve()
        await second
        expect(await restored).toBe(6)
    })

    it('permits tracked cleanup inside an active exclusive scope without upgrading itself', async function () {
        const cleanup = vi.fn()
        await exclusive(async function () {
            await shared(cleanup)
            expect(await tryExclusive(vi.fn())).toEqual({ acquired: false })
            await expect(exclusive(vi.fn())).rejects.toBeInstanceOf(
                RestoreInProgressError,
            )
        })
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(reserve).toHaveBeenCalledTimes(1)
    })

    it('retains the marker for typed unsafe rollback and disables further admission', async function () {
        const failure = new RestoreRollbackError(
            'Synthetic rollback failure.',
            [],
            new Error('Synthetic cause.'),
        )
        await expect(
            exclusive(async () => {
                throw failure
            }),
        ).rejects.toBe(failure)
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
        expect(await exclusivePublished()).toBe(true)
        await expect(shared(vi.fn())).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
    })

    it('retains active restore state after an otherwise completed callback', async function () {
        await expect(
            exclusive(async function () {
                sqlModel.restoreActive = true
            }),
        ).rejects.toBeInstanceOf(StorageMutationBarrierUnavailableError)
        expect(await exclusivePublished()).toBe(true)
        const bytes = await readFile(
            path.join(fixture.rootDirectory, config.exclusiveFileName),
        )
        expect(bytes.length).toBeLessThanOrEqual(config.maxMetadataBytes)
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
    })

    it.each(['cycle', 'accessor', 'limit'])(
        'retains unclassifiable failure ownership',
        async function (kind) {
            const failure = new Error('Synthetic failure.')
            if (kind === 'cycle')
                Object.defineProperty(failure, 'cause', { value: failure })
            if (kind === 'accessor')
                Object.defineProperty(failure, 'cause', {
                    get() {
                        throw new Error('Synthetic accessor.')
                    },
                })
            if (kind === 'limit')
                Object.defineProperty(failure, 'cause', {
                    value: new AggregateError(
                        Array.from(
                            { length: config.maxErrorNodes + 1 },
                            () => new Error('Synthetic nested failure.'),
                        ),
                    ),
                })
            await expect(
                exclusive(async () => {
                    throw failure
                }),
            ).rejects.toBe(failure)
            expect(await exclusivePublished()).toBe(true)
            expect(markUnhealthy).toHaveBeenCalledTimes(1)
        },
    )

    it('releases a safely finished validation failure without requiring manual recovery', async function () {
        const failure = new Error('Synthetic validation failure.')
        await expect(
            exclusive(async () => {
                throw failure
            }),
        ).rejects.toBe(failure)
        expect(await exclusivePublished()).toBe(false)
        expect(markUnhealthy).not.toHaveBeenCalled()
        expect(await shared(async () => 7)).toBe(7)
    })
    it('removes its own unused marker after a confirmed SQL try failure', async function () {
        sqlModel.sessions.push({
            id: 0,
            active: true,
            shared: true,
            exclusive: false,
            released: false,
            closed: false,
        })
        const operation = vi.fn()
        expect(await tryExclusive(operation)).toEqual({ acquired: false })
        expect(operation).not.toHaveBeenCalled()
        expect(session(1).released).toBe(true)
        expect(await exclusivePublished()).toBe(false)
        expect(markUnhealthy).not.toHaveBeenCalled()
    })

    it('throws instead of reporting false when cleanup after SQL try failure is unconfirmed', async function () {
        sqlModel.sessions.push({
            id: 0,
            active: true,
            shared: true,
            exclusive: false,
            released: false,
            closed: false,
        })
        const operation = vi.fn()
        let injected = 0
        vi.spyOn(
            fence,
            'releaseStorageMutationFenceService',
        ).mockImplementation(async (lease) => {
            if (
                lease.file.path ===
                path.join(fixture.rootDirectory, config.exclusiveFileName)
            ) {
                injected += 1
                throw new StorageMutationFenceUnavailableError()
            }
            await realRelease(lease)
        })
        await expect(tryExclusive(operation)).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
        expect(operation).not.toHaveBeenCalled()
        expect(injected).toBe(1)
        expect(session(1).released).toBe(true)
        expect(await exclusivePublished()).toBe(true)
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
    })

    it('cleans an unused shared lease after a confirmed SQL refusal', async function () {
        sqlModel.sessions.push({
            id: 0,
            active: true,
            shared: false,
            exclusive: true,
            released: false,
            closed: false,
        })
        const operation = vi.fn()
        await expect(shared(operation)).rejects.toBeInstanceOf(
            RestoreInProgressError,
        )
        expect(operation).not.toHaveBeenCalled()
        expect(session(1).released).toBe(true)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toEqual([])
        expect(markUnhealthy).not.toHaveBeenCalled()
    })

    it('retains an owned shared lease when SQL discard cannot be confirmed', async function () {
        const started = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        sqlModel.closeHook = async function () {
            throw new Error('Synthetic discard failure.')
        }
        const current = shared(async function () {
            started.resolve()
            await finish.promise
        }).catch((error: unknown) => error)
        await started.promise
        dropSession(session())
        finish.resolve()
        expect(await current).toBeInstanceOf(Error)
        expect(
            await readdir(path.join(fixture.rootDirectory, 'shared')),
        ).toHaveLength(1)
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
        await expect(shared(vi.fn())).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
    })

    it('retains the exclusive fence after a registered child fails during parent drain', async function () {
        const childStarted = Promise.withResolvers<void>()
        const childFinish = Promise.withResolvers<void>()
        const failure = new RestoreRollbackError(
            'Synthetic child rollback.',
            [],
            new Error('Synthetic cause.'),
        )
        let childResult: Promise<unknown> = Promise.resolve(undefined)
        let parentSettled = false
        const parent = exclusive(async function () {
            childResult = shared(async function () {
                childStarted.resolve()
                await childFinish.promise
                throw failure
            }).catch((error: unknown) => error)
        }).then(
            () => {
                parentSettled = true
                return undefined
            },
            (error: unknown) => {
                parentSettled = true
                return error
            },
        )
        await childStarted.promise
        expect(parentSettled).toBe(false)
        expect(await exclusivePublished()).toBe(true)
        childFinish.resolve()
        expect(await childResult).toBe(failure)
        expect(await parent).toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
        expect(await exclusivePublished()).toBe(true)
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
        await expect(shared(vi.fn())).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
    })

    it('retains uncertainty from an already settled registered child', async function () {
        const failure = new RestoreRollbackError(
            'Synthetic settled rollback.',
            [],
            new Error('Synthetic cause.'),
        )
        const result = exclusive(async function () {
            const child = shared(async function () {
                throw failure
            })
            expect(await child.catch((error: unknown) => error)).toBe(failure)
            return 19
        })
        await expect(result).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
        expect(await exclusivePublished()).toBe(true)
        expect(markUnhealthy).toHaveBeenCalledTimes(1)
        await expect(shared(vi.fn())).rejects.toBeInstanceOf(
            StorageMutationBarrierUnavailableError,
        )
    })

    it('allows an explicitly handled ordinary child validation failure', async function () {
        const failure = new Error('Synthetic child validation.')
        expect(
            await exclusive(async function () {
                const child = shared(async function () {
                    throw failure
                })
                expect(await child.catch((error: unknown) => error)).toBe(
                    failure,
                )
                return 23
            }),
        ).toBe(23)
        expect(await exclusivePublished()).toBe(false)
        expect(markUnhealthy).not.toHaveBeenCalled()
        expect(await shared(async () => 29)).toBe(29)
    })
})
