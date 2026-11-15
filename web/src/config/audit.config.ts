export const AUDIT_FIELD_LIMITS = {
    action: 100,
    message: 500,
    route: 255,
    method: 20,
} as const

export const PREFERENCE_AUDIT_RETENTION = {
    maximumRowsPerActor: 1000,
    maximumDeletesPerWrite: 100,
} as const

export const PREFERENCE_AUDIT_ACTIONS = [
    'user.theme_mode_updated',
    'user.font_family_updated',
    'user.font_size_updated',
    'user.primary_color_updated',
    'user.primary_color_reset',
    'user.personal_info_updated',
    'user.profile_image_update_started',
    'user.profile_image_updated',
    'user.background_appearance_updated',
    'user.background_update_started',
    'user.background_updated',
    'user.background_delete_started',
    'user.background_deleted',
] as const
