export type BackgroundFileMetadata = {
    version: string
    size: number
}

export type BackgroundFile = BackgroundFileMetadata & {
    bytes: Buffer<ArrayBuffer>
}
