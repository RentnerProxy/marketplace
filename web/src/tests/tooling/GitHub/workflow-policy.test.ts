import { expect, test } from 'bun:test'
import { Glob } from 'bun'
import { workflowPolicyErrors } from '../../../../../.github/scripts/ci/workflow-policy.ts'

const valid = `name: Fixture
on: {pull_request: null}
permissions: {contents: read}
concurrency: {group: fixture, cancel-in-progress: true}
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${'a'.repeat(40)}
        with: {persist-credentials: false}
`

test('all active GitHub workflows satisfy their security policy', async () => {
    let count = 0
    for await (const file of new Glob('.github/workflows/*.yml').scan('.')) {
        expect(workflowPolicyErrors(file, await Bun.file(file).text())).toEqual(
            [],
        )
        count++
    }
    expect(count).toBeGreaterThan(0)
})

test('GitHub workflow helpers use the project languages', () => {
    const pythonSources = new Glob('.github/**/*.{py,pyw}').scanSync({
        cwd: '.',
        dot: true,
    })
    expect([...pythonSources]).toEqual([])
})

test.each([
    [
        'missing default permissions',
        valid.replace('permissions: {contents: read}\n', ''),
    ],
    [
        'missing default permissions',
        valid.replace(
            'concurrency: {group: fixture, cancel-in-progress: true}\n',
            '',
        ),
    ],
    ['full commit SHA', valid.replace('a'.repeat(40), 'main')],
    [
        'persisted checkout credentials',
        valid.replace(
            'persist-credentials: false',
            'persist-credentials: true',
        ),
    ],
    ['missing timeout', valid.replace('    timeout-minutes: 5\n', '')],
    [
        'privileged workflow',
        valid
            .replace('pull_request:', 'pull_request_target:')
            .replace(
                'persist-credentials: false',
                'persist-credentials: false, ref: "${{ github.event.pull_request.head.sha }}"',
            ),
    ],
])('rejects workflow policy regression: %s', (reason, source) => {
    expect(
        workflowPolicyErrors('.github/workflows/fixture.yml', source).join(
            '\n',
        ),
    ).toContain(reason ?? '')
})
