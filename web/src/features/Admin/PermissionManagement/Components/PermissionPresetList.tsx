import { Layers3, Pencil, Plus, Trash2 } from 'lucide-react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { PermissionPresetListProps } from '../Types/permission-management-component-props.types.ts'
import HeadingIcon from '@/shared/HeadingIcon.tsx'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'

export default function PermissionPresetList({
    presets,
    onStartCreate,
    onStartEdit,
    onAskDelete,
}: PermissionPresetListProps) {
    const { t } = useTranslationStore()

    return (
        <section className="flex h-full min-h-0 flex-col overflow-y-auto rounded-lg border border-border-dark bg-surface-dark p-5">
            <div className="mb-5 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <HeadingIcon icon={Layers3} />
                    <div>
                        <h2 className="text-lg font-bold text-white">
                            {t('admin.permissions.presets.listTitle')}
                        </h2>
                        <p className="mt-1 text-sm text-secondary-text">
                            {t('admin.permissions.presets.listDescription')}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onStartCreate}
                    className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-dark bg-input-dark px-3 text-sm font-semibold text-secondary-text transition-colors hover:text-white"
                >
                    <Plus className="h-4 w-4" />
                    {t('admin.permissions.presets.newPreset')}
                </button>
            </div>

            {presets.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border-dark bg-input-dark/30 px-4 text-center text-sm text-secondary-text">
                    {t('admin.permissions.presets.empty')}
                </div>
            ) : (
                <div className="min-h-32 flex-1 space-y-2 overflow-y-auto pr-1">
                    {presets.map((preset) => {
                        const permissionCount = preset.permissionKeys.filter(
                            (permissionKey) =>
                                permissionKey !== PERMISSIONS.ADMIN_SUPER_USER,
                        ).length

                        return (
                            <article
                                key={preset.id}
                                className="grid gap-4 rounded-md border border-border-dark bg-input-dark/30 p-4 transition-colors hover:bg-input-dark/60 md:grid-cols-[minmax(0,1fr)_auto]"
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="break-words font-semibold text-white">
                                            {preset.name}
                                        </h3>
                                        <span className="inline-flex items-center gap-1 rounded-sm border border-border-dark bg-background-dark px-2 py-0.5 text-xs font-medium text-foreground">
                                            <Layers3 className="h-3.5 w-3.5 text-primary" />
                                            {t(
                                                'admin.permissions.presets.permissionCount',
                                                { count: permissionCount },
                                            )}
                                        </span>
                                    </div>
                                    <p className="mt-2 break-words text-sm text-secondary-text">
                                        {preset.description ||
                                            t(
                                                'admin.permissions.presets.noDescription',
                                            )}
                                    </p>
                                </div>

                                <div className="self-center justify-self-end">
                                    <ActionMenu
                                        items={[
                                            {
                                                id: 'edit',
                                                label: t(
                                                    'admin.permissions.presets.editAriaLabel',
                                                ),
                                                icon: <Pencil />,
                                                onSelect: () =>
                                                    onStartEdit(preset),
                                            },
                                            {
                                                id: 'delete',
                                                label: t(
                                                    'admin.permissions.presets.deleteAriaLabel',
                                                ),
                                                icon: <Trash2 />,
                                                destructive: true,
                                                onSelect: () =>
                                                    onAskDelete(preset),
                                            },
                                        ]}
                                    />
                                </div>
                            </article>
                        )
                    })}
                </div>
            )}
        </section>
    )
}
