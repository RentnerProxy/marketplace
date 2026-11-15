import { expect, test } from 'bun:test'
import { record } from '../../../../../.github/scripts/automation/github.ts'

const root = new URL('../../../../../', import.meta.url)
const read = (path: string) => Bun.file(new URL(path, root)).text()
const doc = record(
    Bun.YAML.parse(await read('.github/workflows/dev-image.yml')),
)
const jobs = record(doc.jobs)
const steps = (job: unknown) => {
    const value = record(job).steps
    if (!Array.isArray(value)) throw new Error('Missing workflow steps')
    return value.map(record)
}

test('dev publication is manual main-only, serialized and separated from source checks', () => {
    expect(doc.on).toEqual({ workflow_dispatch: null })
    expect(doc.permissions).toEqual({})
    expect(doc.concurrency).toEqual({
        group: 'dev-image',
        'cancel-in-progress': false,
    })
    expect(record(jobs.verify).uses).toBe('./.github/workflows/ci.yml')
    expect(record(jobs.audit).uses).toBe(
        './.github/workflows/dependency-security.yml',
    )
    expect(record(jobs.verify).needs).toBe('prepare')
    expect(record(jobs.audit).needs).toBe('prepare')
    for (const name of ['prepare', 'verify', 'audit', 'build'])
        expect(record(jobs[name]).permissions).toEqual({ contents: 'read' })
    const publisher = record(jobs['publish-image'])
    expect(publisher.needs).toEqual(['prepare', 'verify', 'audit', 'build'])
    expect(publisher.permissions).toEqual({
        contents: 'read',
        packages: 'write',
    })
    expect(publisher.environment).toBe('container-publishing')
    expect(
        steps(jobs.prepare).some(
            (step) =>
                step.run ===
                'bun --no-env-file .github/scripts/deploy/dev-image.ts prepare',
        ),
    ).toBe(true)
})

test('dev candidate is built without push rights and sealed after its exact image scan and short runtime checks', () => {
    const build = steps(jobs.build)
    const image = build.find((step) => step.id === 'build')!
    expect(image.with).toMatchObject({
        platforms: 'linux/amd64',
        push: false,
        load: false,
        provenance: false,
        sbom: false,
    })
    const scan = build.findIndex((step) =>
        String(step.run).startsWith(
            'bash .github/scripts/security/scan-image.sh',
        ),
    )
    const smoke = build.findIndex(
        (step) => step.run === 'bun --no-env-file run test:deployment',
    )
    const native = build.findIndex(
        (step) => step.run === 'bash .github/scripts/ci/core-integration.sh',
    )
    const seal = build.findIndex(
        (step) => step.run === 'bash .github/scripts/deploy/seal-dev-image.sh',
    )
    expect(scan).toBeGreaterThan(build.indexOf(image))
    expect(smoke).toBeGreaterThan(scan)
    expect(native).toBeGreaterThan(smoke)
    expect(seal).toBeGreaterThan(native)
    expect(String(build[scan]!.run)).toContain('candidate-image.tar" --input')
    expect(record(build[smoke]!.env).RUNTIME_IMAGE_ID).toBe(
        '${{ steps.load.outputs.runtime_image_id }}',
    )
    const upload = build.at(-1)!
    expect(record(upload.with).name).toBe(
        'marketplace-dev-candidate-${{ github.run_id }}-${{ github.run_attempt }}',
    )
    expect(record(upload.with)['if-no-files-found']).toBe('error')
})

test('publisher verifies and rescans data before exposing the token and always retains honest evidence', async () => {
    const publish = steps(jobs['publish-image'])
    const verify = publish.findIndex(
        (step) =>
            step.run === 'bash .github/scripts/deploy/verify-dev-image.sh',
    )
    const scan = publish.findIndex((step) =>
        String(step.run).includes('dev-image.ts assess'),
    )
    const push = publish.findIndex(
        (step) =>
            step.run === 'bash .github/scripts/deploy/publish-dev-image.sh',
    )
    expect(verify).toBeGreaterThan(0)
    expect(scan).toBeGreaterThan(verify)
    expect(push).toBeGreaterThan(scan)
    expect(record(publish[push]!.env).REGISTRY_TOKEN).toBe(
        '${{ github.token }}',
    )
    for (const step of publish.slice(0, push))
        expect(record(step.env ?? {}).REGISTRY_TOKEN).toBeUndefined()
    const commands = publish.map((step) => step.run ?? '').join('\n')
    expect(commands).not.toMatch(
        /bun ci|bun install|docker (?:run|build)|test:deployment/,
    )
    expect(publish.at(-1)!.if).toBe('always()')
    expect(record(publish.at(-1)!.with).name).toBe(
        'dependency-publish-evidence-${{ github.run_id }}-${{ github.run_attempt }}',
    )
    const handoff = await read('.github/scripts/deploy/verify-dev-image.sh')
    expect(handoff.indexOf('dev-image.ts hashes')).toBeLessThan(
        handoff.indexOf('skopeo inspect'),
    )
    const shell = await read('.github/scripts/deploy/publish-dev-image.sh')
    expect(shell).toContain('copy --all --preserve-digests')
    expect(shell.indexOf('dev-image.ts ready')).toBeLessThan(
        shell.indexOf('skopeo login'),
    )
    expect(shell.indexOf('current_main=')).toBeLessThan(
        shell.indexOf('skopeo login'),
    )
    expect(shell.indexOf('REMOTE_DEV_DIGEST')).toBeLessThan(
        shell.indexOf('dev-image.ts published'),
    )
})
