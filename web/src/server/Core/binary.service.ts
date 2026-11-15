import { access } from 'node:fs/promises'
import path from 'node:path'
import { CORE_RUNTIME } from '@/config/core.config.ts'
import type { CoreBinary } from './Types/core.types.ts'
import { CoreCommandError } from './error.ts'

function getCoreBinaryDirectories() {
    const configured = process.env.CORE_BINARY_DIR?.trim()
    if (configured) return [path.resolve(configured)]
    if (process.env.NODE_ENV === 'production') return ['/usr/local/bin']
    return [
        path.resolve('core/target/debug'),
        path.resolve('core/target/release'),
    ]
}

export async function getCoreBinaryPathService(binary: CoreBinary) {
    const name =
        CORE_RUNTIME.binaries[binary] +
        (process.platform === 'win32' ? '.exe' : '')
    const directories = getCoreBinaryDirectories()
    const executables = await Promise.all(
        directories.map(async (directory) => {
            const executable = path.join(directory, name)
            try {
                await access(executable)
                return executable
            } catch {
                return undefined
            }
        }),
    )
    const executable = executables.find((value) => value !== undefined)
    if (executable) return executable
    throw new CoreCommandError(
        'CORE_UNAVAILABLE',
        'Der Rust-Core ist nicht verfügbar. Bitte zuerst den Core bauen.',
    )
}
