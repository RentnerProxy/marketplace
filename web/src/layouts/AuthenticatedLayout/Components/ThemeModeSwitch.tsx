import { Moon, Sun } from 'lucide-react'
import useThemeModeMutation from '@/features/UserSettings/Hooks/useThemeModeMutation.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { UserThemeMode } from '@/lib/Theme/Types/userTheme.types.ts'

export default function ThemeModeSwitch({
    themeMode,
}: {
    themeMode: UserThemeMode
}) {
    const { t } = useTranslationStore()
    const { state, handler } = useThemeModeMutation()
    const isDark = themeMode === 'dark'

    return (
        <button
            type="button"
            role="switch"
            aria-label={t('userSettings.theme.dark')}
            aria-checked={isDark}
            aria-busy={state.isSavingThemeMode}
            aria-disabled={state.isSavingThemeMode}
            onClick={() => {
                if (!state.isSavingThemeMode) {
                    handler.saveThemeMode(isDark ? 'light' : 'dark')
                }
            }}
            className="group relative isolate grid h-12 w-24 shrink-0 cursor-pointer grid-cols-2 place-items-center rounded-full border border-(--marketplace-border-strong) bg-input-dark p-1 text-secondary-text transition-colors hover:border-primary/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-disabled:cursor-wait aria-disabled:opacity-70 motion-reduce:transition-none"
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-1 start-1 -z-10 w-[calc(50%-0.25rem)] rounded-full bg-primary transition-transform duration-180 group-aria-checked:translate-x-full motion-reduce:transition-none"
            />
            <Sun
                aria-hidden="true"
                className="size-4 stroke-[1.65] group-aria-[checked=false]:text-primary-foreground"
            />
            <Moon
                aria-hidden="true"
                className="size-4 stroke-[1.65] group-aria-checked:text-primary-foreground"
            />
        </button>
    )
}
