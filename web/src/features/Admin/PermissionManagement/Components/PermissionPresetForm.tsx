import { FilePenLine, Save, X } from 'lucide-react'
import { Textarea, TextInput } from '@rentnerkev/inputs'
import useTranslationStore from '@/language/useTranslationStore.ts'
import PermissionChecklist from './PermissionChecklist.tsx'
import type { PermissionPresetFormProps } from '../Types/permission-management-component-props.types.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'

export default function PermissionPresetForm({
    permissions,
    isLoading,
    formValues,
    isSaving,
    onFieldChange,
    onTogglePermission,
    onSubmit,
    onCancelEdit,
}: PermissionPresetFormProps) {
    const { t } = useTranslationStore()
    const isEditing = Boolean(formValues.id)

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-dark bg-surface-dark p-5">
            <form
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault()
                    onSubmit()
                }}
            >
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                    <div className="mb-1 flex shrink-0 items-start gap-3">
                        <HeadingIcon icon={FilePenLine} />
                        <div>
                            <h2 className="text-lg font-bold text-white">
                                {isEditing
                                    ? t('admin.permissions.presets.editTitle')
                                    : t(
                                          'admin.permissions.presets.createTitle',
                                      )}
                            </h2>
                            <p className="mt-1 text-sm text-secondary-text">
                                {t('admin.permissions.presets.formDescription')}
                            </p>
                        </div>
                    </div>

                    <div className="shrink-0">
                        <TextInput
                            label={t('admin.permissions.presets.nameLabel')}
                            value={formValues.name}
                            required
                            minLength={2}
                            maxLength={100}
                            showLength
                            onChange={(event) =>
                                onFieldChange('name', event.target.value)
                            }
                            className="h-11 w-full rounded-md"
                        />
                    </div>

                    <div className="shrink-0">
                        <Textarea
                            label={t(
                                'admin.permissions.presets.descriptionLabel',
                            )}
                            value={formValues.description}
                            maxLength={500}
                            rows={3}
                            onChange={(event) =>
                                onFieldChange('description', event.target.value)
                            }
                            className="w-full resize-none rounded-md"
                        />
                    </div>

                    <div className="flex shrink-0 flex-col xl:min-h-0 xl:flex-1">
                        <span className="mb-2 block shrink-0 text-sm font-medium text-secondary-text">
                            {t('admin.permissions.presets.permissionsLabel')}
                        </span>
                        <PermissionChecklist
                            permissions={permissions}
                            selectedPermissionKeys={formValues.permissionKeys}
                            isLoading={isLoading}
                            disabled={isSaving}
                            onTogglePermission={onTogglePermission}
                        />
                    </div>
                </div>

                <div className="mt-4 flex shrink-0 flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    {isEditing && (
                        <button
                            type="button"
                            onClick={onCancelEdit}
                            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-input-dark px-4 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                        >
                            <X className="h-4 w-4" />
                            {t('common.cancel')}
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={
                            isSaving ||
                            isLoading ||
                            formValues.name.trim().length === 0
                        }
                        className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Save className="h-4 w-4" />
                        {isSaving
                            ? t('common.saving')
                            : t('admin.permissions.presets.save')}
                    </button>
                </div>
            </form>
        </section>
    )
}
