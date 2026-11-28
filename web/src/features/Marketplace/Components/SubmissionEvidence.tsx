import { CANDIDATE_PIPELINE } from '@/config/submissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import { isTranslationKey } from '@/language/translation.ts'
import type { ValidatedSubmission } from '@/lib/Marketplace/Types/submission.types.ts'

export function SubmissionEvidence({
    validation,
}: {
    validation: ValidatedSubmission
}) {
    const { t, language } = useTranslationStore()
    const { candidate, bundle, evidence, report } = validation

    return (
        <section className="space-y-4 border-t border-border-dark pt-5">
            <h3 className="font-extrabold text-(color:--marketplace-ink-soft)">
                {t('submissions.evidence')}
            </h3>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 [&_dd]:wrap-anywhere [&_dt]:mb-1 [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-secondary-text">
                <div>
                    <dt>{t('submissions.candidateId')}</dt>
                    <dd className="font-mono">{candidate.id}</dd>
                </div>
                <div>
                    <dt>{t('submissions.workflowCommit')}</dt>
                    <dd className="font-mono">
                        {candidate.build.workflowCommit}
                    </dd>
                </div>
                <div>
                    <dt>
                        {t('submissions.reportDigest', {
                            revision: candidate.evidence.revision,
                        })}
                    </dt>
                    <dd className="font-mono">
                        {candidate.evidence.report.sha256}
                    </dd>
                </div>
                <div>
                    <dt>{t('submissions.retainedUntil')}</dt>
                    <dd>
                        {new Date(
                            Math.min(
                                Date.parse(bundle.expiresAt),
                                Date.parse(evidence.expiresAt),
                            ),
                        ).toLocaleString(language)}
                    </dd>
                </div>
            </dl>
            <a
                href={`https://github.com/${CANDIDATE_PIPELINE.repository}/actions/runs/${candidate.build.runId}/artifacts/${bundle.id}`}
                className="text-sm font-medium text-primary-text underline"
            >
                {t('submissions.openArtifact')}
            </a>
            {report.targets.map(({ package: pkg, checks, applianceImage }) => (
                <details
                    key={pkg.manifest.target}
                    className="rounded-xl border border-border-dark bg-(--marketplace-surface-subtle) p-4"
                >
                    <summary className="cursor-pointer rounded-sm font-bold text-(color:--marketplace-ink-soft) focus-visible:outline-offset-4">
                        {pkg.manifest.target}
                    </summary>
                    <dl className="mt-3 space-y-2 text-sm [&_dd]:wrap-anywhere [&_dt]:text-secondary-text">
                        <div>
                            <dt>{t('submissions.packageDigest')}</dt>
                            <dd className="font-mono">{pkg.archive.sha256}</dd>
                        </div>
                        <div>
                            <dt>{t('submissions.packageSize')}</dt>
                            <dd>
                                {pkg.archive.sizeBytes.toLocaleString(language)}
                            </dd>
                        </div>
                        <div>
                            <dt>{t('submissions.manifestDigest')}</dt>
                            <dd className="font-mono">{pkg.manifestSha256}</dd>
                        </div>
                        <div>
                            <dt>{t('submissions.sbomDigest')}</dt>
                            <dd className="font-mono">{pkg.sbom.sha256}</dd>
                        </div>
                        <div>
                            <dt>{t('submissions.provenanceDigest')}</dt>
                            <dd className="font-mono">
                                {pkg.provenance.sha256}
                            </dd>
                        </div>
                        <div>
                            <dt>{t('submissions.checks')}</dt>
                            <dd>
                                {Object.keys(checks)
                                    .map((check) => {
                                        const key = `submissions.check.${check}`
                                        return isTranslationKey(key)
                                            ? t(key)
                                            : key
                                    })
                                    .join(' · ')}
                            </dd>
                        </div>
                        <div>
                            <dt>{t('submissions.applianceImage')}</dt>
                            <dd className="font-mono">{applianceImage}</dd>
                        </div>
                        <div>
                            <dt>{t('submissions.compatibility')}</dt>
                            <dd>
                                <ul className="mt-1 space-y-1">
                                    <li>
                                        {pkg.manifest.requires.runtimeProfile}
                                    </li>
                                    <li>
                                        {t('submissions.platformApi', {
                                            range: pkg.manifest.requires
                                                .platformApi,
                                        })}
                                    </li>
                                    <li>
                                        {t('submissions.appProtocol', {
                                            range: pkg.manifest.requires
                                                .appProtocol,
                                        })}
                                    </li>
                                    {pkg.manifest.requires.uiBridge && (
                                        <li>
                                            {t('submissions.uiBridge', {
                                                range: pkg.manifest.requires
                                                    .uiBridge,
                                            })}
                                        </li>
                                    )}
                                    {pkg.manifest.requires.engineCapabilities.map(
                                        (capability) => (
                                            <li key={capability}>
                                                {capability}
                                            </li>
                                        ),
                                    )}
                                    {pkg.manifest.data && (
                                        <li>
                                            {t('submissions.dataVersions', {
                                                target: pkg.manifest.data
                                                    .targetVersion,
                                                read: pkg.manifest.data.readVersions.join(
                                                    ', ',
                                                ),
                                                write: pkg.manifest.data.writeVersions.join(
                                                    ', ',
                                                ),
                                            })}
                                        </li>
                                    )}
                                </ul>
                            </dd>
                        </div>
                        <div>
                            <dt>{t('submissions.permissions')}</dt>
                            <dd>
                                {pkg.manifest.permissions.join(', ') ||
                                    t('submissions.none')}
                            </dd>
                        </div>
                        <div>
                            <dt>{t('submissions.capabilities')}</dt>
                            <dd>
                                {pkg.manifest.capabilities.length
                                    ? pkg.manifest.capabilities.map(
                                          ({ id, scope }) => (
                                              <span key={id} className="block">
                                                  {id} ({scope})
                                              </span>
                                          ),
                                      )
                                    : t('submissions.none')}
                            </dd>
                        </div>
                        <div>
                            <dt>{t('submissions.providers')}</dt>
                            <dd>
                                {pkg.manifest.providers.join(', ') ||
                                    t('submissions.none')}
                            </dd>
                        </div>
                    </dl>
                </details>
            ))}
        </section>
    )
}
