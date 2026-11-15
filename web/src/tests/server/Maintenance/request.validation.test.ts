import { describe, expect, it } from 'bun:test'
import { resolveMaintenanceExtensionRequestInputSchema } from '@/features/Admin/SystemSettings/validation.ts'

describe('Wartungsverschiebungsantrag-Validierung', function () {
    it.each([
        '0f1b2c3d-4e5f-4678-9abc-def012345678',
        '01981a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
    ])('akzeptiert bestehende und neue Antrags-IDs', function (requestId) {
        expect(
            resolveMaintenanceExtensionRequestInputSchema.safeParse({
                requestId,
                status: 'rejected',
            }).success,
        ).toBe(true)
    })
})
