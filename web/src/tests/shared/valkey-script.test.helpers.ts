import type { AppValkeyClient } from '@/server/Valkey/Types/valkey-client.types.ts'

type CommandDefinition = Parameters<AppValkeyClient['defineCommand']>[1]

export function mockValkeyDefineCommand(
    evaluate: (
        script: string,
        numberOfKeys: number,
        ...args: never[]
    ) => Promise<unknown>,
) {
    return function (
        this: object,
        name: string,
        definition: CommandDefinition,
    ) {
        const { lua, numberOfKeys } = definition
        if (numberOfKeys === undefined)
            throw new Error('Expected a fixed key count')
        Object.defineProperty(this, name, {
            value: (...args: never[]) => evaluate(lua, numberOfKeys, ...args),
        })
    }
}
