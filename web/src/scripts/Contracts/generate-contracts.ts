import { fileURLToPath } from 'node:url'
import { runNativeTool } from '../../lib/Core/native-tool.ts'

const check = process.argv[2] === '--check'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
await runNativeTool('marketplace-tooling', 'contracts-registry', {
    root,
    check,
})
const { buildContractDocuments } =
    await import('../../../../contracts/v1/schemas.ts')
await runNativeTool('marketplace-tooling', 'contracts-sync', {
    root,
    check,
    documents: Object.fromEntries(
        Object.entries(buildContractDocuments()).map(([name, document]) => [
            name,
            JSON.stringify(document, null, 4) + '\n',
        ]),
    ),
})
