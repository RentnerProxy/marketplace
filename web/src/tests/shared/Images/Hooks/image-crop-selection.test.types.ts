import type { EffectCallback } from 'react'

export type ImageSelectionTestEffect = {
    setup: EffectCallback
    dependencies?: ReadonlyArray<unknown>
    cleanup?: () => void
    pending: boolean
}
