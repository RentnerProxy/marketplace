import type {
    DefaultPermissionsHandler,
    DefaultPermissionsState,
} from '@/features/Admin/PermissionManagement/Types/permission-management-logic.types.ts'
import type { PermissionManagementPermission } from '@/features/Admin/PermissionManagement/Types/permission-management-domain.types.ts'

export type PublicAccountDefaultsLogic = {
    state: DefaultPermissionsState & {
        permissions: Array<PermissionManagementPermission>
        isLoading: boolean
        isError: boolean
    }
    handler: DefaultPermissionsHandler & { handleRetry: () => void }
}
