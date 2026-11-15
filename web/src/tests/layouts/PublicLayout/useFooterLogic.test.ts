import { beforeEach, expect, it, vi } from 'bun:test'
import { PROJECT_CONFIG } from '@/config/app.config.ts'
import { hookReact, renderHook, resetHooks } from '../hook-harness.ts'

vi.mock('react', () => hookReact)
const { default: useFooter } =
    await import('@/layouts/PublicLayout/Hooks/useFooterLogic.ts')
beforeEach(resetHooks)

it('keeps the version and current year beside the project name', () => {
    const { state } = renderHook(useFooter)
    expect(state.currentYear).toBe(new Date().getFullYear())
    expect(state.companyName).toBe(PROJECT_CONFIG.defaultName)
    expect(state.appVersion.length).toBeGreaterThan(0)
})
