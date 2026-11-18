import { fileURLToPath } from 'node:url'
import { runTooling } from '../native-tools.ts'

export async function bunAuditArguments(root: URL) {
    const path = fileURLToPath(root)
    const source = await runTooling<string>('security-bun-lock', { root: path })
    const lock: unknown = Bun.JSONC.parse(source)
    return runTooling<string[]>('security-picomatch-audit', {
        root: path,
        lock,
    })
}

if (import.meta.main) {
    const root = new URL('../../../', import.meta.url)
    const args = await bunAuditArguments(root)
    const exception = args.find((argument) => argument.startsWith('--ignore='))
    if (exception) {
        console.log(
            'Verified the local picomatch patch for ' +
                exception.slice('--ignore='.length) +
                '.',
        )
    }
    const audit = Bun.spawn([process.execPath, ...args], {
        cwd: fileURLToPath(root),
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
        windowsHide: true,
    })
    process.exitCode = await audit.exited
}
