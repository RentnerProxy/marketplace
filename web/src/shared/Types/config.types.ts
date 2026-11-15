import type { PERMISSIONS } from '@/config/permissions.config.ts'

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export type AppLanguage = 'de' | 'en'

export type PermissionDefinition = {
    key: PermissionKey
    name: string
    description: string
}
