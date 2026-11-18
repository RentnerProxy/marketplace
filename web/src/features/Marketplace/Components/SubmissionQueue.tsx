import { Textarea } from '@rentnerkev/inputs'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { useSubmissionQueueLogic } from '../Hooks/useSubmissionQueueLogic.ts'
import type {
    SubmissionDetail,
    SubmissionMode,
} from '../Types/components.types.ts'
import { SubmissionEvidence } from './SubmissionEvidence.tsx'

function CandidateDetails({
    detail,
    language,
}: {
    detail: SubmissionDetail
    language: string
}) {
    const { t } = useTranslationStore()
    const { request } = detail
    return (
        <>
            <div className="space-y-1">
                <h2 className="wrap-anywhere text-xl font-semibold text-white">
                    {request.appId} {request.version}
                </h2>
                <p className="text-sm text-primary">
                    {t('submissions.status.' + detail.status)}
                </p>
            </div>
            <dl className="space-y-3 text-sm [&_dd]:wrap-anywhere [&_dt]:text-secondary-text">
                <div>
                    <dt>{t('submissions.source')}</dt>
                    <dd>
                        <a
                            className="text-primary underline"
                            href={`https://github.com/${detail.repository}/commit/${request.commit}`}
                        >
                            {detail.repository} <code>{request.commit}</code>
                        </a>
                        <code className="mt-1 block">{request.path}</code>
                    </dd>
                </div>
                <div>
                    <dt>{t('submissions.publisherName')}</dt>
                    <dd>{request.publisherName}</dd>
                </div>
                <div>
                    <dt>{t('submissions.name')}</dt>
                    <dd>{request.display.name}</dd>
                    <dd>{request.display.summary}</dd>
                </div>
                <div>
                    <dt>{t('submissions.license')}</dt>
                    <dd>{request.display.license}</dd>
                </div>
                <div>
                    <dt>{t('submissions.configSchema')}</dt>
                    <dd>{request.configSchema ?? t('submissions.none')}</dd>
                </div>
                <div>
                    <dt>{t('submissions.targets')}</dt>
                    <dd>{request.targets.join(' · ')}</dd>
                </div>
            </dl>
            {detail.buildRunId && (
                <a
                    className="text-sm text-primary underline"
                    href={`https://github.com/${CANDIDATE_PIPELINE.repository}/actions/runs/${detail.buildRunId}`}
                >
                    {t('submissions.openRun', { id: detail.buildRunId })}
                </a>
            )}
            {detail.validation && (
                <SubmissionEvidence validation={detail.validation} />
            )}
            {detail.status === 'approved' && (
                <p className="text-sm text-secondary-text">
                    {t('submissions.approvedPending')}
                </p>
            )}
            {detail.revocationPending && (
                <p className="text-sm text-secondary-text">
                    {t('submissions.revocationPending')}
                </p>
            )}
            <section className="space-y-3 border-t border-border-dark pt-4">
                <h3 className="font-semibold text-white">
                    {t('submissions.history')}
                </h3>
                <ol className="space-y-3 text-sm">
                    {detail.history.toReversed().map((event) => (
                        <li key={event.revision} className="space-y-1">
                            <p>
                                {t('submissions.status.' + event.status)} ·{' '}
                                <time
                                    dateTime={event.at}
                                    className="text-secondary-text"
                                >
                                    {new Date(event.at).toLocaleString(
                                        language,
                                    )}
                                </time>
                            </p>
                            {event.actorId && (
                                <p className="wrap-anywhere font-mono text-xs text-secondary-text">
                                    {event.actorId}
                                </p>
                            )}
                            {event.reason && (
                                <p className="wrap-anywhere whitespace-pre-wrap text-secondary-text">
                                    {event.reason}
                                </p>
                            )}
                            {event.failure && (
                                <p className="text-secondary-text">
                                    {t('submissions.failure.' + event.failure)}
                                </p>
                            )}
                        </li>
                    ))}
                </ol>
            </section>
        </>
    )
}

export function SubmissionQueue({
    mode,
    userId,
}: {
    mode: SubmissionMode
    userId: string
}) {
    const { t } = useTranslationStore()
    const { state, setter, handler } = useSubmissionQueueLogic(mode, userId)
    const detail = state.detail.data
    return (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-3 rounded-xl border border-border-dark bg-surface-dark p-5">
                <h2 className="font-semibold text-white">
                    {t('submissions.queue')}
                </h2>
                {state.list.isPending && (
                    <p className="text-sm text-secondary-text">
                        {t('submissions.loading')}
                    </p>
                )}
                {state.list.isError && (
                    <p role="alert">{t('submissions.loadError')}</p>
                )}
                {state.list.data?.submissions.length === 0 && (
                    <p className="text-sm text-secondary-text">
                        {t('submissions.empty')}
                    </p>
                )}
                <ul className="space-y-2">
                    {state.list.data?.submissions.map((row) => (
                        <li key={row.id}>
                            <button
                                type="button"
                                aria-pressed={state.id === row.id}
                                className="flex w-full flex-col gap-1 rounded-lg border border-border-dark bg-background-dark/35 p-3 text-start hover:border-primary aria-pressed:border-primary"
                                onClick={() => handler.select(row.id)}
                            >
                                <span className="wrap-anywhere font-medium text-white">
                                    {row.appId} {row.version}
                                </span>
                                <span className="text-xs text-secondary-text">
                                    {t('submissions.status.' + row.status)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="flex gap-3 text-sm">
                    <button
                        className="text-primary disabled:opacity-45"
                        disabled={state.page === 0}
                        onClick={() => handler.changePage(-1)}
                    >
                        {t('submissions.previous')}
                    </button>
                    <button
                        className="text-primary disabled:opacity-45"
                        disabled={
                            !state.list.data?.hasMore || state.page >= 1000
                        }
                        onClick={() => handler.changePage(1)}
                    >
                        {t('submissions.next')}
                    </button>
                </div>
            </div>
            {state.id && (
                <div className="space-y-4 rounded-xl border border-border-dark bg-surface-dark p-5">
                    {state.detail.isPending && (
                        <p className="text-sm text-secondary-text">
                            {t('submissions.loading')}
                        </p>
                    )}
                    {state.detail.isError && (
                        <p role="alert">{t('submissions.loadError')}</p>
                    )}
                    {detail && !state.detail.isError && (
                        <CandidateDetails
                            detail={detail}
                            language={state.language}
                        />
                    )}
                    {detail &&
                        !state.detail.isError &&
                        (state.canReview ||
                            state.canRevoke ||
                            state.canWithdraw) && (
                            <form
                                className="space-y-3 border-t border-border-dark pt-4"
                                onSubmit={handler.submit}
                            >
                                <Textarea
                                    label={t('submissions.reason')}
                                    value={state.reason}
                                    onValueChange={setter.setReason}
                                    rows={2}
                                    required
                                    maxLength={500}
                                />
                                <div className="flex flex-wrap gap-3">
                                    {state.canReview && (
                                        <>
                                            <button
                                                type="submit"
                                                value="approve"
                                                disabled={state.actionPending}
                                                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                                            >
                                                {t('common.approve')}
                                            </button>
                                            <button
                                                type="submit"
                                                value="reject"
                                                disabled={state.actionPending}
                                                className="rounded-lg border border-border-dark px-4 py-2 text-sm font-medium disabled:opacity-45"
                                            >
                                                {t('common.reject')}
                                            </button>
                                        </>
                                    )}
                                    {state.canRevoke && (
                                        <button
                                            type="submit"
                                            value="revoke"
                                            disabled={state.actionPending}
                                            className="rounded-lg border border-border-dark px-4 py-2 text-sm font-medium disabled:opacity-45"
                                        >
                                            {t('submissions.revoke')}
                                        </button>
                                    )}
                                    {state.canWithdraw && (
                                        <button
                                            type="submit"
                                            value="withdraw"
                                            disabled={state.actionPending}
                                            className="rounded-lg border border-border-dark px-4 py-2 text-sm font-medium disabled:opacity-45"
                                        >
                                            {t('submissions.withdraw')}
                                        </button>
                                    )}
                                </div>
                            </form>
                        )}
                </div>
            )}
        </section>
    )
}
