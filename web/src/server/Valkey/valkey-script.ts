import type { AppValkeyClient } from './Types/valkey-client.types.ts'

type ScriptArguments = Array<string | number>
type ScriptCommand = (...args: ScriptArguments) => Promise<unknown>

function isScriptCommand(value: unknown): value is ScriptCommand {
    return typeof value === 'function'
}

export function defineValkeyScript(
    name: string,
    numberOfKeys: number,
    lua: string,
) {
    const commands = new WeakMap<AppValkeyClient, ScriptCommand>()
    return function (client: AppValkeyClient, ...args: ScriptArguments) {
        let command = commands.get(client)
        if (!command) {
            // ioredis uses EVALSHA after the first call and reloads after NOSCRIPT.
            client.defineCommand(name, { numberOfKeys, lua })
            const method: unknown = Reflect.get(client, name)
            if (!isScriptCommand(method)) {
                throw new Error('Valkey script command was not installed')
            }
            command = method.bind(client)
            commands.set(client, command)
        }
        return command(...args)
    }
}
