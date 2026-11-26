import type Valkey from 'ioredis'

export interface AppValkeyClient extends Pick<Valkey, 'defineCommand'> {
    readonly status: string
    get(key: string): Promise<string | null>
    set(key: string, value: string, condition: 'NX'): Promise<'OK' | null>
    set(
        key: string,
        value: string,
        expiryMode: 'EX' | 'PX',
        ttl: number,
        condition?: 'NX',
    ): Promise<'OK' | null>
    del(key: string): Promise<number>
    eval(
        script: string,
        keyCount: number,
        ...arguments_: Array<string | number>
    ): Promise<unknown>
    ping(): Promise<string>
    publish(channel: string, message: string): Promise<number>
    subscribe(channel: string): Promise<unknown>
    on(event: 'ready', listener: () => void): this
    on(
        event: 'message',
        listener: (channel: string, message: string) => void,
    ): this
    off(event: 'ready', listener: () => void): this
    quit(): Promise<string>
    disconnect(): void
}
