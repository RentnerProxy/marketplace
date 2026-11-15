/* eslint-disable no-await-in-loop -- Validate ancestors before descendants and apply the reviewed files sequentially. */
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
    MANAGED_PROJECT_FILES,
    renderProjectIdentityFile,
} from './static-identity.ts'
import { validateProjectIdentity } from './identity-validation.ts'

async function assertManagedFile(root: string, file: string) {
    const rootEntry = await lstat(root)
    if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
        throw new Error('Projektwurzel muss ein regulärer Repositorypfad sein.')
    }
    if (!(MANAGED_PROJECT_FILES as readonly string[]).includes(file)) {
        throw new Error(
            'Projektdatei ist nicht für den Identitätssync freigegeben.',
        )
    }
    const target = resolve(root, file)
    const relativeTarget = relative(root, target)
    if (
        isAbsolute(relativeTarget) ||
        relativeTarget.startsWith('..' + sep) ||
        relativeTarget === '..'
    ) {
        throw new Error('Projektdatei liegt außerhalb des Repositories.')
    }
    let current = root
    for (const part of relativeTarget.split(sep)) {
        current = join(current, part)
        const entry = await lstat(current)
        if (
            entry.isSymbolicLink() ||
            (current === target ? !entry.isFile() : !entry.isDirectory())
        ) {
            throw new Error(
                `Projektdatei muss ein regulärer Repositorypfad sein: ${file}`,
            )
        }
    }
    return target
}

export async function planProjectIdentitySync(
    rootDirectory: string,
    input: unknown,
) {
    const config = validateProjectIdentity(input)
    const root = resolve(rootDirectory)
    const changes = []
    for (const file of MANAGED_PROJECT_FILES) {
        const path = await assertManagedFile(root, file)
        const before = await readFile(path, 'utf8')
        const after = renderProjectIdentityFile(file, before, config)
        if (before !== after) changes.push({ file, path, before, after })
    }
    return { root, changes }
}

export async function applyProjectIdentitySync(
    plan: Awaited<ReturnType<typeof planProjectIdentitySync>>,
) {
    for (const change of plan.changes) {
        if ((await assertManagedFile(plan.root, change.file)) !== change.path) {
            throw new Error(
                'Projektdateipfad stimmt nicht mit dem Plan überein.',
            )
        }
        if ((await readFile(change.path, 'utf8')) !== change.before) {
            throw new Error(
                `Projektdatei wurde zwischenzeitlich geändert: ${change.file}`,
            )
        }
    }
    for (const change of plan.changes) {
        if ((await assertManagedFile(plan.root, change.file)) !== change.path) {
            throw new Error(
                'Projektdateipfad stimmt nicht mit dem Plan überein.',
            )
        }
        if ((await readFile(change.path, 'utf8')) !== change.before) {
            throw new Error(
                `Projektdatei wurde zwischenzeitlich geändert: ${change.file}`,
            )
        }
        const temporaryPath = join(
            dirname(change.path),
            `.project-sync-${randomUUID()}.tmp`,
        )
        const handle = await open(temporaryPath, 'wx')
        try {
            await handle.writeFile(change.after, 'utf8')
            await handle.close()
            await rename(temporaryPath, change.path)
        } finally {
            await handle.close()
            await unlink(temporaryPath).catch((error: unknown) => {
                if (!(
                    error instanceof Error &&
                    'code' in error &&
                    error.code === 'ENOENT'
                ))
                    throw error
            })
        }
    }
}
