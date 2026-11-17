import { readFile, writeFile } from 'node:fs/promises'
import { buildContractDocuments } from '../../../../contracts/v1/schemas.ts'

const check = process.argv[2] === '--check'
const files = Object.entries(buildContractDocuments())
await Promise.all(
    files.map(async ([name, document]) => {
        const path = new URL(
            '../../../../contracts/v1/' + name,
            import.meta.url,
        )
        const expected = JSON.stringify(document, null, 4) + '\n'
        if (check) {
            const current = await readFile(path, 'utf8')
            if (current.replaceAll('\r\n', '\n') !== expected) {
                throw new Error(
                    name + ' is out of date. Run bun run contracts:generate.',
                )
            }
        } else {
            await writeFile(path, expected)
        }
    }),
)
