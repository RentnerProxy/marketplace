export function getCoreCommandEnvironmentService(
    environment?: Record<string, string>,
) {
    const inherited: Record<string, string> = {}
    for (const key of [
        'PATH',
        'Path',
        'SystemRoot',
        'WINDIR',
        'TEMP',
        'TMP',
        'LANG',
        'LC_ALL',
        'USERPROFILE',
    ]) {
        const value = process.env[key]
        if (value !== undefined) inherited[key] = value
    }
    return { ...inherited, ...environment }
}
