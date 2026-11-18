import { createBrowserTokenHandoff } from './TokenHandoff/browserTokenHandoff.ts'

export const registrationTokenPattern = /^[A-Za-z0-9_-]{43}$/u
const verificationPrefix = '#verify='

export function isRegistrationPath(pathname: string) {
    try {
        return /^\/+register\/*$/i.test(decodeURI(pathname))
    } catch {
        return false
    }
}

export const registrationTokenHandoff = createBrowserTokenHandoff({
    canonicalPath: '/register',
    isActivePath: isRegistrationPath,
    shouldCaptureFragmentChange: (fragment) =>
        fragment.startsWith(verificationPrefix),
    parseFragment(fragment) {
        if (!fragment.startsWith(verificationPrefix))
            return { status: 'missing' }
        const token = fragment.slice(verificationPrefix.length)
        return registrationTokenPattern.test(token)
            ? { status: 'captured', token }
            : { status: 'invalid' }
    },
    clearUrlError: 'Could not clear the registration verification URL.',
})
