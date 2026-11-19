import {
    contractVersion,
    type AppManifest,
} from '../../../../contracts/v1/index.ts'
import { runAppPipeline } from '../../native-tools.ts'
import {
    appUser,
    attach,
    bindReadOnly,
    bunVersion,
    docker,
    withSandbox,
} from './sandbox-docker.ts'

const fixtureUser = '21002:21004'

export async function smokeInSandbox(options: {
    packageDirectory: string
    manifest: AppManifest
}) {
    const probe = process.env.MARKETPLACE_APP_SMOKE_BIN
    if (!probe)
        throw new Error('The native candidate runtime probe was not built')
    const { manifest } = options
    const bootstrap = JSON.stringify(
        await runAppPipeline('smoke-bootstrap', {
            manifest,
            version: contractVersion,
        }),
    )

    await withSandbox(
        {
            target: manifest.target,
            user: fixtureUser,
            memoryMiB: Math.min(2048, manifest.resources.memoryMiB + 192),
            processLimit: manifest.resources.processLimit + 24,
            mounts: [
                ...bindReadOnly(options.packageDirectory, '/package'),
                ...bindReadOnly(probe, '/candidate-smoke'),
                '--tmpfs',
                '/run-fixture:rw,nosuid,nodev,noexec,size=8m,mode=1777',
                '--tmpfs',
                '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
            ],
            command: [
                '/bin/sh',
                '-ceu',
                'test "$(bun --version)" = "' +
                    bunVersion +
                    '"; exec sleep infinity',
            ],
        },
        async (name) => {
            await docker(['start', name])
            const timeout = manifest.resources.startupTimeoutMs + 10_000
            const manager = attach(
                [
                    'exec',
                    '--interactive',
                    '--user',
                    fixtureUser,
                    name,
                    '/usr/bin/env',
                    '-i',
                    'PATH=/usr/local/bin:/usr/bin:/bin',
                    'HOME=/tmp',
                    '/candidate-smoke',
                    'smoke-probe',
                ],
                {
                    operation: 'Native v1 runtime probe',
                    input: bootstrap,
                    timeout,
                },
            )
            const app = attach(
                [
                    'exec',
                    '--interactive',
                    '--user',
                    appUser,
                    '--workdir',
                    '/package',
                    name,
                    '/usr/bin/env',
                    '-i',
                    'PATH=/usr/local/bin:/usr/bin:/bin',
                    'HOME=/tmp',
                    '/bin/sh',
                    '-ceu',
                    'mkdir -m 0770 /run-fixture/app; exec 3<&0 </dev/null; exec /package/bin/app serve',
                ],
                {
                    operation: 'Candidate app process',
                    input: bootstrap,
                    timeout,
                },
            ).then(() => {
                throw new Error('Candidate app exited during readiness smoke')
            })
            await Promise.race([manager, app])
        },
    )
}
