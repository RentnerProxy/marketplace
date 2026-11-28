import type { NormalizedUserUpdate } from './Types/user-update.types.ts'
import type { UpdateUserProfileInput } from '@/features/Admin/UserManagement/Types/user-management-server-input.types.ts'

export function normalizeUserProfileUpdate(data: UpdateUserProfileInput) {
    const username = data.username.trim()
    const email = data.email.trim().toLowerCase()

    if (!username || !email) {
        return {
            success: false as const,
            error: 'Username und E-Mail sind erforderlich.',
        }
    }

    return {
        success: true as const,
        input: {
            id: data.id,
            accountType: data.accountType,
            username,
            email,
        } satisfies NormalizedUserUpdate,
    }
}
