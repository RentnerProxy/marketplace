import { createFirstSuperUserAccountFormSchema } from '@/features/Auth/FirstSuperUser/validation.ts'
import type {
    FirstSetupClientPhase,
    FirstSetupController,
    FirstSetupControllerOptions,
    FirstSetupFormError,
} from './Types/first-setup-controller.types.ts'
import type { CreateFirstSuperUserAccountInput } from '@/features/Auth/FirstSuperUser/Types/first-super-user-server-input.types.ts'

const interruptedRequest = Symbol('first-setup-request-interrupted')

export function createFirstSetupController(
    options: FirstSetupControllerOptions,
): FirstSetupController {
    let token: string | null = null
    let phase: FirstSetupClientPhase = 'checking'
    let disposed = false
    let generation = 0
    let activeRequest: AbortController | null = null
    let activeInput: CreateFirstSuperUserAccountInput | null = null

    function clearRequestInput() {
        if (!activeInput) return
        activeInput.setupToken = ''
        activeInput.password = ''
        activeInput.confirmPassword = ''
        activeInput = null
    }

    function setPhase(next: FirstSetupClientPhase) {
        phase = next
        if (!disposed) options.onPhaseChange(next)
    }

    function invalidate() {
        generation += 1
        token = null
        clearRequestInput()
        const request = activeRequest
        activeRequest = null
        request?.abort()
        options.clearPasswords()
        setPhase('checking')
    }

    async function invoke(input: CreateFirstSuperUserAccountInput) {
        const request = new AbortController()
        activeRequest = request
        let rejectCancellation: (() => void) | undefined
        const cancellation = new Promise<never>(function (_resolve, reject) {
            rejectCancellation = () => reject(interruptedRequest)
        })
        void cancellation.catch(function () {})
        const cancel = () => rejectCancellation?.()
        request.signal.addEventListener('abort', cancel, { once: true })
        const cancelTimeout = options.schedule(
            () => request.abort(),
            options.requestTimeoutMs,
        )
        try {
            return await Promise.race([
                cancellation,
                options.create(input, request.signal),
            ])
        } finally {
            cancelTimeout()
            request.signal.removeEventListener('abort', cancel)
            if (activeRequest === request) activeRequest = null
        }
    }

    return {
        receiveToken(transfer) {
            if (disposed) return
            invalidate()
            if (transfer.status !== 'captured') {
                setPhase('missing')
                return
            }
            token = transfer.token
            setPhase('granted')
        },
        invalidate,
        async submit(values) {
            if (disposed || phase !== 'granted' || !token || activeRequest)
                return
            const parsed =
                createFirstSuperUserAccountFormSchema.safeParse(values)
            if (!parsed.success) {
                const issues = parsed.error.issues
                const firstField = issues[0]?.path[0]
                let reason: FirstSetupFormError = 'invalid-data'
                if (
                    issues.some(
                        (issue) => issue.message === 'passwords_must_match',
                    )
                ) {
                    reason = 'password-mismatch'
                } else if (
                    firstField === 'password' ||
                    firstField === 'confirmPassword'
                ) {
                    reason = 'password-policy'
                } else if (
                    firstField === 'email' ||
                    firstField === 'username'
                ) {
                    reason = firstField
                }
                options.onInvalidInput(reason)
                return
            }
            const currentGeneration = generation
            const input = { ...parsed.data, setupToken: token }
            activeInput = input
            setPhase('submitting')
            try {
                const result = await invoke(input)
                if (disposed || generation !== currentGeneration) return
                if (
                    typeof result !== 'object' ||
                    result === null ||
                    !('success' in result)
                )
                    throw new Error('Invalid first setup response')
                if (result.success === true) {
                    token = null
                    options.clearPasswords()
                    setPhase('complete')
                    options.onComplete('created')
                    return
                }
                if (result.success !== false || !('errorCode' in result))
                    throw new Error('Invalid first setup response')
                if (result.errorCode === 'invalid_setup_token') {
                    token = null
                    options.clearPasswords()
                    setPhase('missing')
                    options.onInvalidToken()
                    return
                }
                if (result.errorCode !== 'setup_already_completed')
                    throw new Error('Invalid first setup response')
                token = null
                options.clearPasswords()
                setPhase('complete')
                options.onComplete('already-completed')
            } catch (error) {
                if (disposed || generation !== currentGeneration) return
                setPhase('granted')
                options.onError(error)
            } finally {
                input.setupToken = ''
                input.password = ''
                input.confirmPassword = ''
                if (activeInput === input) activeInput = null
            }
        },
        dispose() {
            if (disposed) return
            disposed = true
            invalidate()
        },
    }
}
