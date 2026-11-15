import PasswordResetSection from '@/features/UserSettings/Components/SecuritySection/Components/PasswordResetSection.tsx'
import PasskeySection from '@/features/UserSettings/Components/SecuritySection/Components/PasskeySection.tsx'
import TwoFactorSection from '@/features/UserSettings/Components/SecuritySection/Components/TwoFactorSection.tsx'

export default function SecuritySection() {
    return (
        <div className="flex flex-col gap-6">
            <PasswordResetSection />
            <TwoFactorSection />
            <PasskeySection />
        </div>
    )
}
