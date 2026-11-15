import useTranslationStore from '@/language/useTranslationStore.ts'
import type { SetupSubmitButtonProps } from '../Types/first-super-user-component-props.types.ts'

export default function SetupSubmitButton({
    isCreating,
}: SetupSubmitButtonProps) {
    const { t } = useTranslationStore()

    return (
        <button
            type="submit"
            disabled={isCreating}
            className="flex h-12 w-full cursor-pointer items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
            {isCreating
                ? t('auth.firstSetup.creating')
                : t('auth.firstSetup.create')}
        </button>
    )
}
