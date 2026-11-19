import { runTooling } from '../native-tools.ts'

const [path, expected] = process.argv.slice(2)
await runTooling('security-checksum', { path, expected })
