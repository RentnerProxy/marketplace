import { CustomTooltip } from '@rentnerkev/tooltips'
import { LoaderCircle, PencilLine, Save } from 'lucide-react'
import { USER_PROFILE_CONFIG } from '@/config/user-profile.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import useProfileBioLogic from '../Hooks/useProfileBioLogic.ts'
import type { ProfileBioProps } from '../Types/user-profile.types.ts'

/** Bio under the profile name, edited in place via the pencil. */
export default function ProfileBio({ bio }: ProfileBioProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProfileBioLogic({ bio })

    if (state.isEditingBio) {
        return (
            <div className="mt-4 max-w-2xl">
                <label className="block">
                    <span className="sr-only">{t('profile.bio.title')}</span>
                    <textarea
                        value={state.bioValue}
                        maxLength={USER_PROFILE_CONFIG.bioMaxLength}
                        rows={3}
                        placeholder={t('profile.bio.placeholder')}
                        onChange={(event) =>
                            handler.handleBioChange(event.target.value)
                        }
                        className="w-full resize-y rounded-md border-2 border-border-dark bg-background-dark px-3 py-2 text-base leading-7 text-foreground placeholder:text-secondary-text focus-visible:border-primary focus-visible:outline-none"
                    />
                </label>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="font-comic text-xs font-bold tabular-nums text-secondary-text">
                        {state.bioValue.length}/
                        {USER_PROFILE_CONFIG.bioMaxLength}
                    </span>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={handler.handleCancelEditingBio}
                            className="flex h-10 cursor-pointer items-center justify-center rounded-md border-2 border-border-dark bg-background-dark px-4 font-comic text-sm font-bold text-secondary-text transition-colors hover:border-primary hover:text-foreground"
                        >
                            {t('profile.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={handler.handleSaveBio}
                            disabled={!state.hasBioChanged || state.isSavingBio}
                            className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {state.isSavingBio ? (
                                <LoaderCircle
                                    aria-hidden="true"
                                    className="h-4 w-4 animate-spin"
                                />
                            ) : (
                                <Save aria-hidden="true" className="h-4 w-4" />
                            )}
                            {t('profile.bio.save')}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <p
            className={`mt-4 max-w-2xl whitespace-pre-line break-words text-base leading-7 ${bio ? 'text-foreground' : 'italic text-secondary-text'}`}
        >
            {bio || t('profile.bio.empty')}
            <CustomTooltip side="top" content={t('profile.bio.edit')}>
                <button
                    type="button"
                    onClick={handler.handleStartEditingBio}
                    aria-label={t('profile.bio.edit')}
                    className="ml-2 inline-grid h-8 w-8 cursor-pointer place-items-center rounded-md border-2 border-ink bg-primary align-middle not-italic text-primary-foreground shadow-[2px_2px_0_0_var(--app-comic-pop,var(--color-ink))] transition-transform hover:-translate-x-px hover:-translate-y-px"
                >
                    <PencilLine aria-hidden="true" className="h-4 w-4" />
                </button>
            </CustomTooltip>
        </p>
    )
}
