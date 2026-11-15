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
            disabled={state.isChangingLanguage}
            searchable={false}
            contentWidth="content"
            className="w-[72px] sm:w-40"
            classNames={{
                trigger: '!h-10 !rounded-xl !border-white/20 !bg-white/5 !px-3 !text-white hover:!border-primary focus-visible:!ring-primary',
                content: '!min-w-44 !rounded-xl !border-white/15 !bg-marketplace-void !text-white',
                option: 'hover:!bg-white/10 focus:!bg-white/10 data-[state=checked]:!bg-primary/15',
            }}
            renderValue={(options) => options.map((option) => (
                <span key={option.value} className="flex items-center gap-2">
                    <img src={FLAG_IMAGES[option.value]} alt="" width="22" height="16" className="h-4 w-[22px] rounded-sm object-cover" />
                    <span className="sr-only sm:not-sr-only">{option.label}</span>
                </span>
            ))}
            renderOption={(option) => (
                <span className="flex items-center gap-3 py-1">
                    <img src={FLAG_IMAGES[option.value]} alt="" width="22" height="16" className="h-4 w-[22px] rounded-sm object-cover" />
                    <span lang={option.value}>{option.label}</span>
                </span>
            )}
        />
    )
}
