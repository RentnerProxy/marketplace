import { Settings2, X } from 'lucide-react'
import type { UserSettingsHeaderProps } from '../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function Header({ username, onClose }: UserSettingsHeaderProps) {
    const { t } = useTranslationStore()

    return (
        <div className="flex items-center justify-between border-b border-border-dark px-6 py-4">
            <div className="flex items-start gap-3">
                <HeadingIcon icon={Settings2} />
                <div>
                    <h2 className="text-lg font-bold text-white">
                        {t('userSettings.header.title')}
                    </h2>
                    <p className="text-sm text-secondary-text">
                        {t('userSettings.header.subtitle', { username })}
                    </p>
                </div>
            </div>
            <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-dark bg-input-dark text-secondary-text transition-colors hover:text-white"
                aria-label={t('userSettings.close')}
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    )
}
