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

const APP_STORE_APP_ID_PATTERN =
    /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?\.[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const APP_STORE_FILE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function assertStoreImageFileId(fileId: string) {
    if (!APP_STORE_FILE_ID_PATTERN.test(fileId)) {
        throw new Error('Invalid store image file id')
    }
    return fileId
}

/** Store images live in public storage under unguessable per-upload file ids. */
export function getAppStoreImagePaths(appId: string) {
    if (!APP_STORE_APP_ID_PATTERN.test(appId)) {
        throw new Error('Invalid app id for store image paths')
    }

    const absoluteDir = path.join(
        getPublicStorageRoot(),
        'images',
        'apps',
        appId,
    )

    return {
        absoluteDir,
        absoluteFile: (fileId: string) =>
            path.join(absoluteDir, `${assertStoreImageFileId(fileId)}.webp`),
        relativeFile: (fileId: string) =>
            `/images/apps/${appId}/${assertStoreImageFileId(fileId)}.webp`,
    }
}
