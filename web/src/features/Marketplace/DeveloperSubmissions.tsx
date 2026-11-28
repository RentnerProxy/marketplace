import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import { FileCheck2, Send } from 'lucide-react'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import EditableStoreApps from '@/features/AppStore/Components/EditableStoreApps.tsx'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { SubmissionQueue } from './Components/SubmissionQueue/index.tsx'
import SubmissionStep from './Components/SubmissionStep.tsx'
import { useDeveloperSubmissionsLogic } from './Hooks/useDeveloperSubmissionsLogic.ts'

/** Submit apps: prove the repository, submit a version, shape the store listing. */
export default function DeveloperSubmissions({ userId }: { userId: string }) {
    const { t } = useTranslationStore()
    const { state, setter, handler } = useDeveloperSubmissionsLogic(userId)
    const editingDisabled = state.claimPending || state.submitPending
    const hasClaims = (state.claims.data?.claims.length ?? 0) > 0

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <SubmissionStep
                step={1}
                title={t('submissions.steps.proofTitle')}
                description={t('submissions.steps.proofDescription')}
                isDone={hasClaims}
            >
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
                            disabled={editingDisabled}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="comic-btn comic-btn-sm comic-btn-white h-11"
                        disabled={editingDisabled}
                    >
                        <FileCheck2 aria-hidden="true" className="h-4 w-4" />
                        {t('submissions.requestProof')}
                    </button>
                </form>
                {state.claims.isError && (
                    <p role="alert" className="mt-3 text-sm text-danger">
                        {t('submissions.loadError')}
                    </p>
                )}
                {state.claims.data && !state.claims.data.buildsEnabled && (
                    <p className="comic-notice mt-4 bg-background-dark p-3 text-sm text-secondary-text [--notice-tone:var(--color-warning)]">
                        {t('submissions.feedback.buildsUnavailable')}
                    </p>
                )}
                {hasClaims && state.claims.data && (
                    <div className="mt-4 max-w-md">
                        <CustomSelect
                            label={t('submissions.selectRepository')}
                            value={state.claimId}
                            disabled={editingDisabled}
                            onValueChange={setter.setClaimId}
                            options={state.claims.data.claims.map((claim) => ({
                                value: claim.id,
                                label: claim.repository,
                            }))}
                        />
                    </div>
                )}
                {state.selected && (
                    <div className="comic-notice mt-4 space-y-1 bg-background-dark p-4 text-sm">
                        <p>
                            {t('submissions.proofInstruction', {
                                path: state.selected.path,
                            })}
                        </p>
                        <code className="block wrap-anywhere font-mono text-primary-text">
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
                )}
            </SubmissionStep>

            <SubmissionStep
                step={2}
                title={t('submissions.steps.versionTitle')}
                description={t('submissions.steps.versionDescription')}
            >
                {state.selected ? (
                    <form
                        onSubmit={handler.submitCandidate}
                        className="space-y-4"
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            {state.fields.map(
                                ({ name, value, required, maxLength }) => (
                                    <TextInput
                                        key={name}
                                        label={t(`submissions.${name}`)}
                                        value={value}
                                        disabled={editingDisabled}
                                        required={required}
                                        maxLength={maxLength}
                                        onValueChange={(next) =>
                                            setter.setField(name, next)
                                        }
                                    />
                                ),
                            )}
                        </div>
                        <p className="comic-lettering text-xs text-secondary-text">
                            {t('submissions.targets')} ·{' '}
                            {CANDIDATE_PIPELINE.targets.join(' · ')}
                        </p>
                        <button
                            type="submit"
                            disabled={
                                editingDisabled ||
                                !state.claims.data?.buildsEnabled
                            }
                            className="comic-btn"
                        >
                            <Send aria-hidden="true" className="h-4 w-4" />
                            {t('submissions.submit')}
                        </button>
                    </form>
                ) : (
                    <p className="text-sm text-secondary-text">
                        {t('submissions.steps.versionLocked')}
                    </p>
                )}
            </SubmissionStep>

            <SubmissionStep
                step={3}
                title={t('submissions.steps.storeTitle')}
                description={t('submissions.steps.storeDescription')}
            >
                <EditableStoreApps />
            </SubmissionStep>

            <SubmissionQueue mode="developer" userId={userId} />
        </div>
    )
}
