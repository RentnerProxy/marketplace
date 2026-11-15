import { beforeEach, expect, it, vi } from 'bun:test'
import {
    hookReact,
    renderHook,
    resetHooks,
} from '@/tests/layouts/hook-harness.ts'

vi.mock('react', () => hookReact)
const { default: useAppLifecycleLogic } =
    await import('@/features/MarketplaceHome/Components/AppLifecycle/Hooks/useAppLifecycleLogic.ts')
beforeEach(resetHooks)

function renderLifecycle() {
    return renderHook(useAppLifecycleLogic)
}

it('starts at the template and presents the selected review or installation details', () => {
    expect(renderLifecycle().state.activeStep.id).toBe('template')
    renderLifecycle().handler.handleSelectStep('review')
    expect(renderLifecycle().state.activeStep.id).toBe('review')
    expect(renderLifecycle().state.activeStep.role).toBe('reviewer')
    renderLifecycle().handler.handleSelectStep('install')
    expect(renderLifecycle().state.activeStep.id).toBe('install')
    expect(renderLifecycle().state.activeStep.role).toBe('platform')
})
