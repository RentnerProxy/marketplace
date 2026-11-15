import {
    haveSamePermissionKeys,
    withoutSuperUserPermission,
    togglePermissionKey,
} from '@/lib/Permissions/permissionCollections.ts'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'

import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { getErrorMessage } from '@/lib/Errors/error.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import {
    createPermissionPresetHandler,
    deletePermissionPresetHandler,
    updatePermissionPresetHandler,
} from '../middleware.ts'
import { PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import type { PermissionManagementOverview } from '../Types/permission-management-domain.types.ts'
import type { PermissionPreset } from '../Types/permission-management-domain.types.ts'
import type { PermissionPresetFormValues } from '../Types/permission-management-form.types.ts'
import type {
    PermissionPresetsHandler,
    PermissionPresetsState,
    UsePermissionPresetsParams,
} from '../Types/permission-management-logic.types.ts'

const emptyFormValues: PermissionPresetFormValues = {
    id: null,
    name: '',
    description: '',
    permissionKeys: [],
}

function haveSameFormValues(
    firstValues: PermissionPresetFormValues,
    secondValues: PermissionPresetFormValues,
) {
    return (
        firstValues.id === secondValues.id &&
        firstValues.name === secondValues.name &&
        firstValues.description === secondValues.description &&
        haveSamePermissionKeys(
            firstValues.permissionKeys,
            secondValues.permissionKeys,
        )
    )
}

export default function usePermissionPresets({
    presets,
}: UsePermissionPresetsParams): {
    state: PermissionPresetsState
    handler: PermissionPresetsHandler
} {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [formValues, setFormValues] =
        useState<PermissionPresetFormValues>(emptyFormValues)
    const [deleteTarget, setDeleteTarget] = useState<PermissionPreset | null>(
        null,
    )

    const saveMutation = useMutation({
        mutationFn: async function (values: PermissionPresetFormValues) {
            const data = {
                name: values.name,
                description: values.description,
                permissionKeys: withoutSuperUserPermission(
                    values.permissionKeys,
                ),
            }

            if (values.id) {
                return updatePermissionPresetHandler({
                    data: { id: values.id, ...data },
                })
            }

            return createPermissionPresetHandler({ data })
        },
        onSuccess: function (result, values) {
            if (!result.success) {
                toastAppError(
                    new AppError(result.error, {
                        title: t('common.error'),
                    }),
                )
                return
            }

            toast.success(
                values.id
                    ? t('admin.permissions.presets.updated')
                    : t('admin.permissions.presets.created'),
                { title: t('admin.permissions.title') },
            )
            setFormValues((currentFormValues) =>
                haveSameFormValues(currentFormValues, values)
                    ? emptyFormValues
                    : currentFormValues,
            )
            queryClient.setQueryData<PermissionManagementOverview>(
                PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
                (currentOverview) => {
                    if (!currentOverview) {
                        return currentOverview
                    }

                    const hasExistingPreset = currentOverview.presets.some(
                        (preset) => preset.id === result.preset.id,
                    )

                    return {
                        ...currentOverview,
                        presets: hasExistingPreset
                            ? currentOverview.presets.map((preset) =>
                                  preset.id === result.preset.id
                                      ? result.preset
                                      : preset,
                              )
                            : [...currentOverview.presets, result.preset],
                    }
                },
            )
        },
        onError: function (error) {
            toast.error(
                getErrorMessage(
                    error,
                    t('admin.permissions.presets.saveError'),
                ),
                { title: t('common.error') },
            )
        },
    })

    const deleteMutation = useMutation({
        mutationFn: async function (preset: PermissionPreset) {
            return deletePermissionPresetHandler({ data: { id: preset.id } })
        },
        onSuccess: function (result, preset) {
            if (!result.success) {
                toastAppError(
                    new AppError(result.error, {
                        title: t('common.error'),
                    }),
                )
                return
            }

            toast.success(t('admin.permissions.presets.deleted'), {
                title: t('admin.permissions.title'),
            })
            setDeleteTarget(null)
            setFormValues((currentFormValues) =>
                currentFormValues.id === preset.id
                    ? emptyFormValues
                    : currentFormValues,
            )
            queryClient.setQueryData<PermissionManagementOverview>(
                PERMISSION_MANAGEMENT_OVERVIEW_QUERY_KEY,
                (currentOverview) =>
                    currentOverview
                        ? {
                              ...currentOverview,
                              presets: currentOverview.presets.filter(
                                  (currentPreset) =>
                                      currentPreset.id !== preset.id,
                              ),
                          }
                        : currentOverview,
            )
        },
        onError: function (error) {
            toast.error(
                getErrorMessage(
                    error,
                    t('admin.permissions.presets.deleteError'),
                ),
                { title: t('common.error') },
            )
        },
    })

    const handleFieldChange: PermissionPresetsHandler['handleFieldChange'] =
        function (key, value) {
            setFormValues((currentFormValues) => ({
                ...currentFormValues,
                [key]: value,
            }))
        }

    function handleTogglePermission(permissionKey: string) {
        setFormValues((currentFormValues) => ({
            ...currentFormValues,
            permissionKeys: togglePermissionKey(
                currentFormValues.permissionKeys,
                permissionKey,
            ),
        }))
    }

    function handleSubmit() {
        saveMutation.mutate(formValues)
    }

    function handleStartCreate() {
        setFormValues(emptyFormValues)
    }

    function handleStartEdit(preset: PermissionPreset) {
        setFormValues({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            permissionKeys: withoutSuperUserPermission(preset.permissionKeys),
        })
    }

    const handleAskDelete: (preset: PermissionPreset) => void = setDeleteTarget

    function handleCloseDeleteModal() {
        setDeleteTarget(null)
    }

    function handleConfirmDelete() {
        if (deleteTarget) {
            deleteMutation.mutate(deleteTarget)
        }
    }

    return {
        state: {
            formValues,
            presets,
            deleteTarget,
            isSaving: saveMutation.isPending,
            isDeleting: deleteMutation.isPending,
        },
        handler: {
            handleFieldChange,
            handleTogglePermission,
            handleSubmit,
            handleStartCreate,
            handleStartEdit,
            handleAskDelete,
            handleCloseDeleteModal,
            handleConfirmDelete,
        },
    }
}
