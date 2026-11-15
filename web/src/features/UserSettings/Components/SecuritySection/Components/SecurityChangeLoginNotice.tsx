import { Link } from '@tanstack/react-router'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function SecurityChangeLoginNotice() {
    const { t } = useTranslationStore()
    return (
        <div
            role="status"
            className="rounded-md border border-border-dark border-l-2 border-l-primary bg-background-dark p-3 text-sm text-secondary-text"
        >
            <p>{t('userSettings.security.signInAgainAllDevices')}</p>
            <Link
                to="/login"
                className="mt-2 inline-block font-semibold text-primary underline underline-offset-4"
            >
                {t('userSettings.security.signInAgain')}
            </Link>
        </div>
    )
}
