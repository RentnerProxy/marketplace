import useTranslationStore from '@/language/useTranslationStore.ts'
import type { ReauthenticationInputProps } from '@/features/UserSettings/Types/user-settings-component-props.types.ts'

export default function ReauthenticationInput({
    disabled,
    id,
    isTotp,
    onChange,
    value,
}: ReauthenticationInputProps) {
    const { t } = useTranslationStore()
    const descriptionId = `${id}-description`

    return (
        <div className="space-y-1.5">
            <label
                className="block text-xs font-semibold text-white"
                htmlFor={id}
            >
                {isTotp
                    ? t('userSettings.security.reauthenticationTotpLabel')
                    : t('userSettings.security.reauthenticationPasswordLabel')}
            </label>
            <input
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                type={isTotp ? 'text' : 'password'}
                inputMode={isTotp ? 'numeric' : 'text'}
                autoComplete={isTotp ? 'one-time-code' : 'current-password'}
                maxLength={isTotp ? 6 : 1024}
                disabled={disabled}
                aria-describedby={descriptionId}
                placeholder={
                    isTotp
                        ? t(
                              'userSettings.security.reauthenticationTotpPlaceholder',
                          )
                        : t(
                              'userSettings.security.reauthenticationPasswordPlaceholder',
                          )
                }
                className="h-11 w-full rounded-md border border-border-dark bg-background-dark px-3 text-sm text-white outline-none transition-colors placeholder:text-secondary-text/60 focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p id={descriptionId} className="text-xs text-secondary-text">
                {isTotp
                    ? t('userSettings.security.reauthenticationTotpDescription')
                    : t('userSettings.security.reauthenticationDescription')}
            </p>
        </div>
    )
}
