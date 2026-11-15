export type SetupAccessStore = {
    del: (key: string) => Promise<unknown>
    get: (key: string) => Promise<string | null>
    set: (
        key: string,
        value: string,
        expiryMode: 'EX',
        ttl: number,
        condition?: 'NX',
    ) => Promise<unknown>
}
