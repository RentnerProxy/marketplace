import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    AUDIT_TEST_ACTOR,
    createAuditTransactionTestModel,
} from '@/tests/lib/AuditLogs/audit-transaction.test.helpers.ts'
import {
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_PRIMARY_COLOR,
    DEFAULT_THEME_MODE,
} from '@/config/user-theme-colors.config.ts'

function noop() {}

const model = createAuditTransactionTestModel()
model.install()
const getSession = vi.fn(async function (): Promise<{
    id: string
    primaryColor: string
} | null> {
    return { id: AUDIT_TEST_ACTOR, primaryColor: 'stale session color' }
})
vi.mock('@/server/Auth/currentSession.ts', () => ({
    getCurrentUserSettingsSession: getSession,
}))
const {
    updateCurrentUserThemeModeService,
    updateCurrentUserFontFamilyService,
    updateCurrentUserFontSizeService,
    updateCurrentUserPrimaryColorService,
    resetCurrentUserPrimaryColorService,
} = await import('@/server/UserSettings/theme.service.ts')

const previous = {
    userId: AUDIT_TEST_ACTOR,
    themeMode: 'dark',
    fontFamily: 'inter',
    fontSize: 16,
    primaryColor: '#0a141e',
}
const cases = [
    {
        field: 'themeMode',
        value: 'light',
        persisted: 'light',
        action: 'user.theme_mode_updated',
        run: () => updateCurrentUserThemeModeService({ themeMode: 'light' }),
    },
    {
        field: 'fontFamily',
        value: 'mono',
        persisted: 'mono',
        action: 'user.font_family_updated',
        run: () => updateCurrentUserFontFamilyService({ fontFamily: 'mono' }),
    },
    {
        field: 'fontSize',
        value: 18,
        persisted: 18,
        action: 'user.font_size_updated',
        run: () => updateCurrentUserFontSizeService({ fontSize: 18 }),
    },
    {
        field: 'primaryColor',
        value: '#28323c',
        persisted: '#28323c',
        action: 'user.primary_color_updated',
        run: () =>
            updateCurrentUserPrimaryColorService({
                primaryColor: '#28323c',
            }),
    },
    {
        field: 'primaryColor',
        value: DEFAULT_PRIMARY_COLOR,
        persisted: null,
        action: 'user.primary_color_reset',
        run: resetCurrentUserPrimaryColorService,
    },
] as const

describe('User theme settings with mandatory audits', function () {
    beforeEach(function () {
        model.reset()
        model.state.rows.set('user_settings', { ...previous })
        getSession.mockResolvedValue({
            id: AUDIT_TEST_ACTOR,
            primaryColor: 'stale session color',
        })
    })

    for (const entry of cases) {
        it(
            entry.action +
                ' records the locked database value and returns only the public result',
            async function () {
                const result: unknown = await entry.run()
                expect(result).toEqual({
                    success: true,
                    [entry.field]: entry.value,
                })
                expect(
                    model.state.rows.get('user_settings')?.[entry.field],
                ).toBe(entry.persisted)
                expect(model.state.audits).toEqual([
                    expect.objectContaining({
                        actorUserId: AUDIT_TEST_ACTOR,
                        action: entry.action,
                        oldValues: { [entry.field]: previous[entry.field] },
                        newValues: { [entry.field]: entry.value },
                    }),
                ])
                expect(
                    model.state.events.indexOf(
                        'lock:users:' + AUDIT_TEST_ACTOR + ':update',
                    ),
                ).toBeLessThan(model.state.events.indexOf('read:user_settings'))
                expect(model.state.events.indexOf('commit')).toBeLessThan(
                    model.state.events.indexOf('publish-audit'),
                )
            },
        )

        it(
            entry.action +
                ' skips identical valid values after locking without a write, audit or publish',
            async function () {
                const matching = { ...previous, [entry.field]: entry.persisted }
                model.state.rows.set('user_settings', matching)
                model.state.failAction = entry.action
                model.state.emptyReturning = true

                const result: unknown = await entry.run()
                expect(result).toEqual({
                    success: true,
                    [entry.field]: entry.value,
                })

                expect(model.state.rows.get('user_settings')).toEqual(matching)
                expect(model.state.events).toContain('read:user_settings')
                expect(model.state.events).not.toContain('insert:user_settings')
                expect(model.state.events).not.toContain('insert:auditLogs')
                expect(model.state.events).toContain('commit')
                expect(model.state.audits).toEqual([])
                expect(model.publish).not.toHaveBeenCalled()
                expect(
                    model.state.events.indexOf(
                        'lock:users:' + AUDIT_TEST_ACTOR + ':update',
                    ),
                ).toBeLessThan(model.state.events.indexOf('read:user_settings'))
            },
        )

        it(
            entry.action +
                ' materializes a missing settings row and audits the write',
            async function () {
                model.state.rows.delete('user_settings')

                const result: unknown = await entry.run()
                expect(result).toEqual({
                    success: true,
                    [entry.field]: entry.value,
                })

                expect(
                    model.state.rows.get('user_settings')?.[entry.field],
                ).toBe(entry.persisted)
                expect(model.state.events).toContain('insert:user_settings')
                expect(model.state.audits).toHaveLength(1)
                expect(model.state.audits[0]?.action).toBe(entry.action)
                expect(model.publish).toHaveBeenCalledTimes(1)
            },
        )

        it(
            entry.action +
                ' repairs an invalid stored value instead of treating it as a default',
            async function () {
                model.state.rows.set('user_settings', {
                    ...previous,
                    [entry.field]: 'invalid stored preference',
                })

                const result: unknown = await entry.run()
                expect(result).toEqual({
                    success: true,
                    [entry.field]: entry.value,
                })

                expect(
                    model.state.rows.get('user_settings')?.[entry.field],
                ).toBe(entry.persisted)
                expect(model.state.events).toContain('insert:user_settings')
                expect(model.state.audits).toHaveLength(1)
                expect(model.state.audits[0]?.action).toBe(entry.action)
            },
        )

        for (const failure of [
            'audit',
            'empty receipt',
            'commit',
            'missing setting row',
        ]) {
            it(entry.action + ' rolls back on ' + failure, async function () {
                model.state.failAction =
                    failure === 'audit' ? entry.action : null
                model.state.auditReceipts =
                    failure === 'empty receipt' ? [] : null
                model.state.failCommit = failure === 'commit'
                model.state.emptyReturning = failure === 'missing setting row'
                await expect(entry.run()).rejects.toThrow()
                expect(model.state.rows.get('user_settings')).toEqual(previous)
                expect(model.state.audits).toEqual([])
                expect(model.publish).not.toHaveBeenCalled()
            })
        }
    }

    it('does not open a transaction for unauthenticated users', async function () {
        getSession.mockResolvedValue(null)
        const results = await Promise.all(cases.map((entry) => entry.run()))
        for (const result of results) {
            expect(result).toEqual({
                success: false,
                error: 'Du bist nicht angemeldet.',
            })
        }
        expect(model.database.transaction).not.toHaveBeenCalled()
    })

    it('retains committed settings and audit during realtime failure', async function () {
        model.state.failPublish = true
        await expect(
            updateCurrentUserThemeModeService({ themeMode: 'light' }),
        ).resolves.toEqual({ success: true, themeMode: 'light' })
        expect(model.state.rows.get('user_settings')?.themeMode).toBe('light')
        expect(model.state.audits).toHaveLength(1)
        expect(model.logger).toHaveBeenCalledTimes(1)
    })
    it('persists an explicit default color even when a null preference already displays that color', async function () {
        model.state.rows.set('user_settings', {
            ...previous,
            primaryColor: null,
        })

        await expect(
            updateCurrentUserPrimaryColorService({
                primaryColor: DEFAULT_PRIMARY_COLOR,
            }),
        ).resolves.toEqual({
            success: true,
            primaryColor: DEFAULT_PRIMARY_COLOR,
        })

        expect(model.state.rows.get('user_settings')?.primaryColor).toBe(
            DEFAULT_PRIMARY_COLOR,
        )
        expect(model.state.audits).toHaveLength(1)
        expect(model.state.audits[0]?.action).toBe('user.primary_color_updated')
    })

    it('clears an explicit default color when resetting instead of treating equal display values as a no-op', async function () {
        model.state.rows.set('user_settings', {
            ...previous,
            primaryColor: DEFAULT_PRIMARY_COLOR,
        })

        await expect(resetCurrentUserPrimaryColorService()).resolves.toEqual({
            success: true,
            primaryColor: DEFAULT_PRIMARY_COLOR,
        })

        expect(model.state.rows.get('user_settings')?.primaryColor).toBeNull()
        expect(model.state.audits).toHaveLength(1)
        expect(model.state.audits[0]?.action).toBe('user.primary_color_reset')
    })
    for (const defaults of [
        {
            field: 'themeMode',
            value: DEFAULT_THEME_MODE,
            run: () =>
                updateCurrentUserThemeModeService({
                    themeMode: DEFAULT_THEME_MODE,
                }),
        },
        {
            field: 'fontFamily',
            value: DEFAULT_FONT_FAMILY,
            run: () =>
                updateCurrentUserFontFamilyService({
                    fontFamily: DEFAULT_FONT_FAMILY,
                }),
        },
        {
            field: 'fontSize',
            value: DEFAULT_FONT_SIZE,
            run: () =>
                updateCurrentUserFontSizeService({
                    fontSize: DEFAULT_FONT_SIZE,
                }),
        },
    ] as const) {
        for (const persistedState of ['missing', 'invalid']) {
            it(
                'persists the explicit default ' +
                    defaults.field +
                    ' for a ' +
                    persistedState +
                    ' row',
                async function () {
                    if (persistedState === 'missing') {
                        model.state.rows.delete('user_settings')
                    } else {
                        model.state.rows.set('user_settings', {
                            ...previous,
                            [defaults.field]: 'invalid stored preference',
                        })
                    }

                    const result: unknown = await defaults.run()
                    expect(result).toEqual({
                        success: true,
                        [defaults.field]: defaults.value,
                    })

                    expect(
                        model.state.rows.get('user_settings')?.[defaults.field],
                    ).toBe(defaults.value)
                    expect(model.state.events).toContain('insert:user_settings')
                    expect(model.state.audits).toHaveLength(1)
                },
            )
        }
    }

    it('uses the row committed while waiting for the user lock to decide whether a write is needed', async function () {
        let releaseLock = noop
        let announceLock = noop
        const lockEntered = new Promise<void>((resolve) => {
            announceLock = resolve
        })
        const lockReleased = new Promise<void>((resolve) => {
            releaseLock = resolve
        })
        const select = model.tx.select
        const selectSpy = vi
            .spyOn(model.tx, 'select')
            .mockImplementationOnce(function (fields) {
                const query = select(fields)
                const acquire = query.for
                query.for = async function (mode) {
                    announceLock()
                    await lockReleased
                    return acquire(mode)
                }
                return query
            })

        try {
            const pending = updateCurrentUserThemeModeService({
                themeMode: 'light',
            })
            await lockEntered
            model.state.rows.set('user_settings', {
                ...previous,
                themeMode: 'light',
            })
            releaseLock()

            await expect(pending).resolves.toEqual({
                success: true,
                themeMode: 'light',
            })
            expect(model.state.events).not.toContain('insert:user_settings')
            expect(model.state.audits).toEqual([])
            expect(model.publish).not.toHaveBeenCalled()
        } finally {
            releaseLock()
            selectSpy.mockRestore()
        }
    })
})
