import type { SetupAccessNoticeProps } from '../Types/first-super-user-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function SetupAccessNotice({
    isChecking,
}: SetupAccessNoticeProps) {
    const { t } = useTranslationStore()

    return (
        <div className="mt-6 space-y-3 rounded-xl border border-border-dark bg-background-dark/70 p-5">
            <h2 className="font-semibold text-white">
                {t(
                    isChecking
                        ? 'auth.firstSetup.checkingSetupLink'
                        : 'auth.firstSetup.setupLinkRequired',
                )}
            </h2>
            {!isChecking && (
                <p className="text-sm text-secondary-text">
                    {t('auth.firstSetup.setupLinkDescription')}
                </p>
            )}
        </div>
    )
}
