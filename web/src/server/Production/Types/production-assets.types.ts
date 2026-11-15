import type { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'

export type AssetFileReadResult =
    | { kind: 'missing' }
    | { kind: 'too-large' }
    | {
          kind: 'found'
          bytes: Uint8Array<ArrayBuffer> | null
          size: number
      }

export type ByteRange = {
    end: number
    start: number
}

export type ProductionStorageAssetOptions = {
    withStorageBarrier?: typeof withSharedStorageMutationBarrier
}
