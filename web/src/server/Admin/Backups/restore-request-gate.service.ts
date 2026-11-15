import { hasControlCharacters } from '@/lib/Validation/hasControlCharacters.ts'
import { isRestoreStateActiveService } from './restore-state.service.ts'
import { isStorageMutationBarrierHealthyService } from '@/server/Storage/storage-mutation-barrier-health.service.ts'

const RESTORE_PROGRESS_PATH = '/update-in-progress'
export const RESTORE_STATUS_PATH = '/api/system/restore-status'
const MAX_RESTORE_RETURN_PATH_LENGTH = 2_048

function getRestoreProgressLocation(request: Request) {
    const requestUrl = new URL(request.url)
    const returnPath = `${requestUrl.pathname}${requestUrl.search}`

    if (
        !returnPath.startsWith('/') ||
        returnPath.startsWith('//') ||
        returnPath.includes('\\') ||
        hasControlCharacters(returnPath) ||
        returnPath.length > MAX_RESTORE_RETURN_PATH_LENGTH
    ) {
        return RESTORE_PROGRESS_PATH
    }

    return `${RESTORE_PROGRESS_PATH}#return=${encodeURIComponent(returnPath)}`
}

function isRestoreGateAssetPath(pathname: string) {
    return (
        pathname.startsWith('/_build/') ||
        pathname.startsWith('/assets/') ||
        pathname.startsWith('/@vite/') ||
        pathname.startsWith('/@id/') ||
        pathname.startsWith('/@fs/') ||
        pathname.startsWith('/web/src/') ||
        pathname.startsWith('/node_modules/') ||
        pathname === '/@react-refresh'
    )
}

export function isRestoreGateBypassPath(pathname: string) {
    return (
        pathname === RESTORE_PROGRESS_PATH ||
        pathname === RESTORE_STATUS_PATH ||
        isRestoreGateAssetPath(pathname)
    )
}

export async function getRestoreRequestGateResponse(
    request: Request,
    pathname: string,
) {
    if (isRestoreGateBypassPath(pathname)) {
        return null
    }

    if (
        isStorageMutationBarrierHealthyService() &&
        !(await isRestoreStateActiveService())
    ) {
        return null
    }

    const acceptsHtml = request.headers
        .get('accept')
        ?.toLowerCase()
        .includes('text/html')

    if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        acceptsHtml
    ) {
        return new Response(null, {
            status: 307,
            headers: {
                'cache-control': 'no-store',
                location: getRestoreProgressLocation(request),
            },
        })
    }

    return new Response(
        JSON.stringify({
            error: 'Das System wird gerade aus einem Backup wiederhergestellt.',
        }),
        {
            status: 503,
            headers: {
                'cache-control': 'no-store',
                'content-type': 'application/json; charset=utf-8',
                'retry-after': '3',
            },
        },
    )
}
