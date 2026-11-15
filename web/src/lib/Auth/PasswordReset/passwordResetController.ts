import { authNewPasswordSchema } from '../validation.ts'
import { isPasswordResetTokenValidationValid } from './passwordResetTokenValidation.ts'
import type {
    PasswordResetClientPhase,
    PasswordResetController,
    PasswordResetControllerOptions,
} from './Types/password-reset-controller.types.ts'

export function createPasswordResetController(
    options: PasswordResetControllerOptions,
): PasswordResetController {
    let token: string | null = null
    let phase: PasswordResetClientPhase = 'checking'
    let disposed = false
    let generation = 0
    let activeRequest: AbortController | null = null

    function setPhase(next: PasswordResetClientPhase) {
        phase = next
        if (!disposed) options.onPhaseChange(next)
    }

    function invalidate() {
        generation += 1
        token = null
        const request = activeRequest
        activeRequest = null
        request?.abort()
        options.clearInputs()
        setPhase('checking')
    }

    function reject(reason: 'missing' | 'invalid') {
        token = null
        options.clearInputs()
        setPhase(reason)
        options.onRejected(reason)
    }

    async function invoke<T>(
        operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const request = new AbortController()
        activeRequest = request
        let rejectCancellation: (() => void) | undefined
        const cancellation = new Promise<never>(function (
            _resolve,
            rejectPromise,
        ) {
            rejectCancellation = () =>
                rejectPromise(new Error('Password reset request interrupted'))
        })

        void cancellation.catch(function () {})
        const cancel = () => rejectCancellation?.()
        request.signal.addEventListener('abort', cancel, { once: true })
        const cancelTimeout = options.schedule(
            () => request.abort(),
            options.requestTimeoutMs,
        )
        try {
            return await Promise.race([cancellation, operation(request.signal)])
        } finally {
            cancelTimeout()
            request.signal.removeEventListener('abort', cancel)
            if (activeRequest === request) activeRequest = null
        }
    }

    async function validate() {
        if (disposed || !token || activeRequest) return
        const currentGeneration = generation
        const currentToken = token
        setPhase('checking')
        try {
            const result = await invoke((signal) =>
                options.validate(currentToken, signal),
            )
            if (disposed || generation !== currentGeneration) return
            if (!isPasswordResetTokenValidationValid(result)) {
                reject('invalid')
                return
            }
            setPhase('ready')
        } catch {
            if (disposed || generation !== currentGeneration) return
            options.clearInputs()
            setPhase('unavailable')
            options.onError('validation-unavailable')
        }
    }

    return {
        receiveToken(transfer) {
            if (disposed) return
            invalidate()
            if (transfer.status === 'inactive') return
            if (transfer.status !== 'captured') {
                reject(transfer.status)
                return
            }
            token = transfer.token
            void validate()
        },
        invalidate,
        retryValidation() {
            if (phase === 'unavailable') void validate()
        },
        async submit(values) {
            if (disposed || phase !== 'ready' || !token || activeRequest) return
            if (!authNewPasswordSchema.safeParse(values.password).success) {
                options.onError('password-policy')
                return
            }
            if (values.password !== values.confirmPassword) {
                options.onError('password-mismatch')
                return
            }
            const currentGeneration = generation
            const input = { token, password: values.password }
            options.clearInputs()
            setPhase('submitting')
            try {
                const result = await invoke((signal) =>
                    options.update(input, signal),
                )
                if (disposed || generation !== currentGeneration) return
                if (
                    typeof result !== 'object' ||
                    result === null ||
                    !('success' in result)
                )
                    throw new Error('Invalid password reset response')
                if (result.success === false) {
                    reject('invalid')
                    return
                }
                if (result.success !== true)
                    throw new Error('Invalid password reset response')
                token = null
                options.clearInputs()
                setPhase('complete')
                options.onSuccess()
            } catch {
                if (disposed || generation !== currentGeneration) return
                options.clearInputs()
                setPhase('ready')
                options.onError('update-unavailable')
            } finally {
                input.token = ''
                input.password = ''
            }
        },
        dispose() {
            if (disposed) return
            disposed = true
            invalidate()
        },
    }
}
