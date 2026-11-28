import { TextInput } from '@rentnerkev/inputs'
import { LoaderCircle, Search, UsersRound } from 'lucide-react'
import ProfileCard from '@/features/Social/Components/ProfileCard.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import usePeopleSearchLogic from './Hooks/usePeopleSearchLogic.ts'

export default function PeoplePage() {
    const { t } = useTranslationStore()
    const { state, handler } = usePeopleSearchLogic()

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <section className="rounded-lg border border-border-dark bg-surface-dark p-5 sm:p-6">
                <div className="flex items-center gap-3">
                    <HeadingIcon icon={UsersRound} />
                    <div>
                        <h2 className="comic-title text-4xl text-foreground">
                            {t('social.title')}
                        </h2>
                        <p className="text-sm text-secondary-text">
                            {t('social.description')}
                        </p>
                    </div>
                </div>
                <div className="mt-5">
                    <TextInput
                        value={state.query}
                        onValueChange={handler.handleQueryChange}
                        placeholder={t('social.searchPlaceholder')}
                        aria-label={t('social.searchPlaceholder')}
                        icon={<Search className="h-4 w-4" />}
                        maxLength={50}
                    />
                </div>
            </section>

            {!state.canSearch ? (
                <p className="comic-lettering text-center text-sm text-secondary-text">
                    {t('social.searchHint')}
                </p>
            ) : state.isSearching ? (
                <div className="flex justify-center py-10 text-secondary-text">
                    <LoaderCircle
                        aria-hidden="true"
                        className="h-6 w-6 animate-spin"
                    />
                </div>
            ) : state.profiles.length === 0 ? (
                <p className="comic-lettering rounded-md border-[3px] border-dashed border-border-dark px-5 py-10 text-center text-sm text-secondary-text">
                    {t('social.empty', { query: state.searchedQuery })}
                </p>
            ) : (
                <ul className="grid gap-4 lg:grid-cols-2">
                    {state.profiles.map((profile) => (
                        <ProfileCard
                            key={profile.id}
                            profile={profile}
                            isSignedIn
                        />
                    ))}
                </ul>
            )}
        </div>
    )
}
