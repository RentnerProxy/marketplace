import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { createFirstSetupController } from '@/lib/Auth/FirstSuperUser/firstSetupController.ts'
import { FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS } from '@/config/security.config.ts'
import type {
    FirstSetupClientPhase,
    FirstSetupController,
    FirstSetupFormError,
} from '@/lib/Auth/FirstSuperUser/Types/first-setup-controller.types.ts'
import type { CreateFirstSuperUserAccountInput } from '@/features/Auth/FirstSuperUser/Types/first-super-user-server-input.types.ts'
import {
    createActivityTestClock,
    flushSessionActivityTasks,
} from '@/tests/layouts/AuthenticatedLayout/session-activity.test.helpers.ts'
import { createFirstSetupFormValues } from '@/tests/features/Auth/FirstSuperUser/first-setup.test.helpers.ts'

const fixtureToken = 'A'.repeat(43)
let clock = createActivityTestClock()
let phase: FirstSetupClientPhase = 'checking'
let controller: FirstSetupController
const mocks = {
    create: vi.fn(async function (
        _input: CreateFirstSuperUserAccountInput,
        _signal: AbortSignal,
    ): Promise<unknown> {
        return { success: true }
    }),
    clear: vi.fn(),
    invalidInput: vi.fn(function (_reason: FirstSetupFormError) {}),
    invalidToken: vi.fn(),
    error: vi.fn(function (_error: unknown) {}),
    complete: vi.fn(function (_outcome: 'created' | 'already-completed') {}),
}

beforeEach(function () {
    vi.clearAllMocks()
    clock = createActivityTestClock()
    phase = 'checking'
    mocks.create.mockResolvedValue({ success: true })
    controller = createFirstSetupController({
        create: mocks.create,
        onPhaseChange(next) {
            phase = next
        },
        clearPasswords: mocks.clear,
        onInvalidInput: mocks.invalidInput,
        onInvalidToken: mocks.invalidToken,
        onError: mocks.error,
        onComplete: mocks.complete,
        requestTimeoutMs: FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS,
        schedule: (callback, delay) => clock.schedule(callback, delay),
    })
})

afterEach(function () {
    controller.dispose()
    vi.restoreAllMocks()
})

function grant(token = fixtureToken) {
    controller.receiveToken({ status: 'captured', token })
}

describe('private first setup controller', function () {
    it('holds access outside public state until the direct request boundary', async function () {
        grant()
        expect(phase).toBe('granted')
        expect(JSON.stringify(controller).includes(fixtureToken)).toBe(false)
        let sentPrivateToken = false
        mocks.create.mockImplementation(async function (input, signal) {
            sentPrivateToken = input.setupToken === fixtureToken
            expect(signal.aborted).toBe(false)
            expect(input.password).toBe('abcd')
            return { success: true }
        })
        const submitted = {
            ...createFirstSetupFormValues(),
            setupToken: 'an-untrusted-extra-form-property',
        }
        await controller.submit(submitted)
        expect(sentPrivateToken).toBe(true)
        expect(phase).toBe('complete')
        expect(mocks.complete).toHaveBeenCalledWith('created')
        expect(mocks.create.mock.calls[0]?.[0].setupToken).toBe('')
        expect(mocks.create.mock.calls[0]?.[0].password).toBe('')
        expect(mocks.create.mock.calls[0]?.[0].confirmPassword).toBe('')
        expect(clock.pending.size).toBe(0)
        await controller.submit(createFirstSetupFormValues())
        expect(mocks.create).toHaveBeenCalledTimes(1)
    })

    it.each(['missing', 'invalid', 'inactive'] as const)(
        'does not submit without a captured token: %s',
        async function (status) {
            controller.receiveToken({ status })
            await controller.submit(createFirstSetupFormValues())
            expect(phase).toBe('missing')
            expect(mocks.create).not.toHaveBeenCalled()
            expect(mocks.invalidToken).not.toHaveBeenCalled()
        },
    )

    it.each([
        {
            changed: { password: 'ab', confirmPassword: 'ab' },
            reason: 'password-policy',
        },
        {
            changed: { confirmPassword: 'different' },
            reason: 'password-mismatch',
        },
        { changed: { email: 'invalid' }, reason: 'email' },
        { changed: { username: '' }, reason: 'username' },
    ] as const)(
        'preserves form validation error $reason',
        async function ({ changed, reason }) {
            grant()
            await controller.submit({
                ...createFirstSetupFormValues(),
                ...changed,
            })
            expect(mocks.invalidInput).toHaveBeenCalledWith(reason)
            expect(mocks.create).not.toHaveBeenCalled()
            expect(phase).toBe('granted')
        },
    )

    it('keeps only one request in flight', async function () {
        grant()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementation(() => pending.promise)
        const first = controller.submit(createFirstSetupFormValues())
        await controller.submit(createFirstSetupFormValues())
        expect(mocks.create).toHaveBeenCalledTimes(1)
        expect(phase).toBe('submitting')
        pending.resolve({ success: true })
        await first
        expect(mocks.complete).toHaveBeenCalledTimes(1)
    })

    it('discards access after a server rejection and preserves its message path', async function () {
        grant()
        mocks.create.mockResolvedValue({
            success: false,
            errorCode: 'invalid_setup_token',
        })
        await controller.submit(createFirstSetupFormValues())
        expect(phase).toBe('missing')
        expect(mocks.invalidToken).toHaveBeenCalledTimes(1)
        expect(mocks.complete).not.toHaveBeenCalled()
        await controller.submit(createFirstSetupFormValues())
        expect(mocks.create).toHaveBeenCalledTimes(1)
    })

    it('distinguishes an already completed installation', async function () {
        grant()
        mocks.create.mockResolvedValue({
            success: false,
            errorCode: 'setup_already_completed',
        })
        await controller.submit(createFirstSetupFormValues())
        expect(phase).toBe('complete')
        expect(mocks.complete).toHaveBeenCalledWith('already-completed')
        expect(mocks.invalidToken).not.toHaveBeenCalled()
    })

    it.each([
        null,
        {},
        { success: 'true' },
        { success: false },
        { success: false, errorCode: 'unknown' },
    ])(
        'rejects malformed response case %# without navigating',
        async function (response) {
            grant()
            mocks.create.mockResolvedValue(response)
            await controller.submit(createFirstSetupFormValues())
            expect(phase).toBe('granted')
            expect(mocks.error).toHaveBeenCalledTimes(1)
            expect(mocks.complete).not.toHaveBeenCalled()
            expect(mocks.create.mock.calls[0]?.[0].setupToken).toBe('')
        },
    )

    it.each(['throw', 'reject'] as const)(
        'keeps retry access after a request %s and erases the completed request copy',
        async function (failure) {
            grant()
            const error = new Error('synthetic setup error')
            mocks.create.mockImplementationOnce(function () {
                if (failure === 'throw') throw error
                return Promise.reject(error)
            })
            await controller.submit(createFirstSetupFormValues())
            expect(phase).toBe('granted')
            expect(mocks.error).toHaveBeenCalledWith(error)
            expect(mocks.create.mock.calls[0]?.[0].setupToken).toBe('')
            await controller.submit(createFirstSetupFormValues())
            expect(mocks.complete).toHaveBeenCalledTimes(1)
        },
    )

    it('bounds an adapter that ignores abort and ignores its late success', async function () {
        grant()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementationOnce(() => pending.promise)
        const result = controller.submit(createFirstSetupFormValues())
        const signal = mocks.create.mock.calls[0]?.[1]
        expect(clock.pending.size).toBe(1)
        clock.advance(FIRST_SUPERUSER_SETUP_REQUEST_TIMEOUT_MS)
        await result
        expect(signal?.aborted).toBe(true)
        expect(phase).toBe('granted')
        expect(clock.pending.size).toBe(0)
        expect(mocks.error).toHaveBeenCalledTimes(1)
        expect(mocks.create.mock.calls[0]?.[0].setupToken).toBe('')
        pending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(mocks.complete).not.toHaveBeenCalled()
        await controller.submit(createFirstSetupFormValues())
        expect(mocks.complete).toHaveBeenCalledTimes(1)
    })

    it('aborts on disposal, erases the request immediately and never notifies afterward', async function () {
        grant()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementation(() => pending.promise)
        const result = controller.submit(createFirstSetupFormValues())
        controller.dispose()
        expect(mocks.create.mock.calls[0]?.[1].aborted).toBe(true)
        expect(mocks.create.mock.calls[0]?.[0].setupToken).toBe('')
        expect(mocks.create.mock.calls[0]?.[0].password).toBe('')
        await result
        pending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(mocks.complete).not.toHaveBeenCalled()
        expect(mocks.error).not.toHaveBeenCalled()
        expect(clock.pending.size).toBe(0)
        controller.receiveToken({ status: 'captured', token: 'B'.repeat(43) })
        await controller.submit(createFirstSetupFormValues())
        expect(mocks.create).toHaveBeenCalledTimes(1)
    })

    it('does not let old cleanup erase a new request after token replacement', async function () {
        grant()
        const oldPending = Promise.withResolvers<unknown>()
        const newPending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementationOnce(() => oldPending.promise)
        mocks.create.mockImplementationOnce(() => newPending.promise)
        const oldResult = controller.submit(createFirstSetupFormValues())
        const nextToken = 'B'.repeat(43)
        controller.receiveToken({ status: 'captured', token: nextToken })
        const newResult = controller.submit(createFirstSetupFormValues())
        await oldResult
        expect(mocks.create.mock.calls[0]?.[1].aborted).toBe(true)
        expect(mocks.create.mock.calls[1]?.[0].setupToken === nextToken).toBe(
            true,
        )
        expect(mocks.create.mock.calls[1]?.[1].aborted).toBe(false)
        expect(phase).toBe('submitting')
        oldPending.resolve({ success: true })
        await flushSessionActivityTasks()
        expect(mocks.complete).not.toHaveBeenCalled()
        newPending.resolve({ success: true })
        await newResult
        expect(mocks.complete).toHaveBeenCalledTimes(1)
        expect(mocks.create.mock.calls[1]?.[0].setupToken).toBe('')
        expect(clock.pending.size).toBe(0)
    })

    it('invalidates a resolved old response before its continuation runs', async function () {
        grant()
        const pending = Promise.withResolvers<unknown>()
        mocks.create.mockImplementationOnce(() => pending.promise)
        const result = controller.submit(createFirstSetupFormValues())
        pending.resolve({ success: true })
        controller.receiveToken({ status: 'captured', token: 'B'.repeat(43) })
        await result
        expect(phase).toBe('granted')
        expect(mocks.complete).not.toHaveBeenCalled()
        expect(mocks.error).not.toHaveBeenCalled()
    })
})
