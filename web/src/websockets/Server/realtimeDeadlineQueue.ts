import type { RealtimeDeadlineEntry } from '@/websockets/Types/realtime-validation.types.ts'

export class RealtimeDeadlineQueue<Key> {
    private readonly entries: Array<RealtimeDeadlineEntry<Key>> = []
    private readonly positions = new Map<Key, number>()

    peek(): RealtimeDeadlineEntry<Key> | undefined {
        return this.entries[0]
    }

    set(key: Key, deadline: number) {
        const position = this.positions.get(key) ?? this.entries.length
        this.entries[position] = { key, deadline }
        this.positions.set(key, position)
        this.restoreOrder(position)
    }

    delete(key: Key) {
        const position = this.positions.get(key)
        if (position === undefined) return false

        const last = this.entries.pop()
        this.positions.delete(key)
        if (last && position < this.entries.length) {
            this.entries[position] = last
            this.positions.set(last.key, position)
            this.restoreOrder(position)
        }
        return true
    }

    private restoreOrder(position: number) {
        if (position > 0 && this.isEarlier(position, (position - 1) >> 1)) {
            while (position > 0) {
                const parent = (position - 1) >> 1
                if (!this.isEarlier(position, parent)) return
                this.swap(position, parent)
                position = parent
            }
            return
        }

        while (position * 2 + 1 < this.entries.length) {
            const left = position * 2 + 1
            const right = left + 1
            const child = this.isEarlier(right, left) ? right : left
            if (!this.isEarlier(child, position)) return
            this.swap(position, child)
            position = child
        }
    }

    private isEarlier(left: number, right: number) {
        return (
            (this.entries[left]?.deadline ?? Infinity) <
            (this.entries[right]?.deadline ?? Infinity)
        )
    }

    private swap(left: number, right: number) {
        const leftEntry = this.entries[left]
        const rightEntry = this.entries[right]
        this.entries[left] = rightEntry
        this.entries[right] = leftEntry
        this.positions.set(leftEntry.key, right)
        this.positions.set(rightEntry.key, left)
    }
}
