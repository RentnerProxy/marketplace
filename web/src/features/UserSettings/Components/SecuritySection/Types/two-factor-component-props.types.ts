import type useTwoFactorLogic from '../Hooks/useTwoFactorLogic.ts'

type TwoFactorLogic = ReturnType<typeof useTwoFactorLogic>

export type TwoFactorSetupPanelProps = {
    state: TwoFactorLogic['state']
    handler: TwoFactorLogic['handler']
}
