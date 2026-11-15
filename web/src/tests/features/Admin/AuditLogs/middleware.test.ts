import { beforeEach, expect, it, vi } from 'bun:test'
import {
    authorize,
    createServerFnStub,
} from '../UserManagement/management-middleware.test.helpers.ts'
import type { Boundary } from '../UserManagement/management-middleware.test.helpers.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const getAuditLogs = vi.fn()
vi.mock('@tanstack/react-start', () => ({ createServerFn: createServerFnStub }))
vi.mock('@/server/Admin/AuditLogs/get.service.ts', () => ({
    getAuditLogsService: getAuditLogs,
}))
const { getAuditLogsHandler } =
    await import('@/features/Admin/AuditLogs/middleware.ts')

beforeEach(() => {
    vi.clearAllMocks()
    authorize.mockReset().mockResolvedValue({ userId: 'actor' })
    getAuditLogs.mockReset().mockResolvedValue([{ id: 'audit' }])
})

it('authorizes audit-log access and returns domain entries', async () => {
    expect(await (getAuditLogsHandler as unknown as Boundary)()).toEqual([
        { id: 'audit' },
    ])
    expect(authorize).toHaveBeenCalledWith(PERMISSIONS.ADMIN_AUDIT_LOGS)
    expect(getAuditLogs).toHaveBeenCalledTimes(1)
})

it('never reads audit entries when permission is denied', async () => {
    authorize.mockRejectedValue(new Error('Forbidden'))
    await expect(
        (getAuditLogsHandler as unknown as Boundary)(),
    ).rejects.toThrow('Forbidden')
    expect(getAuditLogs).not.toHaveBeenCalled()
})
