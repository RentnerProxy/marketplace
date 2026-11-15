function decodeValkeyCredential(value: string, label: string) {
    try {
        return value ? decodeURIComponent(value) : undefined
    } catch (error) {
        throw new Error(`${label} in VALKEY_URL ist ungültig kodiert.`, {
            cause: error,
        })
    }
}

export function parseValkeyUrl(value: string) {
    const url = new URL(value)

    if (!['redis:', 'rediss:'].includes(url.protocol)) {
        throw new Error('VALKEY_URL muss redis: oder rediss: verwenden.')
    }

    if (!url.hostname) {
        throw new Error('VALKEY_URL benötigt einen Hostnamen.')
    }

    if (url.search || url.hash) {
        throw new Error(
            'VALKEY_URL darf keine Query-Parameter oder Fragmente enthalten.',
        )
    }

    const port = Number(url.port || 6379)

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(
            'Der Port in VALKEY_URL muss zwischen 1 und 65535 liegen.',
        )
    }

    const databasePath = url.pathname
    let database = 0

    if (databasePath && databasePath !== '/') {
        if (!/^\/\d+$/.test(databasePath)) {
            throw new Error(
                'Der Datenbankpfad in VALKEY_URL muss eine nichtnegative ganze Zahl sein.',
            )
        }

        database = Number(databasePath.slice(1))

        if (!Number.isSafeInteger(database)) {
            throw new Error('Die Valkey-Datenbanknummer ist zu groß.')
        }
    }

    return {
        database,
        host:
            url.hostname.startsWith('[') && url.hostname.endsWith(']')
                ? url.hostname.slice(1, -1)
                : url.hostname,
        password: decodeValkeyCredential(url.password, 'Das Passwort'),
        port,
        tls: url.protocol === 'rediss:',
        username: decodeValkeyCredential(url.username, 'Der Benutzername'),
    }
}
