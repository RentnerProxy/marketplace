import { TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { useOfficialAppsLogic } from './Hooks/useOfficialAppsLogic.ts'

export default function OfficialApps({ userId }: { userId: string }) {
    const { t } = useTranslationStore()
    const { state, setter, handler } = useOfficialAppsLogic(userId)

    return (
        <div className="space-y-5 rounded-xl border border-border-dark bg-surface-dark p-5">
            <form onSubmit={handler.submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput
                        label={t('submissions.appId')}
                        value={state.appId}
                        onValueChange={setter.setAppId}
                        maxLength={97}
                        required
                    />
                    <TextInput
                        label={t('submissions.claimId')}
                        value={state.claimId}
                        onValueChange={setter.setClaimId}
                        maxLength={36}
                    />
                </div>
                <div className="flex flex-wrap gap-3">
                    <button
                        type="submit"
                        value="assign"
                        disabled={state.pending || !state.claimId.trim()}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                    >
                        {t('submissions.assign')}
                    </button>
                    <button
                        type="submit"
                        value="remove"
                        disabled={state.pending || !state.revision}
                        className="rounded-lg border border-border-dark px-4 py-2 text-sm font-medium disabled:opacity-45"
                    >
                        {t('submissions.removeAssignment')}
                    </button>
                </div>
            </form>
            {state.apps.isPending && (
                <p className="text-sm text-secondary-text">
                    {t('submissions.loading')}
                </p>
            )}
            {state.apps.isError && (
                <p role="alert">{t('submissions.loadError')}</p>
            )}
            <ul className="space-y-2">
                {state.apps.data?.map((entry) => (
                    <li key={entry.appId}>
                        <button
                            className="flex w-full flex-wrap gap-x-5 gap-y-1 rounded-lg border border-border-dark bg-background-dark/35 p-3 text-start text-sm hover:border-primary"
                            onClick={() => handler.select(entry)}
                        >
                            <span className="wrap-anywhere font-semibold text-white">
                                {entry.appId}
                            </span>
                            <span className="wrap-anywhere text-secondary-text">
                                {entry.claimId ?? t('submissions.noAssignment')}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    )
}
