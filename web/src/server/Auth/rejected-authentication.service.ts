import { REJECTED_AUTHENTICATION_LIMITS } from '@/config/security.config.ts'
import {
    REJECTED_AUTHENTICATION_FLOWS,
    REJECTED_AUTHENTICATION_REASONS,
    rejectedAuthenticationFlowSchema,
    rejectedAuthenticationReasonSchema,
} from '@/lib/Auth/rejectedAuthentication.ts'
import { logWarn } from '@/server/Logging/logger.ts'
import type {
    RejectedAuthenticationFlow,
    RejectedAuthenticationReason,
    RejectedAuthenticationWindow,
} from './Types/rejected-authentication.types.ts'

const windows = new Map(
    REJECTED_AUTHENTICATION_FLOWS.map((flow) => [
        flow,
        new Map<RejectedAuthenticationReason, RejectedAuthenticationWindow>(
            REJECTED_AUTHENTICATION_REASONS.map((reason) => [
                reason,
                {
                    endsAt: null,
                    additionalCount: 0,
                    timer: null,
                } satisfies RejectedAuthenticationWindow,
            ]),
        ),
    ]),
)

function isFlow(value: unknown): value is RejectedAuthenticationFlow {
    return rejectedAuthenticationFlowSchema.safeParse(value).success
}

function isReason(value: unknown): value is RejectedAuthenticationReason {
    return rejectedAuthenticationReasonSchema.safeParse(value).success
}

function monotonicNow(): number | null {
    const now = performance.now()
    return Number.isFinite(now) &&
        now >= 0 &&
        now <= Number.MAX_SAFE_INTEGER - REJECTED_AUTHENTICATION_LIMITS.windowMs
        ? now
        : null
}

function writeRejection(
    flow: RejectedAuthenticationFlow,
    reason: RejectedAuthenticationReason,
    count: number,
): void {
    if (count === 0) return
    try {
        const output = process.stdout
        if (
            output.writableNeedDrain ||
            output.destroyed ||
            output.writableEnded
        ) {
            return
        }
        logWarn('auth.authentication.rejected', {
            authenticationFlow: flow,
            authenticationReason: reason,
            count,
        })
    } catch {}
}

function scheduleWindowEnd(
    window: RejectedAuthenticationWindow,
    flow: RejectedAuthenticationFlow,
    reason: RejectedAuthenticationReason,
    now: number,
): void {
    if (window.timer !== null || window.endsAt === null) return

    const token = Symbol()
    window.timer = token
    try {
        const timer = setTimeout(
            () => {
                if (window.timer !== token) return
                window.timer = null
                try {
                    const firedAt = monotonicNow()
                    if (firedAt === null || window.endsAt === null) return
                    if (firedAt < window.endsAt) {
                        scheduleWindowEnd(window, flow, reason, firedAt)
                        return
                    }
                    const count = window.additionalCount
                    window.endsAt = null
                    window.additionalCount = 0
                    writeRejection(flow, reason, count)
                } catch {}
            },
            Math.max(1, Math.ceil(window.endsAt - now)),
        )

        try {
            if (typeof timer?.unref !== 'function') {
                throw new TypeError()
            }
            timer.unref()
        } catch {
            try {
                clearTimeout(timer)
                if (window.timer === token) window.timer = null
            } catch {}
        }
    } catch {
        if (window.timer === token) window.timer = null
    }
}

export function recordRejectedAuthenticationService(
    flow: RejectedAuthenticationFlow,
    reason: RejectedAuthenticationReason,
): void {
    try {
        if (!isFlow(flow) || !isReason(reason)) return
        const window = windows.get(flow)?.get(reason)
        if (!window) return

        const now = monotonicNow()
        if (now === null) return

        if (window.endsAt !== null && now < window.endsAt) {
            if (
                window.additionalCount <
                REJECTED_AUTHENTICATION_LIMITS.maximumCount
            ) {
                window.additionalCount += 1
            }
            return
        }

        const previousCount = window.additionalCount
        window.endsAt = now + REJECTED_AUTHENTICATION_LIMITS.windowMs
        window.additionalCount = 0

        scheduleWindowEnd(window, flow, reason, now)
        writeRejection(flow, reason, previousCount)
        writeRejection(flow, reason, 1)
    } catch {}
}
