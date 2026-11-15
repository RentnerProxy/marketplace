import { describe, expect, it } from 'bun:test'
import { createDeletedUserIdentity } from '@/server/Admin/UserManagement/deletedUserIdentity.service.ts'

describe('UserManagement Löschidentität', function () {
    it('erzeugt eine eindeutige, nicht wiederherstellbare Identität', function () {
        const identity = createDeletedUserIdentity()

        expect(identity.username).toMatch(/^deleted_[a-f0-9]{16}$/)
        expect(identity.email).toBe(`${identity.username}@deleted.invalid`)
    })
})
