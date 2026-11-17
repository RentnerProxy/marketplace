import {
    haveSamePermissionKeys,
    togglePermissionKey,
} from '@/lib/Permissions/permissionCollections.ts'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'

import useTranslationStore from '@/language/useTranslationStore.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { getErrorMessage } from '@/lib/Errors/error.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { replaceDefaultPermissionsHandler } from '../middleware.ts'
import { PUBLIC_ACCOUNT_DEFAULTS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import type { PublicAccountDefaults } from '../Types/permission-management-domain.types.ts'
import type {
    DefaultPermissionsHandler,
    DefaultPermissionsState,
    UseDefaultPermissionsParams,
} from '../Types/permission-management-logic.types.ts'

export default function useDefaultPermissions({
    defaultPermissionKeys,
}: UseDefaultPermissionsParams): {
    state: DefaultPermissionsState
    handler: DefaultPermissionsHandler
} {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [permissionKeys, setPermissionKeys] = useState<Array<string>>(
        defaultPermissionKeys,
    )
    const previousDefaultPermissionKeysRef = useRef(defaultPermissionKeys)

    useEffect(() => {
        const nextDefaultPermissionKeys = defaultPermissionKeys
        const previousDefaultPermissionKeys =
            previousDefaultPermissionKeysRef.current

        previousDefaultPermissionKeysRef.current = nextDefaultPermissionKeys
        setPermissionKeys((currentPermissionKeys) => {
            if (
                !haveSamePermissionKeys(
                    currentPermissionKeys,
                    previousDefaultPermissionKeys,
                )
            ) {
                return currentPermissionKeys
            }

            return haveSamePermissionKeys(
                currentPermissionKeys,
                nextDefaultPermissionKeys,
            )
                ? currentPermissionKeys
                : nextDefaultPermissionKeys
        })
    }, [defaultPermissionKeys])

    const saveMutation = useMutation({
        mutationFn: async function (nextPermissionKeys: Array<string>) {
            return replaceDefaultPermissionsHandler({
                data: { permissionKeys: nextPermissionKeys },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(
                    new AppError(result.error, {
                        title: t('common.error'),
                    }),
                )
                return
            }

            toast.success(t('admin.permissions.defaults.saved'), {
                title: t('admin.permissions.defaults.title'),
            })
            setPermissionKeys(result.permissionKeys)
            queryClient.setQueryData<PublicAccountDefaults>(
                PUBLIC_ACCOUNT_DEFAULTS_QUERY_KEY,
                (currentOverview) =>
                    currentOverview
                        ? {
                              ...currentOverview,
                              defaultPermissionKeys: result.permissionKeys,
                          }
                        : currentOverview,
            )
        },
        onError: function (error) {
            toast.error(
                getErrorMessage(
                    error,
                    t('admin.permissions.defaults.saveError'),
                ),
                { title: t('common.error') },
            )
        },
    })

    function handleTogglePermission(permissionKey: string) {
        setPermissionKeys((currentPermissionKeys) =>
            togglePermissionKey(currentPermissionKeys, permissionKey),
        )
    }

    function handleSave() {
        saveMutation.mutate(permissionKeys)
    }

    return {
        state: {
            permissionKeys,
            isDirty: !haveSamePermissionKeys(
                defaultPermissionKeys,
                permissionKeys,
            ),
            isSaving: saveMutation.isPending,
        },
        handler: {
            handleTogglePermission,
            handleSave,
        },
    }
}
