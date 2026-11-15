import type {
    AppLifecycleConnection,
    AppLifecycleStep,
} from './Types/app-lifecycle.types.ts'

export const APP_LIFECYCLE_STEPS = [
    {
        id: 'template',
        number: '01',
        role: 'developer',
        position: 'lg:left-0 lg:top-12',
    },
    {
        id: 'develop',
        number: '02',
        role: 'developer',
        position: 'lg:left-[38%] lg:top-12',
    },
    {
        id: 'submit',
        number: '03',
        role: 'developer',
        position: 'lg:left-[76%] lg:top-12',
    },
    {
        id: 'review',
        number: '04',
        role: 'reviewer',
        position: 'lg:left-[76%] lg:top-[264px]',
    },
    {
        id: 'publish',
        number: '05',
        role: 'marketplace',
        position: 'lg:left-[38%] lg:top-[264px]',
    },
    {
        id: 'install',
        number: '06',
        role: 'platform',
        position: 'lg:left-0 lg:top-[264px]',
    },
] as const satisfies readonly AppLifecycleStep[]

export const APP_LIFECYCLE_CONNECTIONS = [
    {
        id: 'template-develop',
        from: 'template',
        to: 'develop',
        path: 'M250 112H370',
        kind: 'development',
    },
    {
        id: 'develop-submit',
        from: 'develop',
        to: 'submit',
        path: 'M630 112H750',
        kind: 'development',
    },
    {
        id: 'submit-review',
        from: 'submit',
        to: 'review',
        path: 'M880 184V254',
        kind: 'review',
    },
    {
        id: 'review-publish',
        from: 'review',
        to: 'publish',
        path: 'M750 328H630',
        kind: 'release',
    },
    {
        id: 'publish-install',
        from: 'publish',
        to: 'install',
        path: 'M370 328H250',
        kind: 'release',
    },
    {
        id: 'review-develop',
        from: 'review',
        to: 'develop',
        path: 'M868 264V232Q868 220 856 220H512Q500 220 500 208V184',
        kind: 'review',
        feedback: true,
    },
] as const satisfies readonly AppLifecycleConnection[]
