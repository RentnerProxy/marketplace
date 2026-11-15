export function createDeletedUserIdentity() {
    const deletedUserSuffix = crypto
        .randomUUID()
        .replaceAll('-', '')
        .slice(0, 16)
    const username = `deleted_${deletedUserSuffix}`

    return {
        username,
        email: `${username}@deleted.invalid`,
    }
}
