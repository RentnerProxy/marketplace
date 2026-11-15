export function getRealtimePortService() {
    const port = Number(process.env.REALTIME_WS_PORT ?? 3001)

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('REALTIME_WS_PORT muss ein gültiger Port sein.')
    }

    return port
}

export function getRealtimeHostnameService() {
    return process.env.REALTIME_WS_HOST ?? '127.0.0.1'
}
