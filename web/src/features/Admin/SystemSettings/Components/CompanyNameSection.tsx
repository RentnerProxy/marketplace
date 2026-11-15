import { Building2, Save } from 'lucide-react'
import { TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { CompanyNameSectionProps } from '../Types/system-settings-component-props.types.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function CompanyNameSection({
    state,
    handler,
}: CompanyNameSectionProps) {
    const { t } = useTranslationStore()

    return (
        <section className="rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="flex items-start gap-3">
                <HeadingIcon icon={Building2} />
                <div>
                    <h2 className="text-lg font-bold text-white">
                        {t('admin.systemSettings.companyName')}
                    </h2>
                    <p className="text-sm text-secondary-text">
                        {t('admin.systemSettings.companyNameDescription')}
                    </p>
                </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <TextInput
                    value={state.companyName}
                    onValueChange={handler.handleCompanyNameChange}
                    required
                    placeholder={t('admin.systemSettings.companyName')}
                    icon={<Building2 className="h-5 w-5" />}
                    maxLength={100}
                    showLength
                />
                <button
                    type="button"
                    disabled={state.isSavingCompanyName}
                    onClick={handler.handleSaveCompanyName}
                    className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Save className="h-4 w-4" />
                    {state.isSavingCompanyName
                        ? t('common.saving')
                        : t('common.save')}
                </button>
            </div>
        </section>
    )
}
