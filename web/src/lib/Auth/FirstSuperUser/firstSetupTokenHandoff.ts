import {
    getSetupAccessTokenFromFragment,
    isFirstSuperUserSetupPath,
} from '@/features/Auth/FirstSuperUser/setupAccess.ts'
import { createBrowserTokenHandoff } from '@/lib/Auth/TokenHandoff/browserTokenHandoff.ts'
import type {
    FirstSetupBrowser,
    FirstSetupTokenHandoff,
} from './Types/first-setup-token.types.ts'

const handoffs = createBrowserTokenHandoff({
    isActivePath: isFirstSuperUserSetupPath,
    parseFragment(fragment) {
        const token = getSetupAccessTokenFromFragment(fragment)
        return token
            ? { status: 'captured', token }
            : { status: fragment ? 'invalid' : 'missing' }
    },
    canonicalPath: '/setup',
    clearUrlError: 'Unable to clear the first setup URL',
})

export const captureFirstSetupToken: (browser: FirstSetupBrowser) => void =
    handoffs.capture
export const getFirstSetupTokenHandoff: (
    browser: FirstSetupBrowser,
) => FirstSetupTokenHandoff | undefined = handoffs.get
export const discardFirstSetupToken: (browser: FirstSetupBrowser) => void =
    handoffs.discard
