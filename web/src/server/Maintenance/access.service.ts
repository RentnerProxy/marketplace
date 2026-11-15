import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hasPermission } from '@/lib/Permissions/permissions.ts'
import { MaintenanceModeError } from './access.errors.ts'
import { getMaintenanceStateService } from './state.service.ts'

export async function requireMaintenanceAccessService(
    permissionKeys: Array<string>,
) {
    if (hasPermission(permissionKeys, PERMISSIONS.ADMIN_MAINTENANCE_BYPASS)) {
        return
    }

    const maintenance = await getMaintenanceStateService()

    if (maintenance.isActive) {
        throw new MaintenanceModeError()
    }
}
