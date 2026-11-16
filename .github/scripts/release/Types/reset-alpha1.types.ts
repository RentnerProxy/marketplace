export type Alpha1Request = (
    method: 'GET' | 'DELETE',
    path: string,
) => Promise<unknown>

export interface Alpha1Context {
    repository: string
    event: string
    ref: string
    workflowRef: string
    serverUrl: string
    apiUrl: string
}
