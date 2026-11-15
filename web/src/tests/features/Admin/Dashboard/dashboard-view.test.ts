import { beforeEach, expect, it, vi } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    query,
    render,
    reset,
} from '../UserManagement/user-management-hooks.test.helpers.ts'

vi.mock('@/features/Admin/Dashboard/middleware.ts', () => ({
    getDashboardHealthHandler: vi.fn(),
}))
import AdminDashboard from '@/features/Admin/Dashboard/index.tsx'

beforeEach(reset)

it('renders a status card for every service with the received service health', () => {
    query.mockImplementation(() => ({
        data: {
            services: {
                webserver: { status: 'running', detail: 'responding' },
                websocket: { status: 'running', detail: 'websocketResponding' },
                worker: { status: 'down', detail: 'heartbeatMissing' },
                postgresql: { status: 'connecting', detail: 'checking' },
                valkey: { status: 'error', detail: 'statusUnavailable' },
                core: {
                    status: 'running',
                    detail: 'coreResponding',
                    runtime: { version: '0.1.0', pid: 123, uptimeSeconds: 10 },
                },
            },
        },
    }))
    const html = renderToStaticMarkup(render(AdminDashboard))
    for (const service of [
        'webserver',
        'websocket',
        'worker',
        'postgresql',
        'valkey',
        'core',
    ])
        expect(html).toContain(`admin.dashboard.services.${service}`)
    for (const status of ['running', 'down', 'connecting', 'error'])
        expect(html).toContain(`admin.dashboard.status.${status}`)
    expect(html.match(/aria-live="polite"/g)).toHaveLength(6)
    expect(html.match(/id="dashboard-group-[^"]+"/g)).toHaveLength(3)
    expect(html.match(/id="dashboard-service-console"/g)).toHaveLength(1)
    expect(html).toContain('admin.dashboard.console.noSelection')
    for (const group of ['application', 'processing', 'infrastructure'])
        expect(html).toContain(`dashboard-group-${group}`)
})

it('replaces all stale status cards with unavailable indicators when the refresh fails', () => {
    query.mockImplementation(() => ({ isError: true }))
    const html = renderToStaticMarkup(render(AdminDashboard))
    expect(html.match(/admin.dashboard.status.unknown/g)).toHaveLength(6)
    expect(html).not.toContain('admin.dashboard.status.running')
})
