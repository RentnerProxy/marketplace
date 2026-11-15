import { IMAGE_UPLOAD_CONFIG } from '@/config/image-upload.config.ts'
import { PermissionDeniedError } from '@/server/Auth/authorization.errors.ts'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    setSystemTime,
} from 'bun:test'
import {
    SYSTEM_SETTINGS_ACTOR_ID,
    SYSTEM_SETTINGS_REVOCATIONS,
    revokeSystemSettingsActor,
    effects,
    imageInstances,
    imageMocks,
    installSystemSettingsTestMocks,
    maintenanceRequest,
    resetSystemSettingsTestState,
    systemSettingsDb,
    systemSettingsExternal,
} from './update.test.helpers.ts'

installSystemSettingsTestMocks()
const { updateCompanyNameService, updateSystemLogoService } =
    await import('@/server/Admin/SystemSettings/branding.service.ts')
const { resolveMaintenanceExtensionRequestService } =
    await import('@/server/Admin/SystemSettings/maintenance-extension.service.ts')
const { updateMaintenanceModeService } =
    await import('@/server/Admin/SystemSettings/maintenance-mode.service.ts')

const actor = SYSTEM_SETTINGS_ACTOR_ID
const logoInput = {
    imageDataUrl: 'data:image/png;base64,AAAA',
    crop: { x: 0, y: 0, width: 100, height: 100 },
}
function claimMaintenanceRequest() {
    const request = maintenanceRequest()
    systemSettingsExternal.getRequest.mockResolvedValue(request)
    systemSettingsExternal.clearRequest.mockResolvedValue(request)
    return request
}
function expectNoDomainPublish() {
    expect(systemSettingsExternal.publishSettings).not.toHaveBeenCalled()
    expect(systemSettingsExternal.publishState).not.toHaveBeenCalled()
    expect(systemSettingsExternal.publishResolution).not.toHaveBeenCalled()
}
function expectAllEffectsAfterCommit(action: string) {
    const published = effects.filter((effect) =>
        effect.kind.startsWith('publish:'),
    )
    expect(published.length).toBeGreaterThan(0)
    expect(
        published.every(
            (effect) =>
                effect.activeTransaction === 0 &&
                effect.committedAuditActions.includes(action),
        ),
    ).toBe(true)
}
function settingUpdates() {
    return systemSettingsDb.state.events.filter(
        (event) =>
            event.operation === 'update' && event.table === 'systemSettings',
    )
}
function mutate(operation: string) {
    if (operation === 'company')
        return updateCompanyNameService({ companyName: 'Neue Firma' }, actor)
    if (operation === 'logo') return updateSystemLogoService(logoInput, actor)
    if (operation === 'maintenance')
        return updateMaintenanceModeService(
            { isEnabled: true, startsAt: '2026-01-02T12:00:00.000Z' },
            actor,
        )
    const request = claimMaintenanceRequest()
    return resolveMaintenanceExtensionRequestService(
        {
            requestId: request.id,
            status: operation === 'reject-extension' ? 'rejected' : 'approved',
            extensionMinutes: 15,
        },
        actor,
    )
}

describe('SystemSettings Update-Services', function () {
    beforeEach(function () {
        vi.useFakeTimers()
        setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
        resetSystemSettingsTestState()
    })
    afterEach(function () {
        vi.useRealTimers()
    })

    it('weist einen leeren Firmennamen vor dem Schreiben zurück', async function () {
        await expect(
            updateCompanyNameService({ companyName: '   ' }, actor),
        ).resolves.toEqual({
            success: false,
            error: 'Firmenname ist erforderlich.',
        })
        expect(systemSettingsDb.state.events).toHaveLength(0)
        expectNoDomainPublish()
    })

    it('aktualisiert den Firmennamen, publiziert und auditiert ihn', async function () {
        const settings = systemSettingsDb.state.rows.systemSettings[0]
        settings.isMaintenanceModeEnabled = true
        settings.maintenanceStartsAt = new Date('2026-01-02T12:00:00.000Z')
        const result = await updateCompanyNameService(
            { companyName: '  Neue Firma  ' },
            actor,
        )

        expect(settingUpdates()[0].values).toMatchObject({
            companyName: 'Neue Firma',
        })
        expect(systemSettingsExternal.publishSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                companyName: 'Neue Firma',
                isMaintenanceModeEnabled: true,
                maintenanceStartsAt: '2026-01-02T12:00:00.000Z',
            }),
        )
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(1)
        expect(systemSettingsDb.state.rows.auditLogs[0]).toMatchObject({
            actorUserId: actor,
            action: 'admin.system.company_name_updated',
            message: 'Firmenname wurde aktualisiert.',
            oldValues: { companyName: 'Alte Firma' },
            newValues: { companyName: 'Neue Firma' },
        })
        expect(systemSettingsDb.state.events[1]).toMatchObject({
            operation: 'lock:update',
            table: 'users',
            ids: [actor],
        })
        const settingsLock = systemSettingsDb.state.events.findIndex(
            (event) =>
                event.table === 'systemSettings' &&
                event.operation === 'lock:update',
        )
        expect(settingsLock).toBeGreaterThan(1)
        expectAllEffectsAfterCommit('admin.system.company_name_updated')
        expect(result).toEqual({ success: true, companyName: 'Neue Firma' })
    })

    it('liefert den normalisierten Namen trotz Realtime-Ausfall zurück', async function () {
        const error = new Error('Realtime offline')
        systemSettingsExternal.publishSettings.mockRejectedValueOnce(error)
        const result = await updateCompanyNameService(
            { companyName: 'Fallback Firma' },
            actor,
        )
        expect(result).toEqual({ success: true, companyName: 'Fallback Firma' })
        expect(systemSettingsExternal.logError).toHaveBeenCalledWith(
            'system_settings.company_name_publish_failed',
            error,
            undefined,
        )
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(1)
        expect(systemSettingsDb.state.rows.systemSettings[0].companyName).toBe(
            'Fallback Firma',
        )
    })

    it('erzeugt Logo-Varianten und Favicon ohne reale Dateizugriffe', async function () {
        const result = await updateSystemLogoService(logoInput, actor)
        expect(systemSettingsExternal.sharp).toHaveBeenCalledTimes(3)
        expect(systemSettingsExternal.publishBranding).toHaveBeenCalledTimes(1)
        expect(systemSettingsExternal.publishBranding).toHaveBeenCalledWith(
            await imageInstances[0].toBuffer.mock.results[0]?.value,
            await imageInstances[1].toBuffer.mock.results[0]?.value,
            Buffer.from('ico'),
        )
        expect(imageMocks.createIco).toHaveBeenCalledWith(Buffer.from('png'))
        expect(systemSettingsExternal.withShared).toHaveBeenCalledTimes(1)
        expect(systemSettingsExternal.publishSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                companyName: 'Alte Firma',
                logoSrc: '/images/logo.webp?v=version-1',
                logoSrc64: '/images/logo-64.webp?v=version-1',
                faviconSrc: '/favicon.ico?v=version-1',
            }),
        )
        expect(
            systemSettingsDb.state.rows.auditLogs.map((row) => row.action),
        ).toEqual([
            'admin.system.logo_update_started',
            'admin.system.logo_updated',
        ])
        expect(
            systemSettingsDb.state.rows.auditLogs.every(
                (row) => row.actorUserId === actor,
            ),
        ).toBe(true)
        const start = systemSettingsDb.state.rows.auditLogs[0]
            .newValues as Record<string, unknown>
        const finish = systemSettingsDb.state.rows.auditLogs[1]
            .newValues as Record<string, unknown>
        expect(typeof start.operationId).toBe('string')
        expect(finish.operationId).toBe(start.operationId)
        expect(
            effects
                .filter((effect) => ['branding-files'].includes(effect.kind))
                .every(
                    (effect) =>
                        effect.activeTransaction === 2 &&
                        effect.actorLocked &&
                        effect.committedAuditActions.length === 1 &&
                        effect.committedAuditActions[0] ===
                            'admin.system.logo_update_started',
                ),
        ).toBe(true)
        expect(
            effects.filter((effect) => effect.kind === 'publish:settings'),
        ).toEqual([
            {
                kind: 'publish:settings',
                activeTransaction: 0,
                actorLocked: false,
                committedAuditActions: [
                    'admin.system.logo_update_started',
                    'admin.system.logo_updated',
                ],
            },
        ])
        expect(result).toEqual({
            success: true,
            logoSrc: '/images/logo.webp?v=version-1',
            logoSrc64: '/images/logo-64.webp?v=version-1',
            faviconSrc: '/favicon.ico?v=version-1',
        })
    })

    it('weist Wartungsstarts in der Vergangenheit zurück', async function () {
        await expect(
            updateMaintenanceModeService(
                {
                    isEnabled: true,
                    startsAt: '2026-01-01T11:59:00.000Z',
                },
                actor,
            ),
        ).resolves.toEqual({
            success: false,
            error: 'Der Startzeitpunkt muss in der Zukunft liegen.',
        })
        expect(systemSettingsDb.state.events).toHaveLength(0)
    })

    it('aktiviert geplante Wartung und toleriert Publish-Ausfälle', async function () {
        const publishError = new Error('Publish offline')
        systemSettingsExternal.publishSettings.mockRejectedValueOnce(
            publishError,
        )
        systemSettingsExternal.publishState.mockRejectedValueOnce(publishError)
        const result = await updateMaintenanceModeService(
            {
                isEnabled: true,
                startsAt: '2026-01-02T12:00:00.000Z',
            },
            actor,
        )
        expect(result).toEqual({
            success: true,
            isMaintenanceModeEnabled: true,
            maintenanceStartsAt: '2026-01-02T12:00:00.000Z',
        })
        expect(systemSettingsExternal.logError).toHaveBeenCalledWith(
            'maintenance.settings_publish_failed',
            publishError,
            undefined,
        )
        expect(systemSettingsExternal.logError).toHaveBeenCalledWith(
            'maintenance.state_publish_failed',
            publishError,
            undefined,
        )
        expect(systemSettingsDb.state.rows.auditLogs[0].action).toBe(
            'admin.system.maintenance_updated',
        )
    })

    it('deaktiviert Wartung und lehnt einen offenen Antrag ab', async function () {
        const request = maintenanceRequest()
        systemSettingsExternal.clearRequest.mockResolvedValueOnce(request)
        const result = await updateMaintenanceModeService(
            { isEnabled: false },
            actor,
        )
        expect(result).toEqual({
            success: true,
            isMaintenanceModeEnabled: false,
            maintenanceStartsAt: null,
        })
        expect(systemSettingsExternal.publishResolution).toHaveBeenCalledWith({
            requestId: request.id,
            userId: request.userId,
            status: 'rejected',
            maintenanceStartsAt: null,
            resolvedAt: '2026-01-01T12:00:00.000Z',
        })
        expectAllEffectsAfterCommit('admin.system.maintenance_updated')
    })

    it('deaktiviert Wartung auch bei fehlgeschlagenem Request-Cleanup', async function () {
        const error = new Error('Store offline')
        systemSettingsExternal.clearRequest.mockRejectedValueOnce(error)
        await expect(
            updateMaintenanceModeService({ isEnabled: false }, actor),
        ).resolves.toMatchObject({ success: true })
        expect(systemSettingsExternal.logError).toHaveBeenCalledWith(
            'maintenance.pending_request_clear_failed',
            error,
        )
        expectAllEffectsAfterCommit('admin.system.maintenance_updated')
    })

    it('weist nicht mehr offene oder parallel bearbeitete Requests zurück', async function () {
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: 'missing', status: 'rejected' },
                actor,
            ),
        ).resolves.toMatchObject({
            success: false,
            error: 'Der Antrag ist nicht mehr offen.',
        })
        const request = maintenanceRequest()
        systemSettingsExternal.getRequest.mockResolvedValueOnce(request)
        systemSettingsExternal.clearRequest.mockResolvedValueOnce(null)
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'rejected' },
                actor,
            ),
        ).resolves.toEqual({
            success: false,
            error: 'Der Antrag wurde bereits bearbeitet.',
        })
        expect(
            systemSettingsDb.state.events.filter((event) =>
                ['insert', 'update', 'delete'].includes(event.operation),
            ),
        ).toHaveLength(0)
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(0)
        expect(systemSettingsExternal.setRequest).not.toHaveBeenCalled()
        expectNoDomainPublish()
    })

    it('genehmigt einen Request und verlängert den bestehenden Termin', async function () {
        const request = claimMaintenanceRequest()
        systemSettingsDb.state.rows.systemSettings[0].companyName = 'Firma'
        systemSettingsDb.state.rows.systemSettings[0].maintenanceStartsAt =
            new Date('2026-01-01T13:00:00.000Z')
        const result = await resolveMaintenanceExtensionRequestService(
            {
                requestId: request.id,
                status: 'approved',
                extensionMinutes: 15,
            },
            actor,
        )
        expect(settingUpdates()[0].values).toEqual({
            isMaintenanceModeEnabled: true,
            maintenanceStartsAt: new Date('2026-01-01T13:15:00.000Z'),
            updatedAt: new Date('2026-01-01T12:00:00.000Z'),
        })
        expect(systemSettingsExternal.publishSettings).toHaveBeenCalled()
        expect(systemSettingsExternal.publishResolution).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: request.id,
                status: 'approved',
                maintenanceStartsAt: '2026-01-01T13:15:00.000Z',
            }),
        )
        expectAllEffectsAfterCommit(
            'admin.system.maintenance_extension_resolved',
        )
        expect(result).toEqual({ success: true })
    })

    it('lehnt einen Request ab, ohne den Wartungstermin zu ändern', async function () {
        const request = claimMaintenanceRequest()
        systemSettingsDb.state.rows.systemSettings[0].isMaintenanceModeEnabled = true
        systemSettingsDb.state.rows.systemSettings[0].maintenanceStartsAt =
            new Date('2026-01-01T13:00:00.000Z')
        const before = structuredClone(
            systemSettingsDb.state.rows.systemSettings,
        )
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'rejected' },
                actor,
            ),
        ).resolves.toEqual({ success: true })
        expect(settingUpdates()).toHaveLength(0)
        expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
        expect(systemSettingsExternal.publishSettings).not.toHaveBeenCalled()
        expect(systemSettingsDb.state.rows.auditLogs[0]).toMatchObject({
            actorUserId: actor,
            action: 'admin.system.maintenance_extension_resolved',
            message: 'Wartungsverlängerung wurde abgelehnt.',
        })
        expectAllEffectsAfterCommit(
            'admin.system.maintenance_extension_resolved',
        )
    })

    it('stellt einen beanspruchten Request nach Servicefehler wieder her', async function () {
        const request = claimMaintenanceRequest()
        const serviceError = new Error('Settings-DB offline')
        systemSettingsDb.state.failTable = 'systemSettings'
        systemSettingsDb.state.persistenceError = serviceError
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'approved' },
                actor,
            ),
        ).rejects.toBe(serviceError)
        expect(systemSettingsExternal.setRequest).toHaveBeenCalledWith(request)
        expectNoDomainPublish()
    })

    it('protokolliert Konflikte und Fehler der Kompensation', async function () {
        const request = claimMaintenanceRequest()
        const serviceError = new Error('Settings-DB offline')
        systemSettingsDb.state.failTable = 'systemSettings'
        systemSettingsDb.state.persistenceError = serviceError
        systemSettingsExternal.setRequest.mockResolvedValueOnce(false)
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'approved' },
                actor,
            ),
        ).rejects.toBe(serviceError)
        expect(systemSettingsExternal.logError).toHaveBeenCalledWith(
            'maintenance.request_compensation_conflict',
            expect.any(Error),
            { requestId: request.id },
        )
        systemSettingsExternal.logError.mockClear()
        systemSettingsExternal.setRequest.mockRejectedValueOnce(
            new Error('Store offline'),
        )
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'approved' },
                actor,
            ),
        ).rejects.toBe(serviceError)
        expect(systemSettingsExternal.logError).toHaveBeenCalledWith(
            'maintenance.request_compensation_failed',
            expect.any(Error),
            { requestId: request.id },
        )
    })

    it.each([
        'company',
        'logo',
        'maintenance',
        'approve-extension',
        'reject-extension',
    ])(
        'rollt %s mit seinem Audit bei Auditfehler zurück und publiziert kein Ergebnis',
        async function (operation) {
            const before = structuredClone(
                systemSettingsDb.state.rows.systemSettings,
            )
            systemSettingsDb.state.failAuditAction =
                operation === 'logo' ? 'admin.system.logo_updated' : null
            if (operation !== 'logo')
                systemSettingsDb.state.failTable = 'auditLogs'
            await expect(mutate(operation)).rejects.toThrow(
                'Injected persistence failure',
            )
            expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
            expect(
                systemSettingsDb.state.rows.auditLogs.map((row) => row.action),
            ).toEqual(
                operation === 'logo'
                    ? ['admin.system.logo_update_started']
                    : [],
            )
            expectNoDomainPublish()
            if (operation.endsWith('extension'))
                expect(systemSettingsExternal.setRequest).toHaveBeenCalledWith(
                    maintenanceRequest(),
                )
            if (operation === 'logo')
                expect(
                    systemSettingsExternal.publishBranding,
                ).toHaveBeenCalledTimes(1)
        },
    )

    it.each(['company', 'logo', 'maintenance', 'approve-extension'])(
        'weist fehlendes Returning bei %s zurück und rollt die fachliche Änderung zurück',
        async function (operation) {
            const before = structuredClone(
                systemSettingsDb.state.rows.systemSettings,
            )
            systemSettingsDb.state.emptyReturningTable = 'systemSettings'
            await expect(mutate(operation)).rejects.toThrow(
                'Die Systemeinstellungen konnten nicht aktualisiert werden.',
            )
            expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
            expect(
                systemSettingsDb.state.rows.auditLogs.map((row) => row.action),
            ).toEqual(
                operation === 'logo'
                    ? ['admin.system.logo_update_started']
                    : [],
            )
            expectNoDomainPublish()
            if (operation.endsWith('extension'))
                expect(systemSettingsExternal.setRequest).toHaveBeenCalledWith(
                    maintenanceRequest(),
                )
        },
    )

    it.each([
        'company',
        'logo',
        'maintenance',
        'approve-extension',
        'reject-extension',
    ])(
        'gibt bei Commitfehler für %s keinen Erfolg oder Publisher frei',
        async function (operation) {
            const before = structuredClone(
                systemSettingsDb.state.rows.systemSettings,
            )
            systemSettingsDb.state.failCommitTransaction =
                operation === 'logo' ? 2 : 1
            await expect(mutate(operation)).rejects.toThrow(
                'Injected transaction commit failure',
            )
            expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
            expect(
                systemSettingsDb.state.rows.auditLogs.map((row) => row.action),
            ).toEqual(
                operation === 'logo'
                    ? ['admin.system.logo_update_started']
                    : [],
            )
            expectNoDomainPublish()
            expect(systemSettingsExternal.publishAudit).toHaveBeenCalledTimes(
                operation === 'logo' ? 1 : 0,
            )
            if (operation.endsWith('extension'))
                expect(systemSettingsExternal.setRequest).toHaveBeenCalledWith(
                    maintenanceRequest(),
                )
        },
    )

    it('stoppt Logo-Dateischreibzugriffe vollständig, wenn das persistente Startaudit ausfällt', async function () {
        systemSettingsDb.state.failTable = 'auditLogs'
        await expect(updateSystemLogoService(logoInput, actor)).rejects.toThrow(
            'Injected persistence failure',
        )
        expect(systemSettingsExternal.publishBranding).not.toHaveBeenCalled()
        expect(systemSettingsExternal.sharp).not.toHaveBeenCalled()
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(0)
        expectNoDomainPublish()
    })

    it('rollt eine erstmalig angelegte Settingszeile zusammen mit dem fehlgeschlagenen Audit zurück', async function () {
        systemSettingsDb.state.rows.systemSettings = []
        systemSettingsDb.state.failTable = 'auditLogs'
        await expect(
            updateCompanyNameService({ companyName: 'Neue Firma' }, actor),
        ).rejects.toThrow('Injected persistence failure')
        expect(systemSettingsDb.state.rows.systemSettings).toHaveLength(0)
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(0)
        expectNoDomainPublish()
    })

    it('führt nach Commit alle eigenständigen Publisher auch bei früheren Ausfällen aus', async function () {
        const request = claimMaintenanceRequest()
        const error = new Error('Realtime offline')
        systemSettingsExternal.publishAudit.mockRejectedValueOnce(error)
        systemSettingsExternal.publishSettings.mockRejectedValueOnce(error)
        systemSettingsExternal.publishState.mockRejectedValueOnce(error)
        systemSettingsExternal.publishResolution.mockRejectedValueOnce(error)
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'approved' },
                actor,
            ),
        ).resolves.toEqual({ success: true })
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(1)
        expect(
            systemSettingsDb.state.rows.systemSettings[0]
                .isMaintenanceModeEnabled,
        ).toBe(true)
        expect(systemSettingsExternal.publishAudit).toHaveBeenCalledTimes(1)
        expect(systemSettingsExternal.publishSettings).toHaveBeenCalledTimes(1)
        expect(systemSettingsExternal.publishState).toHaveBeenCalledTimes(1)
        expect(systemSettingsExternal.publishResolution).toHaveBeenCalledTimes(
            1,
        )
        expect(systemSettingsExternal.setRequest).not.toHaveBeenCalled()
        expect(systemSettingsExternal.logError).toHaveBeenCalledTimes(4)
    })
})

describe('system settings mutation actor lifetime', function () {
    beforeEach(function () {
        resetSystemSettingsTestState()
    })

    it.each([...SYSTEM_SETTINGS_REVOCATIONS])(
        'retains only the committed intent when logo access becomes %s',
        async function (revocation) {
            const before = structuredClone(
                systemSettingsDb.state.rows.systemSettings,
            )
            imageMocks.createIco.mockImplementationOnce(function () {
                revokeSystemSettingsActor(revocation)
                return Buffer.from('synthetic-ico')
            })
            await expect(
                updateSystemLogoService(logoInput, actor),
            ).rejects.toBeInstanceOf(PermissionDeniedError)
            expect(
                systemSettingsExternal.publishBranding,
            ).not.toHaveBeenCalled()
            expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
            expect(
                systemSettingsDb.state.rows.auditLogs.map((row) => row.action),
            ).toEqual(['admin.system.logo_update_started'])
            expect(
                systemSettingsDb.state.events.filter(
                    (event) =>
                        event.operation === 'lock:update' &&
                        event.table === 'users',
                ),
            ).toHaveLength(2)
            expect(systemSettingsExternal.publishAudit).toHaveBeenCalledTimes(1)
            expectNoDomainPublish()
        },
    )

    it('prepares bounded images outside the actor lock and holds the lock over every file', async function () {
        await updateSystemLogoService(logoInput, actor)
        const preparation = effects.filter(
            (effect) => effect.kind === 'image-buffer',
        )
        expect(preparation).toHaveLength(3)
        expect(
            preparation.every(
                (effect) =>
                    effect.activeTransaction === 0 &&
                    !effect.actorLocked &&
                    effect.committedAuditActions.length === 1 &&
                    effect.committedAuditActions[0] ===
                        'admin.system.logo_update_started',
            ),
        ).toBe(true)
        const fileEffects = effects.filter(
            (effect) => effect.activeTransaction > 0,
        )
        expect(fileEffects).toHaveLength(1)
        expect(
            fileEffects.every(
                (effect) =>
                    effect.activeTransaction === 2 &&
                    effect.actorLocked &&
                    effect.committedAuditActions.length === 1,
            ),
        ).toBe(true)
        expect(systemSettingsExternal.publishBranding).toHaveBeenCalledTimes(1)
        expect(settingUpdates()).toHaveLength(1)
        expect(settingUpdates()[0].transaction).toBe(2)
        const completedAudit = systemSettingsDb.state.events.find(
            (event) =>
                event.operation === 'insert' &&
                event.table === 'auditLogs' &&
                event.transaction === 2,
        )
        expect(completedAudit).toBeDefined()
    })

    it.each([0, IMAGE_UPLOAD_CONFIG.maxInputBytes + 1])(
        'rejects invalid prepared output size %i before publishing files',
        async function (size) {
            imageMocks.createIco.mockReturnValueOnce(Buffer.alloc(size))
            await expect(
                updateSystemLogoService(logoInput, actor),
            ).rejects.toThrow()
            expect(
                systemSettingsExternal.publishBranding,
            ).not.toHaveBeenCalled()
            expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(1)
            expect(systemSettingsDb.state.nextTransaction).toBe(1)
            expectNoDomainPublish()
        },
    )

    it('retains the intent when image preparation fails', async function () {
        const failure = new Error('synthetic image conversion failure')
        imageMocks.createIco.mockImplementationOnce(function () {
            throw failure
        })
        await expect(updateSystemLogoService(logoInput, actor)).rejects.toBe(
            failure,
        )
        expect(systemSettingsExternal.publishBranding).not.toHaveBeenCalled()
        expect(systemSettingsDb.state.rows.auditLogs).toHaveLength(1)
        expectNoDomainPublish()
    })

    it('rolls back metadata while preserving the intent after native publication failure', async function () {
        const before = structuredClone(
            systemSettingsDb.state.rows.systemSettings,
        )
        const failure = new Error('synthetic file publication failure')
        systemSettingsExternal.publishBranding.mockRejectedValueOnce(failure)
        await expect(updateSystemLogoService(logoInput, actor)).rejects.toBe(
            failure,
        )
        expect(systemSettingsDb.state.rows.systemSettings).toEqual(before)
        expect(
            systemSettingsDb.state.rows.auditLogs.map((row) => row.action),
        ).toEqual(['admin.system.logo_update_started'])
        expect(systemSettingsExternal.publishBranding).toHaveBeenCalledTimes(1)
        expect(
            systemSettingsDb.state.events.filter(
                (event) =>
                    event.transaction === 2 && event.operation === 'rollback',
            ),
        ).toHaveLength(1)
        expectNoDomainPublish()
    })

    it('claims an extension only while its verified actor remains locked', async function () {
        const request = claimMaintenanceRequest()
        systemSettingsExternal.clearRequest.mockImplementationOnce(
            async function () {
                expect(systemSettingsDb.state.activeTransaction).toBe(1)
                expect(
                    systemSettingsDb.state.events.some(
                        (event) =>
                            event.transaction === 1 &&
                            event.operation === 'lock:update' &&
                            event.table === 'users' &&
                            event.ids?.includes(actor),
                    ),
                ).toBe(true)
                return request
            },
        )
        await expect(
            resolveMaintenanceExtensionRequestService(
                { requestId: request.id, status: 'rejected' },
                actor,
            ),
        ).resolves.toEqual({ success: true })
        expect(systemSettingsExternal.setRequest).not.toHaveBeenCalled()
    })
})
