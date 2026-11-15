import { getValkeyConnection } from './valkey.service.ts'

export async function waitForValkeyReadyService() {
    const valkey = getValkeyConnection()
    if (valkey.status === 'ready') return

    await new Promise<void>(function (resolve) {
        let isReady = false
        function finish() {
            if (isReady) return
            isReady = true
            valkey.off('ready', finish)
            resolve()
        }
        valkey.on('ready', finish)
        void valkey
            .ping()
            .then(function (response) {
                return response === 'PONG' ? finish() : undefined
            })
            .catch(() => undefined)
    })
}
