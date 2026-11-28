import { vi } from 'bun:test'
import { sessionConfig } from '@/config/session.config.ts'
import { createSessionActivityController } from '@/lib/Auth/Session/sessionActivity.ts'
import type {
    SessionActivityController,
    SessionActivitySnapshot,
    SessionActivityTouchResult,
} from '@/lib/Auth/Session/Types/session-activity.types.ts'
import type { AuthenticatedSessionQueryData } from '@/lib/Auth/Types/authenticated-session.types.ts'
import type {
    ActivityTestRegistration,
    ScheduledActivityTestTask,
    SessionActivityHarnessOptions,
} from './session-activity.test.types.ts'

export const SESSION_ACTIVITY_TEST_NOW = Date.UTC(2026, 8, 6, 12)

export async function flushSessionActivityTasks(): Promise<void> {
    for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve()
    }
}

export function createActivityTestClock() {
    let wall = SESSION_ACTIVITY_TEST_NOW
    let monotonic = 0
    let nextId = 0
    const pending = new Map<number, ScheduledActivityTestTask>()

    return {
        wallNow: () => wall,
        monotonicNow: () => monotonic,
        pending,
        schedule(callback: () => void, delay: number) {
            const id = ++nextId
            pending.set(id, { callback, due: monotonic + Math.max(0, delay) })
            return () => pending.delete(id)
        },
        jumpWall(delta: number) {
            wall += delta
        },
        async advance(delay: number) {
            const target = monotonic + delay
            let callbacks = 0
            while (true) {
                const next = [...pending.entries()]
                    .filter(([, entry]) => entry.due <= target)
                    .toSorted((left, right) => left[1].due - right[1].due)[0]
                if (!next) break
                if (++callbacks > 1000)
                    throw new Error('Unbounded activity timer loop')
                const delta = next[1].due - monotonic
                monotonic = next[1].due
                wall += delta
                pending.delete(next[0])
                next[1].callback()

                await flushSessionActivityTasks()
            }
            wall += target - monotonic
            monotonic = target
            await flushSessionActivityTasks()
        },
    }
}

export class ActivityTestTarget extends EventTarget {
    visibilityState = 'visible'
    readonly registrations: Array<ActivityTestRegistration> = []
    private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
    >()

    override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
    ): void {
        super.addEventListener(type, listener, options)
        this.registrations.push({ type, options })
        if (!listener) return
        let listeners = this.listeners.get(type)
        if (!listeners) {
            listeners = new Set()
            this.listeners.set(type, listeners)
        }
        listeners.add(listener)
    }

    override removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
    ): void {
        super.removeEventListener(type, listener, options)
        if (listener) this.listeners.get(type)?.delete(listener)
    }

    get activeListenerCount(): number {
        return [...this.listeners.values()].reduce(
            (count, listeners) => count + listeners.size,
            0,
        )
    }

    emit(type: string, trusted = true): void {
        const event = new Event(type)
        if (!trusted) {
            this.dispatchEvent(event)
            return
        }

        const trustedEvent = new Proxy(event, {
            get(target, key) {
                return key === 'isTrusted'
                    ? true
                    : Reflect.get(target, key, target)
            },
        })
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function')
                listener.call(this, trustedEvent)
            else listener.handleEvent(trustedEvent)
        }
    }
}

export function createActivityTestSession(
    overrides: Partial<AuthenticatedSessionQueryData> = {},
): AuthenticatedSessionQueryData {
    return {
        expiresAt: new Date(
            SESSION_ACTIVITY_TEST_NOW + sessionConfig.idleDurationMs,
        ).toISOString(),
        absoluteExpiresAt: new Date(
            SESSION_ACTIVITY_TEST_NOW + sessionConfig.absoluteDurationMs,
        ).toISOString(),
        user: {
            id: 'activity-user',
            username: 'activity-user',
            customBackgroundDarkness: null,
            customBackgroundUpdatedAt: null,
            bio: null,
            primaryColor: null,
            themeMode: null,
            fontFamily: null,
            fontSize: null,
            profileImageVersion: null,
        },
        permissions: ['profile.read'],
        ...overrides,
    }
}

export function createSessionActivityHarness(
    options: SessionActivityHarnessOptions = {},
) {
    const clock = createActivityTestClock()
    const target = new ActivityTestTarget()
    let revision = 0
    let session: AuthenticatedSessionQueryData | undefined =
        options.session ?? createActivityTestSession()
    let controller: SessionActivityController | undefined
    const readSession = vi.fn(
        options.readSession ??
            async function () {
                return createActivityTestSession({
                    expiresAt: new Date(
                        clock.wallNow() + sessionConfig.idleDurationMs,
                    ).toISOString(),
                })
            },
    )
    const touchSession = vi.fn(
        options.touchSession ??
            async function (): Promise<SessionActivityTouchResult> {
                return {
                    active: true,
                    expiresAt: new Date(
                        clock.wallNow() + sessionConfig.idleDurationMs,
                    ).toISOString(),
                }
            },
    )
    const onInactive = vi.fn()
    const commitSession = vi.fn(function (
        expected: SessionActivitySnapshot,
        value: AuthenticatedSessionQueryData,
    ) {
        if (revision !== expected.revision || session !== expected.session)
            return false
        session = value
        revision += 1
        controller?.refresh()
        return true
    })
    controller = createSessionActivityController({
        target,
        isVisible: () => target.visibilityState === 'visible',
        getSnapshot: () => ({ revision, session }),
        touchSession,
        readSession,
        commitSession,
        onInactive,
        wallNow: clock.wallNow,
        monotonicNow: clock.monotonicNow,
        schedule: clock.schedule,
        ...sessionConfig,
    })
    return {
        clock,
        target,
        controller,
        touchSession,
        readSession,
        commitSession,
        onInactive,
        getSession: () => session,
        setSession(value: AuthenticatedSessionQueryData | undefined) {
            session = value
            revision += 1
            controller?.refresh()
        },
    }
}
