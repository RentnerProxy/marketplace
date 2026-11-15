import { CustomSelect } from '@rentnerkev/select'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { FLAG_IMAGES } from '@/config/language.config.ts'
import type { AppLanguage } from '@/shared/Types/config.types.ts'
import useLanguageSwitcherLogic from '../Hooks/useLanguageSwitcherLogic.ts'

export default function LanguageSwitcher() {
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
            controlSize="md"
            portalClassName="[&_.rentnerselect-scrollbar]:max-h-none"
            classNames={{
                root: 'w-[76px] shrink-0 sm:w-44',
                trigger:
                    'cursor-pointer rounded-xl border border-white/20 bg-white/5 pl-3 pr-10 text-left text-sm font-semibold tracking-normal normal-case text-white transition-colors hover:border-primary/60 hover:bg-white/10 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 data-[state=open]:border-primary/60 motion-reduce:transition-none',
                trailing: 'text-white/60',
                content:
                    'min-w-52 rounded-2xl border border-white/15 bg-[#07120e] p-1.5 text-white shadow-[0_18px_60px_rgba(0,0,0,0.5)]',
                viewport: 'p-0',
                option:
                    'min-h-11 rounded-xl py-2.5 pl-9 pr-3 text-sm font-medium tracking-normal normal-case text-white/85 transition-colors hover:bg-white/10 focus:bg-white/10 data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary motion-reduce:transition-none',
                optionIndicator: 'h-4 w-4 text-primary',
            }}
            renderValue={(options) =>
                options.map((option) => (
                    <span
                        key={option.value}
                        className="flex min-w-0 items-center gap-2.5"
                    >
                        <img
                            src={FLAG_IMAGES[option.value]}
                            alt=""
                            width="22"
                            height="16"
                            className="h-4 w-[22px] shrink-0 rounded-sm object-cover"
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
                        width="22"
                        height="16"
                        className="h-4 w-[22px] shrink-0 rounded-sm object-cover"
                    />
                    <span lang={option.value} className="truncate">{option.label}</span>
                </span>
            )}
        />
    )
}
