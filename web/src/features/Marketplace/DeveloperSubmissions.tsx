import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { SubmissionQueue } from './Components/SubmissionQueue.tsx'
import { useDeveloperSubmissionsLogic } from './Hooks/useDeveloperSubmissionsLogic.ts'

export default function DeveloperSubmissions({ userId }: { userId: string }) {
    const { t } = useTranslationStore()
    const { state, setter, handler } = useDeveloperSubmissionsLogic(userId)
    return (
        <div className="space-y-5">
            <section className="space-y-5 rounded-xl border border-border-dark bg-surface-dark p-5">
                <form
                    onSubmit={handler.submitClaim}
                    className="flex flex-wrap items-end gap-3"
                >
                    <div className="min-w-48 flex-1">
                        <TextInput
                            label={t('submissions.repository')}
                            placeholder="owner/repository"
                            value={state.repository}
                            onValueChange={setter.setRepository}
                            maxLength={140}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="rounded-lg border border-border-dark px-4 py-2 text-sm font-medium disabled:opacity-45"
                        disabled={state.claimPending}
                    >
                        {t('submissions.requestProof')}
                    </button>
                </form>
                {state.claims.isError && (
                    <p role="alert">{t('submissions.loadError')}</p>
                )}
                {state.claims.data && (
                    <>
                        {!state.claims.data.buildsEnabled && (
                            <p className="text-sm text-secondary-text">
                                {t('submissions.feedback.buildsUnavailable')}
                            </p>
                        )}
                        {state.claims.data.claims.length > 0 && (
                            <CustomSelect
                                label={t('submissions.selectRepository')}
                                value={state.claimId}
                                onValueChange={setter.setClaimId}
                                options={state.claims.data.claims.map(
                                    (claim) => ({
                                        value: claim.id,
                                        label: claim.repository,
                                    }),
                                )}
                            />
                        )}
                    </>
                )}
                {state.selected && (
                    <>
                        <div className="space-y-1 rounded-lg border border-border-dark bg-background-dark/35 p-4 text-sm">
                            <p>
                                {t('submissions.proofInstruction', {
                                    path: state.selected.path,
                                })}
                            </p>
                            <code className="block wrap-anywhere text-primary">
                                {state.selected.challenge}
                            </code>
                            <p className="text-secondary-text">
                                {t('submissions.namespaceValue', {
                                    namespace: state.selected.namespace,
                                })}
                            </p>
                            {state.selected.official && (
                                <p className="text-secondary-text">
                                    {t('submissions.officialInstruction', {
                                        id: state.selected.id,
                                    })}
                                </p>
                            )}
                        </div>
                        <form
                            onSubmit={handler.submitCandidate}
                            className="space-y-4"
                        >
                            <h2 className="font-semibold text-white">
                                {t('submissions.newVersion')}
                            </h2>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {state.fields.map(
                                    ({ name, value, required, maxLength }) => (
                                        <TextInput
                                            key={name}
                                            label={t('submissions.' + name)}
                                            value={value}
                                            required={required}
                                            maxLength={maxLength}
                                            onValueChange={(next) =>
                                                setter.setField(name, next)
                                            }
                                        />
                                    ),
                                )}
                            </div>
                            <p className="text-sm text-secondary-text">
                                {t('submissions.targets')} ·{' '}
                                {CANDIDATE_PIPELINE.targets.join(' · ')}
                            </p>
                            <button
                                type="submit"
                                disabled={
                                    state.submitPending ||
                                    !state.claims.data?.buildsEnabled
                                }
                                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                            >
                                {t('submissions.submit')}
                            </button>
                        </form>
                    </>
                )}
            </section>
            <SubmissionQueue mode="developer" userId={userId} />
        </div>
    )
}
