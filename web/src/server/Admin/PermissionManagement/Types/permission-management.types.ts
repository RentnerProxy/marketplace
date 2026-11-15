export type PersistedPreset = {
    id: string
    name: string
    description: string
    createdAt: Date
    updatedAt: Date
}

export type PermissionPresetMutationInput = {
    actorUserId: string
    presetId: string
    operation: 'created' | 'updated' | 'deleted'
}
