import { applyBackupRetentionBestEffort } from '@/server/Admin/Backups/run-retention.service.ts'
import {
    getOrCreateBackupSettings,
    serializeBackupSettings,
} from '@/server/Admin/Backups/settings.service.ts'
import {
    createBackupMutationMocks,
    backupMutationRevocations,
} from './backupMutationTestUtils.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import { createBackupAuditMocks } from './backupAuditTestUtils.ts'
import type { Mock } from 'bun:test'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
vi.mock('@/server/Realtime/publish.service.ts', function () {
    return {
        publishAdminBackupsChangedService: vi.fn(async () => {
            auditMocks.state.events.push('publish-realtime')
        }),
    }
})
import { deleteBackupFilesService } from '@/server/Admin/Backups/backup-files.service.ts'
import { deleteBackupService } from '@/server/Admin/Backups/run-retention.service.ts'
import { getBackupRunById } from '@/server/Admin/Backups/run-registry.service.ts'

const auditMocks = createBackupAuditMocks()
const mutationMocks = createBackupMutationMocks(auditMocks)

const schemaMock = (function () {
    return {
        ...mutationMocks.schema,
        backupRuns: {
            fileName: 'backupRuns.fileName',
            id: 'backupRuns.id',
            startedAt: 'backupRuns.startedAt',
            status: 'backupRuns.status',
        },
    }
})()

const retentionMocks = (function () {
    const state = {
        referencedRuns: [] as Array<Record<string, unknown>>,
        fileExists: true,
        retentionRuns: [] as Array<Record<string, unknown>>,
    }
    let selectedCondition = { left: '', right: undefined as unknown }
    const forUpdate = vi.fn(async function () {
        auditMocks.state.events.push('run-locks')
        const key = selectedCondition.left.split('.').at(-1)!
        return state.referencedRuns
            .filter((run) => run[key] === selectedCondition.right)
            .toSorted((left, right) =>
                String(left.id).localeCompare(String(right.id)),
            )
    })
    const orderBy = vi.fn(function () {
        return { for: forUpdate }
    })
    const selectWhere = vi.fn(function (condition: typeof selectedCondition) {
        selectedCondition = condition
        return { for: forUpdate, orderBy }
    })
    const selectFrom = vi.fn(function () {
        return { where: selectWhere }
    })
    const select = vi.fn(function (projection?: unknown) {
        if (mutationMocks.isPolicySelection(projection)) {
            return mutationMocks.selectPolicy(tx, projection)
        }
        return { from: selectFrom }
    })
    const deleteWhere = vi.fn(async function (condition: { right: unknown }) {
        auditMocks.state.events.push('run-delete')
        state.referencedRuns = state.referencedRuns.filter(
            (run) => run.id !== condition.right,
        )
    })
    const deleteFrom = vi.fn(function () {
        return { where: deleteWhere }
    })
    const execute = vi.fn(async function (statement: {
        text: string
        values: unknown[]
    }) {
        expect(statement.text).toBe('lock table  in exclusive mode')
        expect(statement.values).toEqual([schemaMock.backupRuns])
        auditMocks.state.events.push('table-lock')
    })
    const tx = { delete: deleteFrom, select, execute }
    const transaction = vi.fn(async function <Result>(
        operation: (transaction: typeof tx) => Result | Promise<Result>,
    ) {
        const previous = structuredClone(state.referencedRuns)
        return auditMocks.transaction(tx, operation, function () {
            state.referencedRuns = previous
        })
    })

    return {
        database: {
            transaction,
            select: vi.fn(function () {
                return {
                    from() {
                        return {
                            where() {
                                return {
                                    async orderBy() {
                                        return state.retentionRuns
                                    },
                                }
                            },
                        }
                    },
                }
            }),
        },
        deleteWhere,
        execute,
        state,
    }
})()

vi.mock('@/lib/AuditLogs/auditLogs.ts', function () {
    return {
        prepareAuditContextService: auditMocks.prepare,
        writeAuditLogInTransactionService: auditMocks.write,
        publishCommittedAuditLogService: auditMocks.publish,
    }
})
vi.mock('@/lib/AuditLogs/user-locks.ts', function () {
    return { lockAuditUsersInTransactionService: mutationMocks.lockUsers }
})

vi.mock('@/db', function () {
    return { db: retentionMocks.database }
})

vi.mock('@/db/schema.ts', function () {
    return schemaMock
})

vi.mock('drizzle-orm', function () {
    return {
        and: vi.fn(function (...conditions: Array<unknown>) {
            return conditions
        }),
        desc: vi.fn(function (value: unknown) {
            return value
        }),
        eq: vi.fn(function (left: unknown, right: unknown) {
            return { left, right }
        }),
        isNotNull: vi.fn(function (value: unknown) {
            return value
        }),
        lt: vi.fn(function (left: unknown, right: unknown) {
            return { left, right }
        }),
        sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({
            text: parts.join(''),
            values,
        }),
    }
})

vi.mock('@/server/Admin/Backups/backup-files.service.ts', function () {
    return {
        deleteBackupFilesService: vi.fn(async function () {
            auditMocks.state.events.push('core-delete')
            retentionMocks.state.fileExists = false
        }),
    }
})

vi.mock('@/server/Admin/Backups/run-registry.service.ts', function () {
    return { getBackupRunById: vi.fn() }
})

vi.mock('@/server/Admin/Backups/settings.service.ts', function () {
    return {
        getOrCreateBackupSettings: vi.fn(),
        serializeBackupSettings: vi.fn(),
    }
})

vi.mock('@/server/Logging/logger.ts', function () {
    return { logError: vi.fn() }
})

const mockedGetBackupSettings = getOrCreateBackupSettings as Mock<
    typeof getOrCreateBackupSettings
>
const mockedSerializeBackupSettings = serializeBackupSettings as Mock<
    typeof serializeBackupSettings
>
const candidate = {
    id: '019f5b07-80e2-7000-8000-000000000001',
    status: 'completed',
    targetKey: 'local',
    fileName: 'shared.tar',
}

const mockedGetBackupRunById = getBackupRunById as Mock<typeof getBackupRunById>

function selectRetention(runs: Array<Record<string, unknown>>) {
    retentionMocks.state.retentionRuns = runs.map((run) => ({
        ...run,
        startedAt: new Date(0),
    }))
    mockedGetBackupSettings.mockResolvedValue({} as never)
    mockedSerializeBackupSettings.mockReturnValue({
        retentionMode: 'count',
        retentionCount: 0,
        retentionDays: 0,
    } as never)
}

describe('Backup-Retention', function () {
    beforeEach(function () {
        vi.clearAllMocks()
        auditMocks.reset()
        mutationMocks.reset()
        retentionMocks.state.fileExists = true
        retentionMocks.state.retentionRuns = []
        mockedGetBackupRunById.mockResolvedValue(candidate as never)
        retentionMocks.state.referencedRuns = [candidate]
    })

    it('behält eine Datei mit gleicher Referenz unter einem Legacy-Ziel', async function () {
        retentionMocks.state.referencedRuns = [
            candidate,
            {
                ...candidate,
                id: '019f5b07-80e2-7000-8000-000000000002',
                targetKey: 'nas',
            },
        ]

        await expect(
            deleteBackupService(candidate.id, 'actor-policy'),
        ).resolves.toEqual({
            success: true,
        })

        expect(retentionMocks.deleteWhere).toHaveBeenCalledTimes(1)
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
    })

    it('löscht die letzte Dateireferenz ohne Legacy-Zielparameter', async function () {
        await expect(
            deleteBackupService(candidate.id, 'actor-policy'),
        ).resolves.toEqual({
            success: true,
        })
        expect(deleteBackupFilesService).toHaveBeenCalledWith(['shared.tar'])
    })

    it('rollt die gelöschte Run-Referenz bei Auditfehler vor jedem Core-Auftrag zurück', async function () {
        auditMocks.state.failAction = 'admin.backups.deleted'

        await expect(
            deleteBackupService(candidate.id, 'actor-user'),
        ).rejects.toThrow('audit insert')

        expect(retentionMocks.state.referencedRuns).toEqual([candidate])
        expect(retentionMocks.state.fileExists).toBe(true)
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
        expect(auditMocks.state.records).toEqual([])
        expect(auditMocks.state.events).toEqual([
            'prepare',
            'begin',
            'actor-lock',
            'table-lock',
            'run-locks',
            'run-delete',
            'audit:admin.backups.deleted',
            'rollback',
        ])
    })

    it('schreibt den Actor vor Dateilöschung fest und publiziert erst nach Commit', async function () {
        await deleteBackupService(candidate.id, 'actor-user')

        expect(retentionMocks.state.referencedRuns).toEqual([])
        expect(auditMocks.state.records).toEqual([
            expect.objectContaining({
                action: 'admin.backups.deleted',
                actorUserId: 'actor-user',
                oldValues: { backupId: candidate.id },
            }),
        ])
        expect(auditMocks.state.events).toEqual([
            'prepare',
            'begin',
            'actor-lock',
            'table-lock',
            'run-locks',
            'run-delete',
            'audit:admin.backups.deleted',
            'core-delete',
            'commit',
            'publish-audit',
            'publish-realtime',
        ])
    })

    it('behält Run und fehlendes Audit bei Core-Fehler konsistent', async function () {
        const remove = deleteBackupFilesService as Mock<
            typeof deleteBackupFilesService
        >
        remove.mockRejectedValueOnce(new Error('synthetic rm failed'))

        await expect(
            deleteBackupService(candidate.id, 'actor-user'),
        ).rejects.toThrow('rm failed')

        expect(retentionMocks.state.referencedRuns).toEqual([candidate])
        expect(auditMocks.state.records).toEqual([])
        expect(auditMocks.publish).not.toHaveBeenCalled()
    })

    it('bildet die nicht rollbackfähige Dateilöschung bei anschließendem Commitfehler ab', async function () {
        auditMocks.state.failCommit = true

        await expect(
            deleteBackupService(candidate.id, 'actor-user'),
        ).rejects.toThrow('commit failed')

        expect(retentionMocks.state.referencedRuns).toEqual([candidate])
        expect(retentionMocks.state.fileExists).toBe(false)
        expect(auditMocks.state.records).toEqual([])
        expect(auditMocks.publish).not.toHaveBeenCalled()
    })

    it.each(backupMutationRevocations)(
        'löscht weder Run noch Archiv bei Actor-Widerruf vor dem Lock: %s',
        async function (revocation) {
            mutationMocks.revokeAtLock(revocation)
            await expect(
                deleteBackupService(candidate.id, 'actor-policy'),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(retentionMocks.deleteWhere).not.toHaveBeenCalled()
            expect(retentionMocks.execute).not.toHaveBeenCalled()
            expect(deleteBackupFilesService).not.toHaveBeenCalled()
            expect(retentionMocks.state.referencedRuns).toEqual([candidate])
            expect(retentionMocks.state.fileExists).toBe(true)
            expect(auditMocks.state.records).toEqual([])
            expect(auditMocks.publish).not.toHaveBeenCalled()
        },
    )

    it.each([null, undefined, ''])(
        'behandelt einen fehlenden öffentlichen Actor niemals als Retention: %s',
        async function (actor) {
            await expect(
                Reflect.apply(deleteBackupService, undefined, [
                    candidate.id,
                    actor,
                ]),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(retentionMocks.deleteWhere).not.toHaveBeenCalled()
            expect(deleteBackupFilesService).not.toHaveBeenCalled()
            expect(auditMocks.state.records).toEqual([])
        },
    )

    it('führt automatische Retention ausdrücklich ohne Benutzerprüfung mit System-Audit aus', async function () {
        mutationMocks.state.exists = false
        mutationMocks.state.permissionKeys = []
        retentionMocks.state.retentionRuns = [
            { ...candidate, startedAt: new Date(0) },
        ]
        mockedGetBackupSettings.mockResolvedValue({} as never)
        mockedSerializeBackupSettings.mockReturnValue({
            retentionMode: 'count',
            retentionCount: 0,
            retentionDays: 0,
        } as never)
        await applyBackupRetentionBestEffort()
        expect(retentionMocks.state.referencedRuns).toEqual([])
        expect(deleteBackupFilesService).toHaveBeenCalledTimes(1)
        expect(mutationMocks.lockUsers).not.toHaveBeenCalled()
        expect(mutationMocks.selectPolicy).not.toHaveBeenCalled()
        expect(auditMocks.state.records).toEqual([
            expect.objectContaining({ actorUserId: null }),
        ])
    })

    it('bewahrt die geschützte Run-ID auch in der internen Retention', async function () {
        retentionMocks.state.retentionRuns = [
            { ...candidate, startedAt: new Date(0) },
        ]
        mockedGetBackupSettings.mockResolvedValue({} as never)
        mockedSerializeBackupSettings.mockReturnValue({
            retentionMode: 'count',
            retentionCount: 0,
            retentionDays: 0,
        } as never)
        await applyBackupRetentionBestEffort(new Set([candidate.id]))
        expect(retentionMocks.state.referencedRuns).toEqual([candidate])
        expect(retentionMocks.deleteWhere).not.toHaveBeenCalled()
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
        expect(auditMocks.state.records).toEqual([])
    })

    it('entfernt ausgewählte gemeinsame Referenzen mit einer Transaktion und einem Core-Auftrag', async () => {
        const second = { ...candidate, id: 'second' }
        retentionMocks.state.referencedRuns = [second, candidate]
        selectRetention([second, candidate])
        await applyBackupRetentionBestEffort()
        expect(retentionMocks.database.transaction).toHaveBeenCalledTimes(1)
        expect(deleteBackupFilesService).toHaveBeenCalledTimes(1)
        expect(deleteBackupFilesService).toHaveBeenCalledWith(['shared.tar'])
        expect(retentionMocks.state.referencedRuns).toEqual([])
        expect(
            auditMocks.state.records.map((record) => record.oldValues),
        ).toEqual([{ backupId: candidate.id }, { backupId: second.id }])
        const events = auditMocks.state.events
        expect(events.indexOf('table-lock')).toBeLessThan(
            events.indexOf('run-locks'),
        )
        expect(events.lastIndexOf('audit:admin.backups.deleted')).toBeLessThan(
            events.indexOf('core-delete'),
        )
        expect(events.indexOf('commit')).toBeLessThan(
            events.indexOf('publish-audit'),
        )
    })

    it('verwendet für verschiedene physische Dateien getrennte Transaktionen', async () => {
        const second = { ...candidate, id: 'second', fileName: 'second.tar' }
        retentionMocks.state.referencedRuns = [candidate, second]
        selectRetention([candidate, second])
        await applyBackupRetentionBestEffort()
        expect(retentionMocks.database.transaction).toHaveBeenCalledTimes(2)
        expect(deleteBackupFilesService).toHaveBeenNthCalledWith(1, [
            'shared.tar',
        ])
        expect(deleteBackupFilesService).toHaveBeenNthCalledWith(2, [
            'second.tar',
        ])
        expect(
            auditMocks.state.events.filter((event) => event === 'commit'),
        ).toHaveLength(2)
    })

    it('bewahrt bei einer geschützten gemeinsamen Referenz die Datei', async () => {
        const protectedRun = { ...candidate, id: 'protected' }
        retentionMocks.state.referencedRuns = [candidate, protectedRun]
        selectRetention([candidate, protectedRun])
        await applyBackupRetentionBestEffort(new Set([protectedRun.id]))
        expect(retentionMocks.state.referencedRuns).toEqual([protectedRun])
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
    })

    it.each(['queued', 'running'])(
        'löscht abgeschlossene Katalogeinträge und erhält gemeinsame %s-Referenzen samt Datei',
        async (status) => {
            const active = { ...candidate, id: 'active', status }
            retentionMocks.state.referencedRuns = [candidate, active]
            selectRetention([candidate])
            await applyBackupRetentionBestEffort()
            expect(retentionMocks.state.referencedRuns).toEqual([active])
            expect(retentionMocks.deleteWhere).toHaveBeenCalledTimes(1)
            expect(deleteBackupFilesService).not.toHaveBeenCalled()
            expect(auditMocks.state.records).toHaveLength(1)
            retentionMocks.state.referencedRuns = [candidate, active]
            await expect(
                deleteBackupService(candidate.id, 'actor-user'),
            ).resolves.toEqual({ success: true })
            expect(retentionMocks.state.referencedRuns).toEqual([active])
            expect(retentionMocks.deleteWhere).toHaveBeenCalledTimes(2)
            expect(deleteBackupFilesService).not.toHaveBeenCalled()
            expect(auditMocks.state.records).toHaveLength(2)
        },
    )

    it('bereinigt einen Katalogeintrag ohne Dateinamen ohne Dateisystemzugriff', async () => {
        const empty = { ...candidate, fileName: '' }
        mockedGetBackupRunById.mockResolvedValueOnce(empty as never)
        retentionMocks.state.referencedRuns = [empty]
        await expect(
            deleteBackupService(candidate.id, 'actor-user'),
        ).resolves.toEqual({ success: true })
        expect(retentionMocks.state.referencedRuns).toEqual([])
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
        expect(auditMocks.state.records).toHaveLength(1)
    })

    it('fasst einen vor dem Tabellen-Lock geänderten Dateinamen nicht an', async () => {
        retentionMocks.state.referencedRuns = [
            { ...candidate, fileName: 'changed.tar' },
        ]
        await expect(
            deleteBackupService(candidate.id, 'actor-user'),
        ).rejects.toThrow()
        expect(retentionMocks.deleteWhere).not.toHaveBeenCalled()
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
        expect(auditMocks.publish).not.toHaveBeenCalled()
    })

    it('zählt vor Lock-Erhalt neu eingetroffene Referenzen mit', async () => {
        const added = { ...candidate, id: 'new-reference' }
        retentionMocks.execute.mockImplementationOnce(async () => {
            auditMocks.state.events.push('table-lock')
            retentionMocks.state.referencedRuns.push(added)
        })
        await deleteBackupService(candidate.id, 'actor-user')
        expect(retentionMocks.state.referencedRuns).toEqual([added])
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
    })

    it('lässt ungültige Dateinamen und inzwischen nicht abgeschlossene Retention unverändert', async () => {
        const malformed = {
            ...candidate,
            id: 'bad',
            fileName: '../outside.tar',
        }
        retentionMocks.state.referencedRuns = [
            { ...candidate, status: 'failed' },
            malformed,
        ]
        selectRetention([candidate, malformed])
        await applyBackupRetentionBestEffort()
        expect(retentionMocks.deleteWhere).not.toHaveBeenCalled()
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
        expect(auditMocks.state.records).toEqual([])
    })

    it('rollt alle gemeinsamen Referenzen bei einem späteren Auditfehler vor dem Unlink zurück', async () => {
        const second = { ...candidate, id: 'second' }
        retentionMocks.state.referencedRuns = [candidate, second]
        selectRetention([candidate, second])
        auditMocks.write.mockImplementationOnce(async () => auditMocks.receipt)
        auditMocks.state.failAction = 'admin.backups.deleted'
        await applyBackupRetentionBestEffort()
        expect(retentionMocks.state.referencedRuns).toEqual([candidate, second])
        expect(deleteBackupFilesService).not.toHaveBeenCalled()
        expect(auditMocks.state.records).toEqual([])
    })
})
