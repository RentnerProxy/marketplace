import { createDedicatedValkeyConnection } from '@/server/Valkey/valkey.service.ts'
import { validateAppProductionEnvironment } from '@/server/Runtime/environment.service.ts'
import { waitForValkeyPasswordFileService } from '@/server/Runtime/valkey-password-file.service.ts'
import { createFirstSuperUserSetupAccessService } from './first-super-user-setup-access.service.ts'

await waitForValkeyPasswordFileService()
const environment = validateAppProductionEnvironment()
const valkey = createDedicatedValkeyConnection()

try {
    const token = await createFirstSuperUserSetupAccessService(valkey)
    const setupUrl = `${environment.ORIGIN}/setup#access=${token}`

    process.stdout.write(`${setupUrl}\n`)
} finally {
    valkey.disconnect()
}
