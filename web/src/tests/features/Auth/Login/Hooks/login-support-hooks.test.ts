import { afterEach, beforeEach, expect, it, vi } from 'bun:test'
import type { SubmitEvent } from 'react'
import {
    hookReact,
    renderHook,
    resetHooks,
    runEffects,
} from '@/tests/layouts/hook-harness.ts'
import type { LoginRedirectReason } from '@/lib/Routes/Types/route-redirect.types.ts'
import { DEFAULT_IMAGE_SRC } from '@/lib/Images/imageFallbacks.ts'
import { PROJECT_CONFIG } from '@/config/app.config.ts'

let settings: { companyName?: string; logoSrc?: string } | undefined
const navigate = vi.fn(async () => {})
const toastError = vi.fn()
const submit = vi.fn()
vi.mock('react', () => ({
    ...hookReact,
    useRef<T>(initial: T) {
        return hookReact.useState(() => ({ current: initial }))[0] as {
            current: T
        }
    },
}))
vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({ data: settings }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/lib/Queries/appQueries.ts', () => ({
    systemSettingsQueryOptions: () => ({ queryKey: ['settings'] }),
}))
vi.mock('@/language/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
vi.mock('@rentnerkev/toasts', () => ({ toast: { error: toastError } }))
const { default: useHeader } =
    await import('@/features/Auth/Login/Hooks/useLoginHeaderLogic.ts')
const { default: useRedirectToast } =
    await import('@/features/Auth/Login/Hooks/useLoginRedirectToast.ts')
const { default: useTwoFactor } =
    await import('@/features/Auth/Login/Hooks/useTwoFactorLogin.ts')
beforeEach(() => {
    resetHooks()
    vi.clearAllMocks()
    vi.useFakeTimers()
    settings = undefined
})
afterEach(() => {
    vi.useRealTimers()
})

it('provides default login branding and distinguishes custom logos from the default', () => {
    expect(useHeader().state.logoSrc).toBe('/rentnerproxy-logo.png')
    expect(useHeader().state.hasCustomLogo).toBe(false)
    expect(useHeader().state.companyName.length).toBeGreaterThan(0)
    settings = { companyName: 'Synthetic Company', logoSrc: '/custom-logo.png' }
    expect(useHeader().state).toEqual({
        companyName: 'Synthetic Company',
        logoSrc: '/custom-logo.png',
        hasCustomLogo: true,
    })
    for (const logoSrc of [DEFAULT_IMAGE_SRC, '/rentnerproxy-logo.png']) {
        settings.logoSrc = logoSrc
        expect(useHeader().state.hasCustomLogo).toBe(false)
    }
})

it.each(['', '   ', '\t\n'])(
    'falls back from blank company metadata while preserving a custom logo: %j',
    (companyName) => {
        settings = { companyName, logoSrc: '/custom-logo.png' }
        expect(useHeader().state).toEqual({
            companyName: PROJECT_CONFIG.defaultName,
            logoSrc: '/custom-logo.png',
            hasCustomLogo: true,
        })
    },
)

it.each([
    'password-reset-token-missing',
    'password-reset-token-invalid',
] satisfies LoginRedirectReason[])(
    'shows one actionable redirect toast for %s and clears the login hash',
    (reason) => {
        renderHook(() => useRedirectToast())
        runEffects()()
        expect(toastError).not.toHaveBeenCalled()
        renderHook(() => useRedirectToast(reason))
        runEffects()()
        expect(toastError).toHaveBeenCalledWith(
            reason === 'password-reset-token-missing'
                ? 'auth.passwordReset.missingLinkDescription'
                : 'auth.passwordReset.invalidLinkDescription',
            {
                title:
                    reason === 'password-reset-token-missing'
                        ? 'auth.passwordReset.missingLinkTitle'
                        : 'auth.passwordReset.invalidLinkTitle',
            },
        )
        expect(navigate).toHaveBeenCalledWith({
            to: '/login',
            hash: '',
            replace: true,
        })
        renderHook(() => useRedirectToast(reason))
        runEffects()()
        expect(toastError).toHaveBeenCalledTimes(1)
    },
)

it('focuses the two-factor input, rejects incomplete codes, submits exact codes and clears state on back', () => {
    const render = () => renderHook(() => useTwoFactor(submit))
    const focus = vi.fn()
    render().handler.handleTwoFactorRef({
        focus,
    } as unknown as HTMLInputElement)
    render().handler.showTwoFactorForm(false)
    vi.advanceTimersByTime(0)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(render().state.requiresTwoFactor).toBe(true)
    const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as SubmitEvent<HTMLFormElement>
    render().handler.handleTwoFactorSubmit(event)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(render().state.isTwoFactorError).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    render().handler.handleTwoFactorChange(['1', '2', '3', '4', '5', '6'])
    render().setter.setTrustThisDevice(true)
    expect(render().state.isTwoFactorError).toBe(false)
    render().handler.showTwoFactorForm(true)
    expect(render().state.isTwoFactorError).toBe(true)
    render().handler.handleTwoFactorSubmit(event)
    expect(submit).toHaveBeenCalledWith({
        twoFactorCode: '123456',
        trustThisDevice: true,
    })
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(event.stopPropagation).toHaveBeenCalledTimes(2)
    render().handler.handleBackToLogin()
    expect(render().state).toMatchObject({
        requiresTwoFactor: false,
        trustThisDevice: false,
        isTwoFactorError: false,
        twoFactorCode: ['', '', '', '', '', ''],
    })
    render().handler.handleTwoFactorRef(null)
    vi.advanceTimersByTime(0)
    expect(focus).toHaveBeenCalledTimes(1)
})
