import { Save } from 'lucide-react'
import type { FooterProps } from '../Types/user-edit-modal-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function Footer({ isUpdatingUser, onClose }: FooterProps) {
    const { t } = useTranslationStore()

    return (
        <div className="marketplace-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-dark px-5 py-4 sm:px-6 [&_button]:max-sm:flex-1">
            <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-rentner-border bg-rentner-control px-4 py-2 text-sm font-extrabold text-(color:--marketplace-ink-soft) transition-colors hover:border-focus-ring/40 hover:text-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none"
            >
                {t('common.cancel')}
            </button>
            <button
                type="submit"
                disabled={isUpdatingUser}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground transition-colors enabled:hover:bg-primary-hover enabled:hover:text-primary-hover-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
            >
                <Save aria-hidden="true" className="size-4 shrink-0" />
                {isUpdatingUser ? t('common.saving') : t('common.save')}
            </button>
        </div>
    )
}
