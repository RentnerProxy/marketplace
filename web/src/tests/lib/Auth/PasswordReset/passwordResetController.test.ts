import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { passwordResetConfig } from '@/config/session.config.ts'
import { createPasswordResetController } from '@/lib/Auth/PasswordReset/passwordResetController.ts'
import type { PasswordResetControllerOptions } from '@/lib/Auth/PasswordReset/Types/password-reset-controller.types.ts'
import {
    createActivityTestClock,
    flushSessionActivityTasks,
} from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'

let clock = createActivityTestClock()
const mocks = {
    validate: vi.fn(async function (
        _token: string,
        _signal: AbortSignal,
    ): Promise<unknown> {
        return { valid: true }
    }),
    update: vi.fn(async function (
        _input: { token: string; password: string },
        _signal: AbortSignal,
    ): Promise<unknown> {
        return { success: true }
    }),
    phase: vi.fn(),
    clear: vi.fn(),
    error: vi.fn(),
    rejected: vi.fn(),
    success: vi.fn(),
}
let controller: ReturnType<typeof createPasswordResetController>

beforeEach(function () {
    vi.clearAllMocks()
    clock = createActivityTestClock()
    mocks.validate.mockResolvedValue({ valid: true })
    mocks.update.mockResolvedValue({ success: true })
    const options: PasswordResetControllerOptions = {
        validate: mocks.validate,
        update: mocks.update,
        onPhaseChange: mocks.phase,
        clearInputs: mocks.clear,
        onError: mocks.error,
        onRejected: mocks.rejected,
        onSuccess: mocks.success,
        requestTimeoutMs: passwordResetConfig.requestTimeoutMs,
        schedule: clock.schedule,
    }
    controller = createPasswordResetController(options)
})
afterEach(function () {
    controller.dispose()
})

async function activate(token = 'synthetic-reset-proof') {
    controller.receiveToken({ status: 'captured', token })
    await flushSessionActivityTasks()
}

describe('Bounded local password reset controller', function () {
    it('does not validate or submit until a client token has been transferred', async function () {
        await controller.submit({ password: 'aaaa', confirmPassword: 'aaaa' })
        expect(mocks.validate).not.toHaveBeenCalled()
        expect(mocks.update).not.toHaveBeenCalled()
    })
    it.each(['missing', 'invalid'] as const)(
        'keeps the existing %s redirect notice and clears drafts',
        function (status) {
            controller.receiveToken({ status })
            expect(mocks.rejected).toHaveBeenCalledWith(status)
            expect(mocks.clear).toHaveBeenCalled()
            expect(mocks.validate).not.toHaveBeenCalled()
        },
    )
    it.each([{ valid: false }, [], null, { valid: false, length: 1 }])(
        'rejects a server-invalid token %# before showing a form',
        async function (result) {
            mocks.validate.mockResolvedValue(result)
            await activate()
            expect(mocks.rejected).toHaveBeenCalledWith('invalid')
            expect(mocks.phase).not.toHaveBeenCalledWith('ready')
            await controller.submit({
                password: 'aaaa',
                confirmPassword: 'aaaa',
            })
            expect(mocks.update).not.toHaveBeenCalled()
        },
    )
    it.each(['', 'a', 'aa', 'aaa', 'x'.repeat(1025)])(
        'preserves the password length guard %#',
        async function (password) {
            await activate()
            await controller.submit({ password, confirmPassword: password })
            expect(mocks.error).toHaveBeenCalledWith('password-policy')
            expect(mocks.update).not.toHaveBeenCalled()
        },
    )
    it('rejects a mismatch without consuming the token', async function () {
        await activate()
        await controller.submit({ password: 'aaaa', confirmPassword: 'aaab' })
        expect(mocks.error).toHaveBeenCalledWith('password-mismatch')
        expect(mocks.update).not.toHaveBeenCalled()
    })
    it.each(['aaaa', 'x'.repeat(1024)])(
        'accepts the existing password boundary %# and cannot submit the consumed local token again',
        async function (password) {
            const sent: Array<{ token: string; password: string }> = []
            mocks.update.mockImplementation(async function (input) {
                sent.push({ ...input })
                return { success: true }
            })
            await activate()
            await controller.submit({ password, confirmPassword: password })
            expect(sent).toEqual([{ token: 'synthetic-reset-proof', password }])
            expect(mocks.success).toHaveBeenCalledTimes(1)
            expect(mocks.phase).toHaveBeenLastCalledWith('complete')
            await controller.submit({ password, confirmPassword: password })
            expect(mocks.update).toHaveBeenCalledTimes(1)
            expect(clock.pending.size).toBe(0)
        },
    )
    it('allows no parallel submits and clears the forwarded secret object after settlement', async function () {
        const pending = Promise.withResolvers<unknown>()
        mocks.update.mockImplementation(() => pending.promise)
        await activate()
        const operation = controller.submit({
            password: 'aaaa',
            confirmPassword: 'aaaa',
        })
        const passedInput = mocks.update.mock.calls[0]?.[0]
        expect(passedInput).toEqual({
            token: 'synthetic-reset-proof',
            password: 'aaaa',
        })
        await controller.submit({ password: 'bbbb', confirmPassword: 'bbbb' })
        expect(mocks.update).toHaveBeenCalledTimes(1)
        pending.resolve({ success: true })
        await operation
        expect(passedInput).toEqual({ token: '', password: '' })
    })
    it('clears an expired or already consumed token rejected during submission', async function () {
        mocks.update.mockResolvedValue({
            success: false,
            error: 'synthetic invalid token',
        })
        await activate()
        await controller.submit({ password: 'aaaa', confirmPassword: 'aaaa' })
        expect(mocks.rejected).toHaveBeenCalledWith('invalid')
        expect(mocks.success).not.toHaveBeenCalled()
        await controller.submit({ password: 'aaaa', confirmPassword: 'aaaa' })
        expect(mocks.update).toHaveBeenCalledTimes(1)
    })
    it('times out an abort-ignoring validation once and only retries after a manual request', async function () {
        const pending = Promise.withResolvers<unknown>()
        mocks.validate.mockImplementationOnce(() => pending.promise)
        await activate()
        const signal = mocks.validate.mock.calls[0]?.[1]
        for (let count = 0; count < 10; count += 1) controller.retryValidation()
        await clock.advance(passwordResetConfig.requestTimeoutMs)
        expect(signal?.aborted).toBe(true)
        expect(mocks.error).toHaveBeenCalledWith('validation-unavailable')
        expect(mocks.validate).toHaveBeenCalledTimes(1)
        expect(clock.pending.size).toBe(0)
        await clock.advance(passwordResetConfig.requestTimeoutMs * 10)
        expect(mocks.validate).toHaveBeenCalledTimes(1)
        controller.retryValidation()
        await flushSessionActivityTasks()
        expect(mocks.validate).toHaveBeenCalledTimes(2)
        expect(mocks.phase).toHaveBeenLastCalledWith('ready')
        pending.resolve({ valid: false })
        await flushSessionActivityTasks()
        expect(mocks.rejected).not.toHaveBeenCalled()
    })
    it('keeps a network failure distinct from an invalid link and never reflects raw errors', async function () {
        mocks.validate.mockRejectedValue(
            new Error('synthetic-secret-that-must-not-be-shown'),
        )
        await activate()
        expect(mocks.error.mock.calls).toEqual([['validation-unavailable']])
        expect(mocks.rejected).not.toHaveBeenCalled()
    })
    it('bounds an abort-ignoring submit and does not accept its late success', async function () {
        const pending = Promise.withResolvers<unknown>()
        mocks.update.mockImplementation(() => pending.promise)
        await activate()
        const operation = controller.submit({
            password: 'aaaa',
            confirmPassword: 'aaaa',
        })
        await clock.advance(passwordResetConfig.requestTimeoutMs)
        await operation
        expect(mocks.update.mock.calls[0]?.[1].aborted).toBe(true)
        expect(mocks.update.mock.calls[0]?.[0]).toEqual({
            token: '',
            password: '',
        })
        expect(mocks.error).toHaveBeenCalledWith('update-unavailable')
        expect(mocks.phase).toHaveBeenLastCalledWith('ready')
        pending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(mocks.success).not.toHaveBeenCalled()
    })
    it.each(['validation', 'submission'] as const)(
        'ignores an old %s completion after a newer token arrived',
        async function (stage) {
            const pending = Promise.withResolvers<unknown>()
            if (stage === 'validation')
                mocks.validate.mockImplementationOnce(() => pending.promise)
            else mocks.update.mockImplementationOnce(() => pending.promise)
            await activate('synthetic-first')
            const operation =
                stage === 'submission'
                    ? controller.submit({
                          password: 'aaaa',
                          confirmPassword: 'aaaa',
                      })
                    : Promise.resolve()
            await activate('synthetic-second')
            await operation
            expect(mocks.phase).toHaveBeenLastCalledWith('ready')
            pending.resolve(
                stage === 'validation' ? { valid: false } : { success: true },
            )
            await flushSessionActivityTasks()
            expect(mocks.rejected).not.toHaveBeenCalled()
            expect(mocks.success).not.toHaveBeenCalled()
            expect(mocks.phase).toHaveBeenLastCalledWith('ready')
            const sent: Array<string> = []
            mocks.update.mockImplementation(async function (input) {
                sent.push(input.token)
                return { success: true }
            })
            await controller.submit({
                password: 'bbbb',
                confirmPassword: 'bbbb',
            })
            expect(sent).toEqual(['synthetic-second'])
        },
    )
    it.each(['validation', 'submission'] as const)(
        'aborts %s and clears drafts on unmount without later navigation',
        async function (stage) {
            const pending = Promise.withResolvers<unknown>()
            if (stage === 'validation')
                mocks.validate.mockImplementation(() => pending.promise)
            else mocks.update.mockImplementation(() => pending.promise)
            await activate()
            const operation =
                stage === 'submission'
                    ? controller.submit({
                          password: 'aaaa',
                          confirmPassword: 'aaaa',
                      })
                    : Promise.resolve()
            const signal =
                stage === 'validation'
                    ? mocks.validate.mock.calls[0]?.[1]
                    : mocks.update.mock.calls[0]?.[1]
            controller.dispose()
            const stateCalls = mocks.phase.mock.calls.length
            await operation
            pending.resolve(
                stage === 'validation' ? { valid: false } : { success: true },
            )
            await flushSessionActivityTasks()
            expect(signal?.aborted).toBe(true)
            expect(mocks.clear).toHaveBeenCalled()
            expect(mocks.phase.mock.calls).toHaveLength(stateCalls)
            expect(mocks.rejected).not.toHaveBeenCalled()
            expect(mocks.success).not.toHaveBeenCalled()
            expect(clock.pending.size).toBe(0)
        },
    )
})
