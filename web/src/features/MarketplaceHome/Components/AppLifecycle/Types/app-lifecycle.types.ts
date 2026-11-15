export type AppLifecycleId =
    'template' | 'develop' | 'submit' | 'review' | 'publish' | 'install'
export type AppLifecycleConnectionKind = 'development' | 'review' | 'release'

export type AppLifecycleStep = {
    id: AppLifecycleId
    number: string
    role: 'developer' | 'reviewer' | 'marketplace' | 'platform'
    position: string
}

export type AppLifecycleConnection = {
    id: string
    from: AppLifecycleId
    to: AppLifecycleId
    path: string
    kind: AppLifecycleConnectionKind
    feedback?: boolean
}

export type AppLifecycleLogicReturn = {
    state: {
        steps: readonly AppLifecycleStep[]
        connections: readonly AppLifecycleConnection[]
        activeStep: AppLifecycleStep
        total: number
    }
    handler: {
        handleSelectStep: (step: AppLifecycleId) => void
    }
}
