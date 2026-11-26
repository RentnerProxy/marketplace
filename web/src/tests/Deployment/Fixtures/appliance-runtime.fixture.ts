import { appendFile, access, rename, writeFile } from 'node:fs/promises'

// Diese Fixture ersetzt ausschließlich App und Worker: keine App-Imports, kein Drizzle.
const worker = process.argv[1].includes('productionWorkerEntrypoint')
const role = worker ? 'worker' : 'webserver'
if (process.getuid?.() !== 1000)
    throw new Error('fixture_consumer_requires_unprivileged_bun_user')
const events = '/data/storage/fixture-events.ndjson'
const database = new Bun.SQL({
    hostname: '127.0.0.1',
    port: 5432,
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
})
const valkeyUrl = new URL('redis://127.0.0.1:6379')
valkeyUrl.password = encodeURIComponent(process.env.VALKEY_PASSWORD ?? '')
const client = new Bun.RedisClient(valkeyUrl.toString())
await database`SELECT 1`
if ((await client.send('PING', [])) !== 'PONG')
    throw new Error('fixture_dependency_unavailable')
await appendFile(events, role + ':ready\n')
console.log('fixture ' + role + ' ready')

const server = worker
    ? null
    : Bun.serve({
          hostname: '127.0.0.1',
          port: 3000,
          fetch: async function (request) {
              if (new URL(request.url).pathname === '/fail') {
                  process.exitCode = 23
                  setTimeout(() => process.exit(23), 10)
              }
              return new Response('fixture-ready')
          },
      })
const heartbeatPath = '/tmp/rentnerproxy-marketplace-worker-heartbeat.json'
async function writeHeartbeat() {
    // Older images probe the plain timestamp; current images read the Rust-checked JSON heartbeat.
    await writeFile(
        '/data/storage/fixture-worker-heartbeat',
        String(Date.now()),
    )
    const temporary = `${heartbeatPath}.${crypto.randomUUID()}.tmp`
    const body = JSON.stringify({
        version: 1,
        status: 'healthy',
        updatedAt: Date.now(),
        pid: process.pid,
    })
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 })
    await rename(temporary, heartbeatPath)
}
if (worker) await writeHeartbeat()
const heartbeat = worker
    ? setInterval(async function () {
          await writeHeartbeat()
          try {
              await access('/data/storage/fixture-worker-crash')
          } catch {
              return
          }
          process.exit(23)
      }, 100)
    : undefined

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async function () {
        if (stopping) return
        stopping = true
        if (heartbeat) clearInterval(heartbeat)
        try {
            // Beide Infrastrukturprozesse müssen während des Consumer-Drains verfügbar bleiben.
            await database`SELECT 1`
            if ((await client.send('PING', [])) !== 'PONG')
                throw new Error('fixture_dependency_stopped_early')
            await appendFile(events, role + ':drained\n')
            client.close()
            await database.close()
            await server?.stop(true)
            process.exit(0)
        } catch {
            process.exit(1)
        }
    })
}
