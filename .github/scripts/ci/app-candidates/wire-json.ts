import { rpcLimits } from '../../../../contracts/v1/http-operations.ts'
import { isWireJson } from '../../../../contracts/v1/wire.ts'

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const tokenPattern = /("(?:\\.|[^"\\])*")\s*:|"(?:\\.|[^"\\])*"|[{}[\]]/g

export function decodeWireJson(bytes: Uint8Array): unknown {
    const text = decoder.decode(bytes)
    const value: unknown = JSON.parse(text)
    // JSON.parse validates the grammar but replaces duplicate members.
    const scopes: (Set<string> | null)[] = []
    for (const [token, key] of text.matchAll(tokenPattern)) {
        if (token === '{' || token === '[') {
            scopes.push(token === '{' ? new Set() : null)
            if (scopes.length > rpcLimits.maxJsonDepth)
                throw new Error('JSON depth limit')
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
}
