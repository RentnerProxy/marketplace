export type InvalidMetadataCase = {
    label: string
    directIp: string | null
    headers: Record<string, string>
}

export type HealthBoundaryCase = {
    label: string
    url: string
    method?: string
    directIp?: string | null
    headers?: Record<string, string>
}
