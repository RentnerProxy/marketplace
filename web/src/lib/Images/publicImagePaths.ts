import path from 'node:path'

export function getPublicStorageRoot() {
    if (process.env.APP_STORAGE_DIR) {
        return path.resolve(process.env.APP_STORAGE_DIR)
    }

    return path.join(process.cwd(), 'web', 'public')
}

export function getPrivateStorageRoot() {
    if (process.env.APP_PRIVATE_STORAGE_DIR) {
        return path.resolve(process.env.APP_PRIVATE_STORAGE_DIR)
    }

    if (process.env.APP_STORAGE_DIR) {
        return path.join(
            path.dirname(path.resolve(process.env.APP_STORAGE_DIR)),
            'private',
        )
    }

    return path.join(process.cwd(), 'storage-data', 'private')
}

export function getUserPublicImagePaths(userId: string) {
    const relativeDir = `/images/user/${userId}`
    const publicStorageRoot = getPublicStorageRoot()
    const absolutePrivateStorageRoot = getPrivateStorageRoot()
    const absoluteDir = path.join(publicStorageRoot, 'images', 'user', userId)
    const absoluteBackgroundDir = path.join(
        absolutePrivateStorageRoot,
        'images',
        'user',
        userId,
    )

    return {
        relativeProfile: `${relativeDir}/profile.webp`,
        relativeProfileSmall: `${relativeDir}/profile-64.webp`,
        relativeBackground: '/api/user/background',
        absoluteDir,
        absolutePrivateStorageRoot,
        absoluteBackgroundDir,
        absoluteProfile: path.join(absoluteDir, 'profile.webp'),
        absoluteProfileSmall: path.join(absoluteDir, 'profile-64.webp'),
        absoluteLegacyBackground: path.join(absoluteDir, 'background.webp'),
        absoluteBackground: path.join(absoluteBackgroundDir, 'background.webp'),
    }
}

export function getSystemLogoPublicImagePaths() {
    const relativeDir = '/images/system'
    const publicStorageRoot = getPublicStorageRoot()
    const absoluteDir = path.join(publicStorageRoot, 'images', 'system')

    return {
        relativeLarge: `${relativeDir}/logo.webp`,
        relativeSmall: `${relativeDir}/logo-64.webp`,
        relativeFavicon: '/favicon.ico',
        absoluteDir,
        absoluteLarge: path.join(absoluteDir, 'logo.webp'),
        absoluteSmall: path.join(absoluteDir, 'logo-64.webp'),
        absoluteFavicon: path.join(publicStorageRoot, 'favicon.ico'),
    }
}
