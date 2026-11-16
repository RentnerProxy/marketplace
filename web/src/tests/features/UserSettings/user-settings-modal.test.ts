import { describe, expect, it, mock } from 'bun:test'
import * as ReactDOM from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import UserSettingsModal from '@/features/UserSettings/index.tsx'
import Header from '@/features/UserSettings/Components/Header.tsx'
import NavTabs from '@/features/UserSettings/Components/NavTabs.tsx'
import SettingsSaveButton from '@/features/UserSettings/Components/SettingsSaveButton.tsx'
import AccountSection from '@/features/UserSettings/Components/Account/index.tsx'
import AppearanceSection from '@/features/UserSettings/Components/AppearanceSection/index.tsx'
import SecuritySection from '@/features/UserSettings/Components/SecuritySection/index.tsx'
import type { UserSettingsModalLogicReturn } from '@/features/UserSettings/Types/user-settings-logic.types.ts'
import {
    elements,
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'

const dom = { ...ReactDOM }
const portal = mock((node: ReactNode, _container: unknown) => node)
const logic: UserSettingsModalLogicReturn = {
    state: { activeTab: 'account', mounted: true, isOpen: true },
    handler: { closeUserSettings: mock() },
    setter: { setActiveTab: mock() },
}
const account = {
    state: {
        profileImageSrc: '/avatar.png',
        userId: 'user-1',
        username: 'Kevin',
        firstName: 'Kevin',
        lastName: 'Test',
        street: 'Teststraße',
        houseNumber: '12',
        postalCode: '10115',
        city: 'Berlin',
    },
}
mock.module('react-dom', () => ({ ...dom, createPortal: portal }))
mock.module(
    '@/features/UserSettings/Hooks/useUserSettingsModalLogic.ts',
    () => ({ default: () => logic }),
)
mock.module(
    '@/features/UserSettings/Components/Account/Hooks/useAccountSettingsLogic.ts',
    () => ({ default: () => account }),
)
mock.module('@/language/useTranslationStore.ts', () => ({
    default: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            key + (values ? JSON.stringify(values) : ''),
    }),
}))

describe('User settings modal composition', () => {
    it('requires an open, mounted modal before creating a portal', () => {
        for (const [isOpen, mounted] of [
            [false, true],
            [true, false],
        ]) {
            Object.assign(logic.state, { isOpen, mounted })
            expect(UserSettingsModal({ username: 'Kevin' })).toBeNull()
        }
    })

    it.each(['account', 'appearance', 'security'] as const)(
        'renders only the selected %s section and wires header and tabs',
        (activeTab) => {
            Object.assign(logic.state, {
                activeTab,
                isOpen: true,
                mounted: true,
            })
            const body = { id: 'portal-container' }
            stubTestGlobal('document', { body })
            try {
                const tree = UserSettingsModal({ username: 'Kevin' })
                expect(portal).toHaveBeenLastCalledWith(tree, body)
                const sections = elements(tree).filter((element) =>
                    [
                        AccountSection,
                        AppearanceSection,
                        SecuritySection,
                    ].includes(element.type as typeof AccountSection),
                )
                expect(sections).toHaveLength(1)
                expect(sections[0]!.type).toBe(
                    {
                        account: AccountSection,
                        appearance: AppearanceSection,
                        security: SecuritySection,
                    }[activeTab],
                )
                invoke(
                    findElement(tree, (element) => element.type === Header),
                    'onClose',
                )
                invoke(
                    findElement(tree, (element) => element.type === NavTabs),
                    'onTabChange',
                    'security',
                )
                expect(logic.handler.closeUserSettings).toHaveBeenCalled()
                expect(logic.setter.setActiveTab).toHaveBeenCalledWith(
                    'security',
                )
            } finally {
                restoreTestGlobals()
            }
        },
    )

    it('renders an accessible close button, username and translated navigation labels', () => {
        const close = mock()
        const header = Header({ username: 'Kevin', onClose: close })
        const html = renderToStaticMarkup(header)
        expect(html).toContain('Kevin')
        expect(html).toContain('aria-label="userSettings.close"')
        invoke(
            findElement(header, (element) => element.type === 'button'),
            'onClick',
        )
        expect(close).toHaveBeenCalledTimes(1)
        const change = mock()
        const nav = NavTabs({ activeTab: 'account', onTabChange: change })
        const rendered = renderToStaticMarkup(nav)
        for (const label of [
            'userSettings.account',
            'userSettings.appearance',
            'userSettings.security.label',
        ])
            expect(rendered).toContain(label)
        invoke(
            findElement(nav, (element) => element.props.onTabChange === change),
            'onTabChange',
            'appearance',
        )
        expect(change).toHaveBeenCalledWith('appearance')
    })

    it('passes account identity and personal information to their dedicated sections', () => {
        const children = elements(AccountSection()).filter(
            (element) => typeof element.type === 'function',
        )
        expect(children).toHaveLength(2)
        expect(children[0]!.props).toMatchObject({
            userId: 'user-1',
            username: 'Kevin',
            profileImageSrc: '/avatar.png',
        })
        expect(children[1]!.props).toMatchObject({
            city: 'Berlin',
            street: 'Teststraße',
            firstName: 'Kevin',
        })
        expect(
            elements(AppearanceSection()).flatMap((element) =>
                typeof element.type === 'function' ? [element.type.name] : [],
            ),
        ).toEqual([
            'LanguageSection',
            'MainTheme',
            'FontsSection',
            'FontSizeSection',
            'SystemColorSection',
        ])
        expect(
            elements(SecuritySection()).flatMap((element) =>
                typeof element.type === 'function' ? [element.type.name] : [],
            ),
        ).toEqual([
            'PasswordResetSection',
            'TwoFactorSection',
            'PasskeySection',
            'SocialAccountsSection',
        ])
    })

    it.each(['primary', 'secondary'] as const)(
        'preserves %s save semantics and swaps icon while saving',
        (variant) => {
            const onClick = mock()
            const tree = SettingsSaveButton({
                children: 'Save changes',
                disabled: false,
                isSaving: false,
                onClick,
                variant,
            })
            expect(renderToStaticMarkup(tree)).toContain('Save changes')
            invoke(tree, 'onClick')
            expect(onClick).toHaveBeenCalledTimes(1)
            const pending = SettingsSaveButton({
                children: 'Saving',
                disabled: true,
                isSaving: true,
                onClick,
                variant,
            })
            expect(pending.props.disabled).toBe(true)
            expect(renderToStaticMarkup(pending)).toContain('animate-spin')
        },
    )
})
