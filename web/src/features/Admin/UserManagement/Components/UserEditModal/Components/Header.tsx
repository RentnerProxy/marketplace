import { X } from 'lucide-react'
import type { HeaderProps } from '../Types/user-edit-modal-component-props.types.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'

export default function Header({ onClose }: HeaderProps) {
    const { t } = useTranslationStore()

    return (
        <div className="flex items-center justify-between border-b border-border-dark px-5 py-4">
            <div>
                <h2 className="text-lg font-bold text-white">
                    {t('admin.users.editTitle')}
                </h2>
                <p className="text-sm text-secondary-text">
                    {t('admin.users.editDescription')}
                </p>
            </div>
            <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-secondary-text transition-colors hover:bg-input-dark hover:text-white"
                aria-label={t('admin.users.closeModalAriaLabel')}
            >
                <X className="h-5 w-5" />
            </button>
        </div>
    )
}
