export type RuntimeImageReferenceOptions = {
    source: string
    tag: string
    docker: (
        arguments_: string[],
        allowFailure?: boolean,
    ) => Promise<{ code: number; stdout: string }>
}
