import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildContractDocuments } from '../../../../contracts/v1/schemas.ts'
import { buildRustOperations } from './rust-operations.ts'

const check = process.argv[2] === '--check'
const root = new URL('../../../../', import.meta.url)
const files = Object.entries(buildContractDocuments()).map(
    ([name, document]) => [
        'contracts/v1/' + name,
        JSON.stringify(document, null, 4) + '\n',
    ],
)
files.push(['core/app-contracts/src/http/operations.rs', buildRustOperations()])
await Promise.all(
    files.map(async ([name, expected]) => {
        const path = new URL(name, root)
        if (check) {
            const current = await readFile(path, 'utf8')
            if (current.replaceAll('\r\n', '\n') !== expected) {
                throw new Error(
                    name + ' is out of date. Run bun run contracts:generate.',
                )
            }
        } else {
            await mkdir(new URL('./', path), { recursive: true })
            await writeFile(path, expected)
        }
    }),
)
