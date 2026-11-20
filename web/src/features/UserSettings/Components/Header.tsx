import { X } from 'lucide-react'
import type { UserSettingsHeaderProps } from '../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function Header({ username, onClose }: UserSettingsHeaderProps) {
    const { t } = useTranslationStore()

    return (
        <div className="marketplace-dialog-header flex shrink-0 items-center justify-between gap-5 border-b border-border-dark px-5 py-4 sm:px-6">
            <div className="min-w-0">
                <h2 className="wrap-anywhere text-lg leading-tight font-extrabold text-(color:--marketplace-ink-soft) sm:text-xl">
                    {t('userSettings.header.title')}
                </h2>
                <p className="mt-1.5 max-w-prose wrap-anywhere text-sm leading-relaxed text-secondary-text">
                    {t('userSettings.header.subtitle', { username })}
                </p>
            </div>
            <button
                type="button"
                onClick={onClose}
                className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-secondary-text transition-colors hover:border-border-dark hover:bg-input-dark hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none"
                aria-label={t('userSettings.close')}
            >
                <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
            </button>
        </div>
    )
}
