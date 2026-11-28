import type { ParsedStorageAssetPath } from './Types/storage-asset-path.types.ts'

function isPublicStorageAssetPath(pathname: string) {
    return (
        pathname === '/favicon.ico' ||
        pathname === '/images/default.webp' ||
        pathname === '/images/default-64.webp' ||
        /^\/images\/system\/logo(?:-64)?\.webp$/.test(pathname) ||
        /^\/images\/user\/[0-9a-f-]{36}\/profile(?:-64)?\.webp$/i.test(
            pathname,
        ) ||
        /^\/images\/apps\/[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?\.[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(
            pathname,
        )
    )
}

export function parsePublicStorageAssetPath(
    rawPathname: string,
): ParsedStorageAssetPath {
    let pathname: string

    try {
        pathname = decodeURIComponent(rawPathname)
    } catch {
        return { kind: 'invalid' }
    }

    const pathSegments = pathname.split('/')

    if (
        /%2f|%5c/i.test(rawPathname) ||
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathSegments.some((segment) => segment === '.' || segment === '..')
    ) {
        return { kind: 'invalid' }
    }

    if (!isPublicStorageAssetPath(pathname)) {
        return { kind: 'not-storage' }
    }

    return {
        kind: 'storage',
        pathname,
        relativePath: pathname.replace(/^\/+/, ''),
    }
}
