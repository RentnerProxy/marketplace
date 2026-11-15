import * as React from 'react'

const cells: unknown[] = []
let cursor = 0
const effects: React.EffectCallback[] = []

export const hookReact = {
    ...React,
    useState(initial: unknown) {
        const index = cursor++
        if (!(index in cells)) {
            cells[index] =
                typeof initial === 'function'
                    ? Reflect.apply(initial, undefined, [])
                    : initial
        }
        return [
            cells[index],
            (value: unknown) => {
                cells[index] =
                    typeof value === 'function'
                        ? Reflect.apply(value, undefined, [cells[index]])
                        : value
            },
        ]
    },
    useMemo<T>(factory: () => T) {
        return factory()
    },
    useEffect(effect: React.EffectCallback) {
        effects.push(effect)
    },
}

export function renderHook<T>(hook: () => T): T {
    cursor = 0
    effects.length = 0
    return hook()
}

export function resetHooks() {
    cells.length = 0
    effects.length = 0
    cursor = 0
}

export function runEffects() {
    const cleanups = effects.map((effect) => effect())
    return () => cleanups.forEach((cleanup) => cleanup?.())
}
