import type { withSharedStorageMutationBarrier } from '@/server/Storage/storage-mutation-barrier.service.ts'

export type ByteRange = {
    end: number
    start: number
}

export type ProductionStorageAssetOptions = {
    withStorageBarrier?: typeof withSharedStorageMutationBarrier
}
