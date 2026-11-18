import { safePackagePath, type ArchiveEntry } from './archive-ustar.ts'
import { decodeWireJson } from './wire-json.ts'

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const documentLimit = 4 * 1024 * 1024

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
    const bytes = requiredFile(entries, path)
    if (bytes.length > documentLimit)
        throw new Error('Candidate document exceeds its size limit')
    try {
        return decodeWireJson(bytes)
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

function resolvePointer(
    document: unknown,
    pointer: string,
    schemaTarget: boolean,
) {
    if (!pointer) return document
    let target: unknown = document
    for (const component of pointer.slice(1).split('/')) {
        if (
            schemaTarget &&
            isRecord(target) &&
            Object.hasOwn(target, '$id') &&
            typeof target.$id === 'string'
        ) {
            throw new Error('Unsupported candidate JSON reference or scope')
        }
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
    return target
}

type Node =
    | 'api'
    | 'callback'
    | 'components'
    | 'content'
    | 'encoding'
    | 'example'
    | 'link'
    | 'operation'
    | 'parameter'
    | 'path'
    | 'request'
    | 'response'
    | 'schema'
    | 'securityScheme'
type Child = Node | readonly [Node, 'array' | 'items' | 'map' | 'extendedMap']

// Follow only locations that can contain schemas or Reference Objects. Names
// in maps and values inside examples, defaults and extensions are application data.
const children: Record<Node, Readonly<Record<string, Child>>> = {
    api: {
        components: 'components',
        paths: ['path', 'extendedMap'],
        webhooks: ['path', 'map'],
    },
    callback: {},
    components: {
        callbacks: ['callback', 'map'],
        examples: ['example', 'map'],
        headers: ['parameter', 'map'],
        links: ['link', 'map'],
        parameters: ['parameter', 'map'],
        pathItems: ['path', 'map'],
        requestBodies: ['request', 'map'],
        responses: ['response', 'map'],
        schemas: ['schema', 'map'],
        securitySchemes: ['securityScheme', 'map'],
    },
    content: {
        encoding: ['encoding', 'map'],
        examples: ['example', 'map'],
        schema: 'schema',
    },
    encoding: { headers: ['parameter', 'map'] },
    example: {},
    link: {},
    operation: {
        callbacks: ['callback', 'map'],
        parameters: ['parameter', 'array'],
        requestBody: 'request',
        responses: ['response', 'extendedMap'],
    },
    parameter: {
        content: ['content', 'map'],
        examples: ['example', 'map'],
        schema: 'schema',
    },
    path: {
        delete: 'operation',
        get: 'operation',
        head: 'operation',
        options: 'operation',
        parameters: ['parameter', 'array'],
        patch: 'operation',
        post: 'operation',
        put: 'operation',
        trace: 'operation',
    },
    request: { content: ['content', 'map'] },
    response: {
        content: ['content', 'map'],
        headers: ['parameter', 'map'],
        links: ['link', 'map'],
    },
    schema: {
        $defs: ['schema', 'map'],
        additionalItems: 'schema',
        additionalProperties: 'schema',
        allOf: ['schema', 'array'],
        anyOf: ['schema', 'array'],
        contains: 'schema',
        contentSchema: 'schema',
        definitions: ['schema', 'map'],
        dependencies: ['schema', 'map'],
        dependentSchemas: ['schema', 'map'],
        else: 'schema',
        if: 'schema',
        items: ['schema', 'items'],
        not: 'schema',
        oneOf: ['schema', 'array'],
        patternProperties: ['schema', 'map'],
        prefixItems: ['schema', 'array'],
        properties: ['schema', 'map'],
        propertyNames: 'schema',
        // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema applicator with a string traversal rule.
        then: 'schema',
        unevaluatedItems: 'schema',
        unevaluatedProperties: 'schema',
    },
    securityScheme: {},
}

const referenceNodes = new Set<Node>([
    'callback',
    'example',
    'link',
    'parameter',
    'path',
    'request',
    'response',
    'schema',
    'securityScheme',
])

interface Visit {
    path: string
    value: unknown
    node: Node
}

function queueChildren(
    pending: Visit[],
    path: string,
    value: unknown,
    rule: Child,
) {
    if (typeof rule === 'string') {
        pending.push({ path, value, node: rule })
        return
    }
    const [node, collection] = rule
    if (collection === 'array' || collection === 'items') {
        if (Array.isArray(value)) {
            for (const item of value) pending.push({ path, value: item, node })
        } else if (collection === 'items') {
            pending.push({ path, value, node })
        }
    } else if (isRecord(value)) {
        for (const [name, item] of Object.entries(value)) {
            if (collection !== 'extendedMap' || !name.startsWith('x-')) {
                pending.push({ path, value: item, node })
            }
        }
    }
}

export function verifyDocumentReferences(
    entries: Map<string, ArchiveEntry>,
    documents: Map<string, unknown>,
) {
    let references = 0
    let documentBytes = 0
    const pending: Visit[] = []
    for (const [path, value] of documents) {
        documentBytes += requiredFile(entries, path).length
        pending.push({
            path,
            value,
            node: path === 'api/openapi.json' ? 'api' : 'schema',
        })
    }
    const seen = new WeakMap<object, Set<Node>>()
    const follow = (member: unknown, path: string, node: Node) => {
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
            if (documents.size >= 64 || documentBytes > 16 * 1024 * 1024) {
                throw new Error(
                    'Referenced candidate JSON documents exceed their budget',
                )
            }
            documents.set(target, packageJson(entries, target))
        }
        const value = resolvePointer(
            documents.get(target),
            pointer,
            node === 'schema',
        )
        if (
            !isRecord(value) &&
            !(node === 'schema' && typeof value === 'boolean')
        ) {
            throw new Error(
                'Candidate JSON reference must target an object or schema',
            )
        }
        pending.push({ path: target, value, node })
    }
    for (let visit = pending.pop(); visit; visit = pending.pop()) {
        const { path, value, node } = visit
        if (!isRecord(value)) continue
        const contexts = seen.get(value) ?? new Set<Node>()
        if (contexts.has(node)) continue
        contexts.add(node)
        seen.set(value, contexts)

        if (
            (node === 'schema' &&
                ['$id', '$dynamicRef', '$recursiveRef'].some((key) =>
                    Object.hasOwn(value, key),
                )) ||
            (node === 'example' && Object.hasOwn(value, 'externalValue'))
        ) {
            throw new Error('Unsupported candidate JSON reference or scope')
        }
        const hasReference =
            referenceNodes.has(node) && Object.hasOwn(value, '$ref')
        if (hasReference) follow(value.$ref, path, node)
        if (node === 'link' && Object.hasOwn(value, 'operationRef')) {
            follow(value.operationRef, path, 'operation')
        }
        if (node === 'callback' && !hasReference) {
            queueChildren(pending, path, value, ['path', 'extendedMap'])
        }
        for (const [key, rule] of Object.entries(children[node])) {
            if (Object.hasOwn(value, key))
                queueChildren(pending, path, value[key], rule)
        }
    }
}
