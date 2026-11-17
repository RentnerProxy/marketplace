import { createBrowserTokenHandoff } from '@/lib/Auth/TokenHandoff/browserTokenHandoff.ts'

export const STAFF_INVITATION_PATH = '/staff-invitation'
export const STAFF_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export function isStaffInvitationPath(pathname: string) {
    return (
        pathname === STAFF_INVITATION_PATH ||
        pathname === STAFF_INVITATION_PATH + '/'
    )
}

export const staffInvitationTokenHandoff = createBrowserTokenHandoff({
    canonicalPath: STAFF_INVITATION_PATH,
    isActivePath: isStaffInvitationPath,
    parseFragment(fragment) {
        if (!fragment) return { status: 'missing' }
        const token = fragment.startsWith('#invite=') ? fragment.slice(8) : ''
        return STAFF_INVITATION_TOKEN_PATTERN.test(token)
            ? { status: 'captured', token }
            : { status: 'invalid' }
    },
    clearUrlError: 'Could not clear the staff invitation URL.',
})
