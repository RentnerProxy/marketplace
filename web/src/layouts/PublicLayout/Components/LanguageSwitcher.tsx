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
                trigger:
                    tone === 'light'
                        ? 'cursor-pointer rounded-xl border border-[#d7e2d9] bg-white pl-2 pr-7 text-left text-xs font-medium tracking-normal normal-case text-[#264732] transition-colors hover:border-[#7da78a] hover:bg-[#edf4ed] focus-visible:border-[#0d6d2b] focus-visible:ring-2 focus-visible:ring-[#0d6d2b]/25 data-[state=open]:border-[#0d6d2b] motion-reduce:transition-none'
                        : 'cursor-pointer rounded-xl border border-white/20 bg-white/5 pl-2 pr-7 text-left text-xs font-medium tracking-normal normal-case text-white transition-colors hover:border-primary/60 hover:bg-white/10 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 data-[state=open]:border-primary/60 motion-reduce:transition-none',
                trailing: tone === 'light' ? 'text-[#53675a]' : 'text-white/60',
                content:
                    'min-w-44 rounded-xl border border-white/15 bg-[#07120e] p-1 text-white shadow-[0_18px_60px_rgba(0,0,0,0.5)]',
                viewport: 'p-0',
                option: 'min-h-11 rounded-lg py-2 pl-9 pr-3 text-xs sm:min-h-9 font-medium tracking-normal normal-case text-white/85 transition-colors hover:bg-white/10 focus:bg-white/10 data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary motion-reduce:transition-none',
                optionIndicator: 'h-4 w-4 text-primary',
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
