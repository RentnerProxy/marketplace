import { chmod, cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import manifest from './manifest.json'

const {
    APP_PACKAGE_DIR: directory,
    APP_TARGET: target,
    APP_SOURCE_REPOSITORY_ID: repositoryId,
    APP_SOURCE_COMMIT: commit,
} = process.env

if (!directory || !target || !repositoryId || !commit) {
    throw new Error('Missing candidate build context')
}

await mkdir(join(directory, 'bin'), { recursive: true })
const executable = join(directory, 'bin/app')
await Bun.$`bun --no-env-file build --compile ./app.ts --outfile ${executable}`
await chmod(executable, 0o755)
await Promise.all([
    ...['api', 'ui', 'schemas', 'migrations', 'LICENSE'].map((path) =>
        cp(path, join(directory, path), { recursive: true }),
    ),
    Bun.write(
        join(directory, 'app.json'),
        JSON.stringify({
            ...manifest,
            target,
            source: { repositoryId, commit },
        }) + '\n',
    ),
])
