import { passwordResetConfig } from '@/config/session.config.ts'
import { isPasswordResetPath } from '@/lib/Auth/passwordResetPath.ts'
import { createBrowserTokenHandoff } from '@/lib/Auth/TokenHandoff/browserTokenHandoff.ts'
import type {
    PasswordResetBrowser,
    PasswordResetTokenHandoff,
    PasswordResetTokenTransfer,
} from './Types/password-reset-token.types.ts'

const handoffs = createBrowserTokenHandoff({
    isActivePath: isPasswordResetPath,
    parseFragment: parsePasswordResetFragment,
    canonicalPath: '/password-reset',
    clearUrlError: 'Unable to clear the password reset URL',
})

export function parsePasswordResetFragment(
    fragment: string,
): PasswordResetTokenTransfer {
    if (!fragment) return { status: 'missing' }
    if (
        fragment.length > passwordResetConfig.maximumLegacyQueryLength ||
        !fragment.startsWith('#token=') ||
        fragment.includes('&')
    )
        return { status: 'invalid' }
    try {
        const token = decodeURIComponent(
            fragment.slice('#token='.length),
        ).trim()
        if (!token || token.length > passwordResetConfig.maximumTokenLength)
            return { status: 'invalid' }
        return { status: 'captured', token }
    } catch {
        return { status: 'invalid' }
    }
}

export const captureResetToken: (browser: PasswordResetBrowser) => void =
    handoffs.capture
export const getPasswordResetTokenHandoff: (
    browser: PasswordResetBrowser,
) => PasswordResetTokenHandoff | undefined = handoffs.get
export const discardPasswordResetToken: (
    browser: PasswordResetBrowser,
) => void = handoffs.discard
