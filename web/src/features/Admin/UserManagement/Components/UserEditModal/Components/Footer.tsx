import { Save } from 'lucide-react'
import type { FooterProps } from '../Types/user-edit-modal-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function Footer({ isUpdatingUser, onClose }: FooterProps) {
    const { t } = useTranslationStore()

    return (
        <div className="mt-6 flex justify-end gap-3 border-t border-border-dark pt-5">
            <button
                type="button"
                onClick={onClose}
                className="h-11 cursor-pointer rounded-md border border-border-dark px-5 font-semibold text-secondary-text transition-colors hover:bg-input-dark hover:text-white"
            >
                {t('common.cancel')}
            </button>
            <button
                type="submit"
                disabled={isUpdatingUser}
                className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
                <Save className="h-4 w-4" />
                {isUpdatingUser ? t('common.saving') : t('common.save')}
            </button>
        </div>
    )
}
