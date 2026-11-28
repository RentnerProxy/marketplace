import { CustomSelect } from '@rentnerkev/select'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { FLAG_IMAGES } from '@/config/language.config.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import useLanguageSwitcherLogic from '../Hooks/useLanguageSwitcherLogic.ts'
import type { LanguageSwitcherProps } from '../Types/language-switcher-props.types.ts'

export default function LanguageSwitcher({
    tone = 'dark',
}: LanguageSwitcherProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useLanguageSwitcherLogic()

    return (
        <CustomSelect<AppLanguage>
            aria-label={t('marketplace.footerLanguage')}
            value={state.language}
            options={state.options}
            onValueChange={(value) => void handler.handleLanguageChange(value)}
            readOnly={state.isChangingLanguage}
            aria-busy={state.isChangingLanguage}
            searchable={false}
            contentWidth="content"
            controlSize="sm"
            portalClassName="[&_.rentnerselect-scrollbar]:max-h-none"
            classNames={{
                root: 'w-14 shrink-0 sm:w-32',
                trigger: `cursor-pointer rounded-[10px] border-2 border-ink bg-white pl-2 pr-7 text-left font-comic text-xs font-bold tracking-normal normal-case text-ink transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-4 motion-reduce:transition-none ${tone === 'light' ? 'shadow-[3px_3px_0_0_var(--color-ink)] focus-visible:outline-ink' : 'shadow-[3px_3px_0_0_var(--color-proxy-500)] focus-visible:outline-white'}`,
                trailing: 'text-ink',
                content:
                    'min-w-44 rounded-lg border-[3px] border-ink bg-white p-1 text-ink shadow-[6px_6px_0_0_var(--color-ink)]',
                viewport: 'p-0',
                option: 'min-h-11 rounded-md py-2 pl-9 pr-3 font-comic text-xs font-bold tracking-normal normal-case text-ink transition-colors hover:bg-proxy-200 focus:bg-proxy-200 data-[state=checked]:bg-proxy-400 data-[state=checked]:text-ink sm:min-h-9 motion-reduce:transition-none',
                optionIndicator: 'h-4 w-4 text-ink',
            }}
            renderValue={(options) =>
                options.map((option) => (
                    <span
                        key={option.value}
                        className="flex min-w-0 items-center gap-2"
                    >
                        <img
                            src={FLAG_IMAGES[option.value]}
                            alt=""
                            width="18"
                            height="14"
                            className="h-3.5 w-[18px] shrink-0 rounded-sm object-cover"
                        />
                        <span className="sr-only sm:not-sr-only sm:truncate">
                            {option.label}
                        </span>
                    </span>
                ))
            }
            renderOption={(option) => (
                <span className="flex min-w-0 items-center gap-3">
                    <img
                        src={FLAG_IMAGES[option.value]}
                        alt=""
                        width="18"
                        height="14"
                        className="h-3.5 w-[18px] shrink-0 rounded-sm object-cover"
                    />
                    <span lang={option.value} className="truncate">
                        {option.label}
                    </span>
                </span>
            )}
        />
    )
}
