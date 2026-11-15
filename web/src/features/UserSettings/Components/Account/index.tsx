import ProfileImageSection from '@/features/UserSettings/Components/Account/Components/ProfileImageSection.tsx'
import PersonalInfoSection from '@/features/UserSettings/Components/Account/Components/PersonalInfoSection.tsx'
import useAccountSettingsLogic from '@/features/UserSettings/Components/Account/Hooks/useAccountSettingsLogic.ts'

export default function AccountSection() {
    const { state } = useAccountSettingsLogic()

    return (
        <div className="flex flex-col gap-6">
            <ProfileImageSection
                profileImageSrc={state.profileImageSrc}
                userId={state.userId}
                username={state.username}
            />
            <PersonalInfoSection
                firstName={state.firstName}
                lastName={state.lastName}
                street={state.street}
                houseNumber={state.houseNumber}
                postalCode={state.postalCode}
                city={state.city}
            />
        </div>
    )
}
