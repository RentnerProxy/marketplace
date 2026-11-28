import useTranslationStore from '@/language/useTranslationStore.ts'

export default function PublicRegistrationSection({
    enabled,
    disabled,
    onChange,
}: {
    enabled: boolean
    disabled: boolean
    onChange: (isEnabled: boolean) => void
}) {
    const { t } = useTranslationStore()

    return (
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border-dark bg-background-dark p-4 has-disabled:cursor-not-allowed">
            <span>
                <span
                    id="public-registration-label"
                    className="block text-sm font-semibold text-white"
                >
                    {t('admin.systemSettings.publicRegistration')}
                </span>
                <span
                    id="public-registration-description"
                    className="mt-1 block text-sm text-secondary-text"
                >
                    {t('admin.systemSettings.publicRegistrationDescription')}
                </span>
            </span>
            <input
                type="checkbox"
                role="switch"
                aria-labelledby="public-registration-label"
                aria-describedby="public-registration-description"
                checked={enabled}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.checked)}
                className="peer sr-only"
            />
            <span
                aria-hidden="true"
                className="relative h-6 w-11 shrink-0 rounded-full bg-input-dark transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary peer-disabled:opacity-60"
            />
        </label>
    )
}
