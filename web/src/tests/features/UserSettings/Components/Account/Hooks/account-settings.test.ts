import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
    client,
    createSession,
    failure,
    query,
    render,
    reset,
    settle,
    success,
} from '@/tests/features/UserSettings/settings-hooks.test.helpers.ts'
import type { PersonalInfoSectionProps } from '@/features/UserSettings/Types/user-settings-component-props.types.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'

let localVersion: number | null = null
const update = mock(
    async (
        _input: unknown,
    ): Promise<
        | { success: true; personalInfo: PersonalInfoSectionProps }
        | { success: false; error: string }
    > => ({ success: true, personalInfo: initial }),
)
mock.module('@/shared/Images/Hooks/useLocalProfileImageVersion.ts', () => ({
    default: () => localVersion,
}))
mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserPersonalInfoHandler: update,
}))
const { default: useAccountSettingsLogic } =
    await import('@/features/UserSettings/Components/Account/Hooks/useAccountSettingsLogic.ts')
const { default: usePersonalInfoSettingsLogic } =
    await import('@/features/UserSettings/Components/Account/Hooks/usePersonalInfoSettingsLogic.ts')
const initial: PersonalInfoSectionProps = {
    firstName: 'Ada',
    lastName: 'Tester',
    city: 'Berlin',
    street: 'Teststraße',
    houseNumber: '12',
    postalCode: '10115',
}

beforeEach(() => {
    reset()
    localVersion = null
    update
        .mockReset()
        .mockResolvedValue({ success: true, personalInfo: initial })
})

describe('Account settings hooks', () => {
    it('uses safe empty defaults without a session and selects local image version before session version', () => {
        expect(render(useAccountSettingsLogic).state).toEqual({
            profileImageSrc: DEFAULT_IMAGE_SRC,
            userId: '',
            username: '',
            firstName: '',
            lastName: '',
            street: '',
            houseNumber: '',
            postalCode: '',
            city: '',
        })
        const session = createSession()
        query.mockReturnValue({ data: session })
        expect(render(useAccountSettingsLogic).state.profileImageSrc).toContain(
            '?v=4',
        )
        localVersion = 8
        const state = render(useAccountSettingsLogic).state
        expect(state.profileImageSrc).toContain(
            '/images/user/member-1/profile.webp?v=8',
        )
        expect(state.firstName).toBe('Ada')
        expect(state.username).toBe('tester')
    })

    it('saves edited personal information and merges the server response into session cache', async () => {
        client.setQueryData(['session'], createSession())
        let logic = render(() => usePersonalInfoSettingsLogic(initial))
        logic.handler.handleFirstNameChange('Grace')
        logic.handler.handleLastNameChange('Hopper')
        logic.handler.handleStreetChange('New street')
        logic.handler.handleHouseNumberChange('42')
        logic.handler.handlePostalCodeChange('20095')
        logic.handler.handleCityChange('Hamburg')
        logic = render(() => usePersonalInfoSettingsLogic(initial))
        const edited = {
            firstName: 'Grace',
            lastName: 'Hopper',
            street: 'New street',
            houseNumber: '42',
            postalCode: '20095',
            city: 'Hamburg',
        }
        update.mockResolvedValue({ success: true, personalInfo: edited })
        logic.handler.handleSavePersonalInfo()
        expect(
            render(() => usePersonalInfoSettingsLogic(initial)).state
                .isSavingPersonalInfo,
        ).toBe(true)
        await settle()
        expect(update).toHaveBeenCalledWith({ data: edited })
        expect(success).toHaveBeenCalledWith('toast.personalInfoSaved', {
            title: 'userSettings.header.title',
        })
        expect(client.getQueryData(['session'])).toMatchObject({ user: edited })
        expect(failure).not.toHaveBeenCalled()
    })

    it('resynchronizes all draft fields when server personal information changes', () => {
        render(() => usePersonalInfoSettingsLogic(initial))
        const next = {
            ...initial,
            firstName: 'Next',
            lastName: 'User',
            city: 'Bonn',
            street: 'Other street',
            houseNumber: '5',
            postalCode: '53111',
        }
        render(() => usePersonalInfoSettingsLogic(next))
        expect(
            render(() => usePersonalInfoSettingsLogic(next)).state,
        ).toMatchObject({
            firstNameValue: 'Next',
            lastNameValue: 'User',
            cityValue: 'Bonn',
            streetValue: 'Other street',
            houseNumberValue: '5',
            postalCodeValue: '53111',
        })
    })

    it('reports rejected and thrown saves without publishing a success notification', async () => {
        update.mockResolvedValue({
            success: false,
            error: 'Validation rejected',
        })
        render(() =>
            usePersonalInfoSettingsLogic(initial),
        ).handler.handleSavePersonalInfo()
        await settle()
        expect(failure).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Validation rejected' }),
        )
        expect(success).not.toHaveBeenCalled()
        const error = new Error('Network offline')
        update.mockRejectedValue(error)
        render(() =>
            usePersonalInfoSettingsLogic(initial),
        ).handler.handleSavePersonalInfo()
        await settle()
        expect(failure).toHaveBeenCalledWith(error)
        expect(success).not.toHaveBeenCalled()
    })
})
