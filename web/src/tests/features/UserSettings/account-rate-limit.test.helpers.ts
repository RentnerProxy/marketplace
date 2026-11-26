import { vi } from 'bun:test'
import { mockValkeyDefineCommand } from '@/tests/shared/valkey-script.test.helpers.ts'
import {
    enforceRateLimit,
    RateLimitError,
} from '@/server/RateLimit/rateLimit.service.ts'
import type {
    AccountRateLimitTestCounter,
    AccountRateLimitTestOptions,
} from './account-rate-limit.test.types.ts'

const actualEnforceRateLimit = enforceRateLimit
const actualRateLimitError = RateLimitError

export function createAccountRateLimitTestHarness(onEnforce: () => void) {
    const state = {
        runRealLimiter: false,
        now: 0,
        clientIp: '203.0.113.10',
        counters: new Map<string, AccountRateLimitTestCounter>(),
    }
    async function evaluate(
        _script: string,
        _numberOfKeys: number,
        key: string,
        windowMs: string,
    ): Promise<[number, number]> {
        let counter = state.counters.get(key)
        if (!counter || counter.expiresAt <= state.now) {
            counter = { count: 0, expiresAt: state.now + Number(windowMs) }
            state.counters.set(key, counter)
        }
        counter.count += 1
        return [counter.count, counter.expiresAt - state.now]
    }
    const evalScript = vi.fn(evaluate)
    const connection = { defineCommand: mockValkeyDefineCommand(evalScript) }
    const getClientIp = vi.fn(() => state.clientIp)
    async function enforce(options: AccountRateLimitTestOptions) {
        onEnforce()
        if (state.runRealLimiter) await actualEnforceRateLimit(options)
    }
    const enforceSpy = vi.fn(enforce)

    function install() {
        vi.mock('@/lib/Request/clientRequestMeta.ts', () => ({ getClientIp }))
        vi.mock('@/server/Valkey/valkey.service.ts', () => ({
            getValkeyConnection: () => connection,
        }))
        vi.mock('@/server/RateLimit/rateLimit.service.ts', () => ({
            enforceRateLimit: enforceSpy,
            RateLimitError: actualRateLimitError,
        }))
    }
    function reset() {
        state.runRealLimiter = false
        state.now = 0
        state.clientIp = '203.0.113.10'
        state.counters.clear()
        enforceSpy.mockReset().mockImplementation(enforce)
        evalScript.mockReset().mockImplementation(evaluate)
        getClientIp.mockReset().mockImplementation(() => state.clientIp)
    }
    return {
        state,
        enforce: enforceSpy,
        evalScript,
        getClientIp,
        install,
        reset,
    }
}
