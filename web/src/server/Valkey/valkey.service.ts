import Valkey from 'ioredis'
import { z } from 'zod'
import type { AppValkeyClient } from './Types/valkey-client.types.ts'
import { getRequiredServerEnvironment } from '@/server/Runtime/environment.service.ts'
import { parseValkeyUrl } from './valkeyUrl.ts'
import { resolveValkeyUrlEnvironment } from '@/server/Runtime/valkey-environment.service.ts'
import { valkeyUrlSchema } from '@/server/Runtime/environment-schema.service.ts'
import { logInfo, logWarn } from '@/server/Logging/logger.ts'
import { attachRuntimeLogConnectionService } from '@/server/Logging/runtime-log-history.service.ts'

declare global {
    var appValkeyConnection: AppValkeyClient | undefined
}

function getReconnectDelay(attempt: number) {
    return Math.min(attempt * 200, 2_000)
}

export function createDedicatedValkeyConnection(): AppValkeyClient {
    const connection = new Valkey(getValkeyUrl(), {
        commandTimeout: 3_000,
        connectTimeout: 5_000,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: getReconnectDelay,
    })
    let isUnavailable = false
    connection.on('error', function () {
        if (isUnavailable) return
        isUnavailable = true
        logWarn('valkey.connection_unavailable')
    })
    connection.on('ready', function () {
        if (!isUnavailable) return
        isUnavailable = false
        logInfo('valkey.connection_restored')
    })
    return connection
}

export function getValkeyConnection() {
    globalThis.appValkeyConnection ??= createDedicatedValkeyConnection()
    attachRuntimeLogConnectionService(globalThis.appValkeyConnection)
    return globalThis.appValkeyConnection
}

function getValkeyUrl() {
    const url = getRequiredServerEnvironment('VALKEY_URL')
    if (!process.env.VALKEY_PASSWORD && !process.env.VALKEY_PASSWORD_FILE) {
        return url
    }
    return z.object({ VALKEY_URL: valkeyUrlSchema }).parse(
        resolveValkeyUrlEnvironment({
            VALKEY_URL: url,
            VALKEY_PASSWORD: process.env.VALKEY_PASSWORD,
            VALKEY_PASSWORD_FILE: process.env.VALKEY_PASSWORD_FILE,
        }),
    ).VALKEY_URL
}

function getBullMqBaseConnectionOptions() {
    const parsedUrl = parseValkeyUrl(getValkeyUrl())

    return {
        host: parsedUrl.host,
        port: parsedUrl.port,
        username: parsedUrl.username,
        password: parsedUrl.password,
        db: parsedUrl.database,
        ...(parsedUrl.tls ? { tls: {} } : {}),
    }
}

export function getBullMqConnectionOptions() {
    return {
        ...getBullMqBaseConnectionOptions(),
        connectTimeout: 5_000,
        maxRetriesPerRequest: null,
    }
}

export function getBullMqProducerConnectionOptions() {
    return {
        ...getBullMqBaseConnectionOptions(),
        commandTimeout: 3_000,
        connectTimeout: 5_000,
        maxRetriesPerRequest: 1,
        retryStrategy: getReconnectDelay,
    }
}
