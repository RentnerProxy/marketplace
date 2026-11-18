import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import type { DataTableProps } from '@rentnerkev/table/types'
import { DataTable } from '@rentnerkev/table'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { StaffInvitationSummary } from '@/features/Admin/StaffManagement/Types/staff-invitation.types.ts'
import type { StaffInvitationActionsProps } from '@/features/Admin/StaffManagement/Components/StaffInvitationManagement/Types/staff-invitation-management.types.ts'
import type { StaffInvitationPermissionFieldsProps } from '@/features/Admin/StaffManagement/Types/staff-invitations-logic.types.ts'
import { STAFF_INVITATIONS_QUERY_KEY } from '@/lib/Permissions/permissionManagementCache.ts'
import SafeDeleteModal from '@/shared/SafeDeleteModal/index.tsx'
import {
    findElement,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'
import type { RealtimeEvent } from '@/websockets/Types/events.ts'
import {
    appError,
    client,
    error,
    query,
    render,
    reset,
    settle,
    success,
} from '../UserManagement/user-management-hooks.test.helpers.ts'

const invite = vi.fn()
const manage = vi.fn()
const refetchInvitations = vi.fn(async () => {})
const refetchPermissions = vi.fn(async () => {})
const realtimeListeners: Array<(event: RealtimeEvent) => Promise<unknown>> = []
const subscribe = vi.fn((listener: (typeof realtimeListeners)[number]) => {
    realtimeListeners.push(listener)
    return () => {}
})
vi.mock('@rentnerkev/toasts', () => ({ toast: { success, error } }))
vi.mock('@/websockets/Client/realtimeEventsClient.ts', () => ({
    subscribeToRealtimeEvents: subscribe,
}))
vi.mock('@/features/Admin/PermissionManagement/middleware.ts', () => ({
    getPermissionManagementOverviewHandler: vi.fn(),
}))
vi.mock('@/features/Admin/StaffManagement/middleware.ts', () => ({
    getStaffInvitationsHandler: vi.fn(),
    inviteStaffHandler: invite,
    manageStaffInvitationHandler: manage,
}))

import StaffInvitationForm from '@/features/Admin/StaffManagement/Components/StaffInvitationForm/index.tsx'
import StaffInvitationManagement from '@/features/Admin/StaffManagement/Components/StaffInvitationManagement/index.tsx'
import StaffInvitationActions from '@/features/Admin/StaffManagement/Components/StaffInvitationManagement/Components/StaffInvitationActions.tsx'
import StaffInvitationPermissionFields from '@/features/Admin/StaffManagement/Components/StaffInvitationPermissionFields.tsx'

const account = { username: 'Ada', email: 'ada@example.test' }
const activeInvitation: StaffInvitationSummary = {
    id: 'first-invitation',
    ...account,
    expiresAt: '2026-11-30T12:00:00Z',
    status: 'active',
    permissionKeys: [PERMISSIONS.USER_DASHBOARD],
}
const disabledInvitation: StaffInvitationSummary = {
    ...activeInvitation,
    id: 'second-invitation',
    status: 'disabled',
}
const presetId = 'dashboard-access'
let loadError = false

function fieldsIn(node: ReactNode) {
    const element = findElement(
        node,
        (child) => child.type === StaffInvitationPermissionFields,
    )
    if (!isValidElement<StaffInvitationPermissionFieldsProps>(element))
        throw new Error('Expected invitation permissions')
    return StaffInvitationPermissionFields(element.props)
}

function tableView() {
    const tree = render(StaffInvitationManagement)
    const table = findElement(tree, (element) => element.type === DataTable)
    if (!isValidElement<DataTableProps<StaffInvitationSummary>>(table))
        throw new Error('Expected invitations table')
    return { tree, table: table.props }
}

function getSaveButton(node: ReactNode) {
    return findElement(
        node,
        (element) => element.props.children === 'common.save',
    )
}

function revokeModal() {
    return findElement(
        tableView().tree,
        (element) => element.type === SafeDeleteModal,
    )
}

function clickRowAction(invitation: StaffInvitationSummary, label: string) {
    const { table } = tableView()
    const renderCell = table.columns.find(
        (column) => column.id === 'actions',
    )?.cell
    if (typeof renderCell !== 'function')
        throw new Error('Expected invitation actions column')
    const action = renderCell({ row: { original: invitation } } as Parameters<
        typeof renderCell
    >[0])
    if (!isValidElement<StaffInvitationActionsProps>(action))
        throw new Error('Expected invitation row controls')
    const actions = StaffInvitationActions(action.props)
    invoke(
        findElement(actions, (element) => element.props.ariaLabel === label),
        'onClick',
    )
}

beforeEach(() => {
    reset()
    realtimeListeners.length = 0
    loadError = false
    invite.mockReset().mockResolvedValue({ success: true })
    manage.mockReset().mockResolvedValue({ success: true })
    query.mockImplementation((input) => {
        const options = input as { queryKey: Array<string> }
        const isOverview = options.queryKey[1] === 'overview'
        return {
            isSuccess: !loadError,
            isError: loadError,
            isPending: false,
            refetch: isOverview ? refetchPermissions : refetchInvitations,
            data: loadError
                ? undefined
                : isOverview
                  ? {
                        permissions: [
                            PERMISSIONS.USER_DASHBOARD,
                            PERMISSIONS.ADMIN_DASHBOARD,
                            PERMISSIONS.ADMIN_SUPER_USER,
                        ].map((key) => ({
                            id: key,
                            key,
                            name: key,
                            description: '',
                        })),
                        presets: [
                            {
                                id: presetId,
                                name: 'Dashboard',
                                permissionKeys: [
                                    PERMISSIONS.ADMIN_DASHBOARD,
                                    PERMISSIONS.ADMIN_SUPER_USER,
                                ],
                            },
                        ],
                    }
                  : [activeInvitation, disabledInvitation],
        }
    })
})

describe('staff invitation form', () => {
    it('starts collapsed and submits the chosen preset without automatic superuser grants', async () => {
        let view = render(StaffInvitationForm)
        expect(
            findElement(view, (element) => element.type === 'details').props
                .open,
        ).toBeUndefined()
        expect(
            findElement(
                view,
                (element) => element.props.to === '/admin/staff-invitations',
            ),
        ).toBeDefined()
        const event = { preventDefault: vi.fn() }
        invoke(
            findElement(view, (element) => element.type === 'form'),
            'onSubmit',
            event,
        )
        expect(invite).not.toHaveBeenCalled()

        invoke(
            findElement(
                view,
                (element) => element.props.id === 'invite-staff-username',
            ),
            'onValueChange',
            account.username,
        )
        invoke(
            findElement(
                view,
                (element) => element.props.id === 'invite-staff-email',
            ),
            'onValueChange',
            account.email,
        )
        invoke(
            findElement(
                fieldsIn(view),
                (element) =>
                    element.props.label ===
                    'admin.permissions.users.presetLabel',
            ),
            'onValueChange',
            presetId,
        )
        view = render(StaffInvitationForm)
        expect(
            findElement(view, (element) => element.props.type === 'submit')
                .props.disabled,
        ).toBe(false)
        invoke(
            findElement(view, (element) => element.type === 'form'),
            'onSubmit',
            event,
        )
        await settle()
        expect(invite).toHaveBeenCalledWith({
            data: { ...account, permissionKeys: [PERMISSIONS.ADMIN_DASHBOARD] },
        })
        expect(success).toHaveBeenCalledWith('admin.staff.inviteSent', {
            title: 'admin.staff.inviteTitle',
        })
        expect(
            findElement(
                render(StaffInvitationForm),
                (element) => element.props.id === 'invite-staff-email',
            ).props.value,
        ).toBe('')
    })
})

describe('staff invitation management table', () => {
    it('opens the permission editor, enables save on a change, and updates the selected row', async () => {
        expect(tableView().table.getSearchValues?.(activeInvitation)).toEqual([
            account.username,
            account.email,
        ])
        clickRowAction(
            activeInvitation,
            'admin.staff.invitations.editPermissions',
        )
        const expanded = () => {
            const { table } = tableView()
            expect(table.expandedRowId).toBe(activeInvitation.id)
            if (!table.renderExpandedRow)
                throw new Error('Expected invitation permission editor')
            return table.renderExpandedRow({
                original: activeInvitation,
            } as Parameters<typeof table.renderExpandedRow>[0])
        }
        expect(getSaveButton(expanded()).props.disabled).toBe(true)
        invoke(
            findElement(
                fieldsIn(expanded()),
                (element) => 'onTogglePermission' in element.props,
            ),
            'onTogglePermission',
            PERMISSIONS.ADMIN_DASHBOARD,
        )
        clickRowAction(activeInvitation, 'admin.staff.invitations.resend')
        await settle()
        expect(tableView().table.expandedRowId).toBe(activeInvitation.id)
        const save = getSaveButton(expanded())
        expect(save.props.disabled).toBe(false)
        invoke(save, 'onClick')
        await settle()
        expect(manage).toHaveBeenCalledWith({
            data: {
                id: activeInvitation.id,
                action: 'permissions',
                expectedPermissionKeys: activeInvitation.permissionKeys,
                permissionKeys: [
                    PERMISSIONS.USER_DASHBOARD,
                    PERMISSIONS.ADMIN_DASHBOARD,
                ],
            },
        })
        expect(tableView().table.expandedRowId).toBeNull()
    })

    it('resends and toggles invitation status, and withdraws only on confirmation', async () => {
        clickRowAction(activeInvitation, 'admin.staff.invitations.resend')
        await settle()
        clickRowAction(disabledInvitation, 'common.activate')
        await settle()
        clickRowAction(activeInvitation, 'common.deactivate')
        await settle()
        clickRowAction(activeInvitation, 'admin.staff.invitations.revoke')
        expect(revokeModal().props.isOpen).toBe(true)
        expect(manage).toHaveBeenCalledTimes(3)
        invoke(revokeModal(), 'onClose')
        expect(revokeModal().props.isOpen).toBe(false)
        clickRowAction(activeInvitation, 'admin.staff.invitations.revoke')
        invoke(revokeModal(), 'onConfirm')
        await settle()
        expect(revokeModal().props.isOpen).toBe(false)
        expect(manage.mock.calls).toEqual([
            [{ data: { id: activeInvitation.id, action: 'resend' } }],
            [
                {
                    data: {
                        id: disabledInvitation.id,
                        action: 'setActive',
                        isActive: true,
                    },
                },
            ],
            [
                {
                    data: {
                        id: activeInvitation.id,
                        action: 'setActive',
                        isActive: false,
                    },
                },
            ],
            [{ data: { id: activeInvitation.id, action: 'revoke' } }],
        ])
    })

    it('reports failed delivery and refreshes the table on invitation updates', async () => {
        manage.mockResolvedValueOnce({
            success: false,
            error: 'deliveryFailed',
        })
        clickRowAction(activeInvitation, 'admin.staff.invitations.resend')
        await settle()
        expect(error).toHaveBeenCalledWith(
            'admin.staff.inviteErrors.deliveryFailed',
            { title: 'admin.staff.invitations.title' },
        )
        expect(success).not.toHaveBeenCalled()
        client.setQueryData(STAFF_INVITATIONS_QUERY_KEY, [activeInvitation])
        await Promise.all(
            realtimeListeners.map((listener) =>
                listener({
                    type: 'admin-permissions.updated',
                    payload: {
                        scope: 'staff-invitations',
                        updatedAt: '2026-11-18T12:00:00Z',
                    },
                }),
            ),
        )
        expect(
            client.getQueryState(STAFF_INVITATIONS_QUERY_KEY)?.isInvalidated,
        ).toBe(true)
    })

    it('offers independent retries when the invitations or permission catalog fail to load', async () => {
        loadError = true
        const { table } = tableView()
        const offline = new Error('offline')
        refetchInvitations.mockRejectedValueOnce(offline)
        invoke(
            findElement(
                table.emptyState,
                (element) => element.type === 'button',
            ),
            'onClick',
        )
        await Promise.resolve()
        expect(refetchInvitations).toHaveBeenCalledTimes(1)
        expect(appError).toHaveBeenCalledWith(offline)

        reset()
        const fields = fieldsIn(render(StaffInvitationForm))
        invoke(
            findElement(fields, (element) => element.type === 'button'),
            'onClick',
        )
        expect(refetchPermissions).toHaveBeenCalledTimes(1)
    })
})
