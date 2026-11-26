import type { Header } from 'tar-stream'
export type BackupArchiveIntegrity = {
    version: 2
    algorithm: 'hmac-sha256'
    entryCount: number
    totalBytes: number
    hmacSha256: string
}

export type BackupTarEntry = {
    path: string
    size: number
    type: 'directory' | 'file'
}

export type BackupTarHeader = Pick<Header, 'name' | 'size' | 'type'> &
    Partial<Pick<Header, 'linkname' | 'pax'>>
