import { vi } from 'bun:test'
import type {
    StorageMutationSqlTestModel,
    StorageMutationSqlTestRow,
    StorageMutationSqlTestSession,
} from './storageMutationSqlModel.test.types.ts'

export const sqlModel: StorageMutationSqlTestModel = {
    rootDirectory: '',
    healthy: true,
    restoreActive: false,
    sessions: [],
    waiters: [],
    reserveHook: null,
    exclusiveHook: null,
    closeHook: null,
}

function hasHeldLock() {
    return sqlModel.sessions.some(
        (session) => session.active && (session.shared || session.exclusive),
    )
}

function pump() {
    if (hasHeldLock()) return
    const next = sqlModel.waiters.shift()
    if (!next) return
    if (!next.session.active) {
        next.reject(new Error('Synthetic SQL session ended.'))
        pump()
        return
    }
    next.session.exclusive = true
    next.resolve()
}

export function dropStorageMutationSqlSessionService(
    session: StorageMutationSqlTestSession,
) {
    session.active = false
    session.shared = false
    session.exclusive = false
    pump()
}

export const reserve = vi.fn(async function () {
    const session: StorageMutationSqlTestSession = {
        id: sqlModel.sessions.length,
        active: true,
        shared: false,
        exclusive: false,
        released: false,
        closed: false,
    }
    sqlModel.sessions.push(session)
    await sqlModel.reserveHook?.(session)
    return Object.assign(
        async function (
            strings: TemplateStringsArray,
        ): Promise<StorageMutationSqlTestRow[]> {
            if (!session.active) throw new Error('Synthetic SQL session ended.')
            const query = strings.join(' ')
            if (query.includes('pg_try_advisory_lock_shared')) {
                const acquired = !sqlModel.sessions.some(
                    (other) => other.active && other.exclusive,
                )
                session.shared = acquired
                return [{ acquired }]
            }
            if (query.includes('pg_advisory_unlock_shared')) {
                const unlocked = session.shared
                session.shared = false
                pump()
                return [{ unlocked }]
            }
            if (query.includes('pg_try_advisory_lock(')) {
                const acquired = !hasHeldLock()
                session.exclusive = acquired
                if (acquired) await sqlModel.exclusiveHook?.(session)
                return [{ acquired }]
            }
            if (query.includes('pg_advisory_lock(')) {
                if (hasHeldLock()) {
                    await new Promise<void>((resolve, reject) => {
                        sqlModel.waiters.push({ session, resolve, reject })
                    })
                } else {
                    session.exclusive = true
                }
                await sqlModel.exclusiveHook?.(session)
                return []
            }
            if (query.includes('pg_advisory_unlock(')) {
                const unlocked = session.exclusive
                session.exclusive = false
                pump()
                return [{ unlocked }]
            }
            throw new Error('Unexpected synthetic SQL operation.')
        },
        {
            release() {
                if (session.shared || session.exclusive)
                    throw new Error(
                        'Synthetic SQL pool release still owns a lock.',
                    )
                session.released = true
            },
            async close() {
                await sqlModel.closeHook?.(session)
                session.closed = true
                dropStorageMutationSqlSessionService(session)
            },
        },
    )
})

export const markUnhealthy = vi.fn(() => {
    sqlModel.healthy = false
})

vi.mock('@/db', () => ({ db: { $client: { reserve } } }))
vi.mock('@/server/Admin/Backups/backup-directory.service.ts', () => ({
    getBackupFilePath: vi.fn(async () => sqlModel.rootDirectory),
}))
vi.mock('@/server/Admin/Backups/restore-state.service.ts', () => ({
    isRestoreStateActiveService: vi.fn(async () => sqlModel.restoreActive),
}))
vi.mock('@/server/Storage/storage-mutation-barrier-health.service.ts', () => ({
    isStorageMutationBarrierHealthyService: () => sqlModel.healthy,
    markStorageMutationBarrierUnhealthyService: markUnhealthy,
}))
vi.mock('@/server/Logging/logger.ts', () => ({
    logError: vi.fn(),
    logInfo: vi.fn(),
}))

export function resetStorageMutationSqlModelService(rootDirectory: string) {
    sqlModel.rootDirectory = rootDirectory
    sqlModel.healthy = true
    sqlModel.restoreActive = false
    sqlModel.sessions.length = 0
    sqlModel.waiters.length = 0
    sqlModel.reserveHook = null
    sqlModel.exclusiveHook = null
    sqlModel.closeHook = null
    vi.clearAllMocks()
}

export async function waitForStorageMutationTestConditionService(
    predicate: () => boolean | Promise<boolean>,
): Promise<void> {
    const deadline = performance.now() + 4_000
    await new Promise<void>((resolve, reject) => {
        function poll() {
            void Promise.resolve()
                .then(predicate)
                .then((ready) => {
                    if (ready) {
                        resolve()
                        return undefined
                    }
                    if (performance.now() >= deadline) {
                        reject(new Error('Synthetic condition timed out.'))
                        return undefined
                    }
                    setTimeout(poll, 2)
                    return undefined
                }, reject)
        }
        poll()
    })
}
