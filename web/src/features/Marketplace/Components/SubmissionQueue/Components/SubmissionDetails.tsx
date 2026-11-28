import type { TranslationKey } from '@/language/translation.ts'
import { Textarea } from '@rentnerkev/inputs'
import { useId } from 'react'
import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import RowDetailsDialog from '@/shared/Table/RowDetailsDialog.tsx'
import { useSubmissionDetailsLogic } from '../Hooks/useSubmissionDetailsLogic.ts'
import type {
    SubmissionDetail,
    SubmissionDetailsProps,
} from '../../../Types/components.types.ts'
import { SubmissionEvidence } from '../../SubmissionEvidence.tsx'
import SubmissionStatusBadge from './SubmissionStatusBadge.tsx'

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
            <SubmissionStatusBadge status={detail.status} />
            <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border-dark bg-(--marketplace-surface-subtle) p-4 text-sm sm:grid-cols-2 [&_dd]:wrap-anywhere [&_dt]:mb-1 [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-secondary-text">
                <div className="sm:col-span-2">
                    <dt>{t('submissions.source')}</dt>
                    <dd>
                        <a
                            className="text-primary-text underline"
                            href={`https://github.com/${detail.repository}/commit/${request.commit}`}
                        >
                            {detail.repository} <code>{request.commit}</code>
                        </a>
                        <code className="mt-1 block">{request.path}</code>
                    </dd>
                </div>
                <div>
                    <dt>{t('submissions.name')}</dt>
                    <dd>{request.display.name}</dd>
                    <dd className="mt-1 text-secondary-text">
                        {request.display.summary}
                    </dd>
                </div>
                <div>
                    <dt>{t('submissions.publisherName')}</dt>
                    <dd>{request.publisherName}</dd>
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
                    className="text-sm text-primary-text underline"
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
            <section className="space-y-3 border-t border-border-dark pt-5">
                <h3 className="font-extrabold text-(color:--marketplace-ink-soft)">
                    {t('submissions.history')}
                </h3>
                <ol className="space-y-3 text-sm">
                    {detail.history.toReversed().map((event) => (
                        <li
                            key={event.revision}
                            className="space-y-1 border-l border-border-dark pl-3"
                        >
                            <p>
                                {t(`submissions.status.${event.status}`)} ·{' '}
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
                                    {t(`submissions.failure.${event.failure}`)}
                                </p>
                            )}
                        </li>
                    ))}
                </ol>
            </section>
        </>
    )
}

export function SubmissionDetails({
    mode,
    userId,
    submission,
    onClose,
}: SubmissionDetailsProps) {
    const { t } = useTranslationStore()
    const { state, setter, handler } = useSubmissionDetailsLogic(
        mode,
        userId,
        submission.id,
    )
    const formId = useId()
    const detail = state.detail
    const actions: Array<{ value: string; label: TranslationKey }> = [
        ...(state.canReview
            ? [
                  { value: 'approve', label: 'common.approve' as const },
                  { value: 'reject', label: 'common.reject' as const },
              ]
            : []),
        ...(state.canRevoke
            ? [{ value: 'revoke', label: 'submissions.revoke' as const }]
            : []),
        ...(state.canWithdraw
            ? [{ value: 'withdraw', label: 'submissions.withdraw' as const }]
            : []),
    ]
    return (
        <RowDetailsDialog
            title={`${submission.appId} ${submission.version}`}
            onClose={onClose}
            closeDisabled={state.actionPending}
            footer={
                actions.length > 0 &&
                actions.map(({ value, label }) => (
                    <button
                        key={value}
                        type="submit"
                        form={formId}
                        value={value}
                        disabled={state.actionPending}
                        className={`inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-4 py-2 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none ${
                            value === 'approve'
                                ? 'border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:hover:text-primary-hover-foreground'
                                : 'border-rentner-border bg-rentner-control text-(color:--marketplace-ink-soft) enabled:hover:border-focus-ring/40 enabled:hover:text-focus-ring'
                        }`}
                    >
                        {t(label)}
                    </button>
                ))
            }
        >
            <div className="space-y-4">
                {state.isPending && (
                    <p role="status" className="text-sm text-secondary-text">
                        {t('submissions.loading')}
                    </p>
                )}
                {state.isError && (
                    <p role="alert">{t('submissions.loadError')}</p>
                )}
                {detail && (
                    <CandidateDetails
                        detail={detail}
                        language={state.language}
                    />
                )}
                {actions.length > 0 && (
                    <form
                        id={formId}
                        className="border-t border-border-dark pt-4"
                        onSubmit={handler.handleSubmit}
                    >
                        <Textarea
                            label={t('submissions.reason')}
                            value={state.reason}
                            disabled={state.actionPending}
                            onValueChange={setter.setReason}
                            rows={2}
                            required
                            maxLength={500}
                        />
                    </form>
                )}
            </div>
        </RowDetailsDialog>
    )
}
