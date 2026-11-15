export type EnumerationProtectionDependencies = {
    now?: () => number
    wait?: (delayMs: number) => Promise<void>
}
