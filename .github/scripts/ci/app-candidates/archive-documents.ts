import { isWireJson } from '../../../../contracts/v1/wire.ts'
import { safePackagePath, type ArchiveEntry } from './archive-ustar.ts'

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const documentLimit = 4 * 1024 * 1024
const tokenPattern = /("(?:\\.|[^"\\])*")\s*:|"(?:\\.|[^"\\])*"|[{}[\]]/g

export function requiredFile(entries: Map<string, ArchiveEntry>, path: string) {
    const entry = entries.get(path)
    if (!entry || entry.directory || entry.bytes.length === 0) {
        throw new Error('Missing or empty candidate package file: ' + path)
    }
    return entry.bytes
}

export function packageText(entries: Map<string, ArchiveEntry>, path: string) {
    const bytes = requiredFile(entries, path)
    if (bytes.length > documentLimit)
        throw new Error('Candidate document exceeds its size limit')
    try {
        const text = decoder.decode(bytes)
        if (text.includes('\0') || !text.trim())
            throw new Error('Empty or binary text')
        return text
    } catch {
        throw new Error('Invalid UTF-8 candidate document: ' + path)
    }
}

export function packageJson(
    entries: Map<string, ArchiveEntry>,
    path: string,
): unknown {
    const text = packageText(entries, path)
    try {
        const value: unknown = JSON.parse(text)
        // JSON.parse validates the grammar but silently replaces duplicate members.
        const scopes: (Set<string> | null)[] = []
        for (const [token, key] of text.matchAll(tokenPattern)) {
            if (token === '{' || token === '[') {
                scopes.push(token === '{' ? new Set() : null)
                if (scopes.length > 64) throw new Error('JSON depth limit')
            } else if (token === '}' || token === ']') {
                scopes.pop()
            } else if (key !== undefined) {
                const name: string = JSON.parse(key)
                const members = scopes.at(-1)
                if (!members || members.has(name))
                    throw new Error('Duplicate JSON member')
                members.add(name)
            }
        }
        if (!isWireJson(value)) throw new Error('Invalid wire JSON')
        return value
    } catch {
        throw new Error('Invalid or ambiguous candidate JSON: ' + path)
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonemptyString(value: unknown) {
    return (
        typeof value === 'string' &&
        value.length <= 256 &&
        value.trim().length > 0
    )
}

export function openApiDocument(document: unknown) {
    if (
        !isRecord(document) ||
        typeof document.openapi !== 'string' ||
        !/^3\.[01]\.\d{1,3}$/.test(document.openapi) ||
        !isRecord(document.info) ||
        !nonemptyString(document.info.title) ||
        !nonemptyString(document.info.version) ||
        !isRecord(document.paths) ||
        Object.entries(document.paths).some(
            ([path, item]) =>
                !path.startsWith('x-') &&
                (!/^\/(?!\/)/.test(path) || !isRecord(item)),
        ) ||
        (document.components !== undefined && !isRecord(document.components))
    ) {
        throw new Error('Invalid candidate OpenAPI document')
    }
}

function referenceTarget(reference: string, path: string) {
    const [asset, fragment = '', ...extra] = reference.split('#')
    if (
        !reference ||
        extra.length ||
        (asset && (!safePackagePath(asset) || !asset.endsWith('.json'))) ||
        (!asset && !reference.startsWith('#'))
    ) {
        throw new Error('Candidate JSON references must be package-local')
    }
    try {
        const pointer = decodeURIComponent(fragment)
        if (
            (pointer && !pointer.startsWith('/')) ||
            /~(?![01])/.test(pointer)
        ) {
            throw new Error('Invalid JSON pointer')
        }
        const target = asset
            ? path.slice(0, path.lastIndexOf('/') + 1) + asset
            : path
        if (!safePackagePath(target))
            throw new Error('Invalid package-local reference path')
        return { target, pointer }
    } catch {
        throw new Error('Invalid candidate JSON reference')
    }
}

function verifyPointer(document: unknown, pointer: string) {
    if (!pointer) return
    let target: unknown = document
    for (const component of pointer.slice(1).split('/')) {
        const key = component.replaceAll('~1', '/').replaceAll('~0', '~')
        if (
            Array.isArray(target) &&
            /^(?:0|[1-9]\d*)$/.test(key) &&
            Number(key) < target.length
        ) {
            target = target[Number(key)]
        } else if (isRecord(target) && Object.hasOwn(target, key)) {
            target = target[key]
        } else {
            throw new Error(
                'Candidate JSON reference does not resolve inside its package',
            )
        }
    }
}

export function verifyDocumentReferences(
    entries: Map<string, ArchiveEntry>,
    documents: Map<string, unknown>,
) {
    let references = 0
    let documentBytes = 0
    for (const path of documents.keys()) {
        documentBytes += requiredFile(entries, path).length
    }
    // Map iterators visit package-local JSON documents loaded via references.
    for (const [path, document] of documents) {
        const pending = [document]
        while (pending.length) {
            const value = pending.pop()
            if (Array.isArray(value)) {
                for (const item of value) pending.push(item)
                continue
            }
            if (!isRecord(value)) continue
            for (const [key, member] of Object.entries(value)) {
                if (
                    key === '$id' ||
                    key === '$dynamicRef' ||
                    key === '$recursiveRef' ||
                    key === 'externalValue' ||
                    key === 'operationRef'
                ) {
                    throw new Error(
                        'Unsupported candidate JSON reference or scope',
                    )
                }
                if (key !== '$ref') {
                    pending.push(member)
                    continue
                }
                if (
                    typeof member !== 'string' ||
                    ++references > 4096 ||
                    member.length > 1024
                ) {
                    throw new Error('Invalid candidate JSON reference')
                }
                const { target, pointer } = referenceTarget(member, path)
                if (!documents.has(target)) {
                    documentBytes += requiredFile(entries, target).length
                    if (
                        documents.size >= 64 ||
                        documentBytes > 16 * 1024 * 1024
                    ) {
                        throw new Error(
                            'Referenced candidate JSON documents exceed their budget',
                        )
                    }
                    documents.set(target, packageJson(entries, target))
                }
                verifyPointer(documents.get(target), pointer)
            }
        }
    }
}
