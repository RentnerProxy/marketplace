import LanguageSection from '@/features/UserSettings/Components/AppearanceSection/Components/LanguageSection.tsx'
import MainTheme from '@/features/UserSettings/Components/AppearanceSection/Components/MainTheme.tsx'
import FontsSection from '@/features/UserSettings/Components/AppearanceSection/Components/FontsSection.tsx'
import FontSizeSection from '@/features/UserSettings/Components/AppearanceSection/Components/FontSizeSection.tsx'
import SystemColorSection from '@/features/UserSettings/Components/AppearanceSection/Components/SystemColorSection.tsx'
import CustomBackgroundSection from '@/features/UserSettings/Components/AppearanceSection/Components/CustomBackgroundSection.tsx'

export default function AppearanceSection() {
    return (
        <>
            <LanguageSection />

            <MainTheme />

            <FontsSection />

            <FontSizeSection />

            <SystemColorSection />

            <CustomBackgroundSection />
        </>
    )
}
