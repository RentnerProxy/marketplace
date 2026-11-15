import type {
    BunPropertyName,
    TestGlobalPropertyName,
} from './bunTestStubs.test.types.ts'

const originalBunProperties = new Map<BunPropertyName, unknown>()
const originalTestGlobals = new Map<
    TestGlobalPropertyName,
    PropertyDescriptor | undefined
>()

export function stubBunProperties(
    properties: Partial<Record<BunPropertyName, unknown>>,
) {
    for (const propertyName of Reflect.ownKeys(
        properties,
    ) as Array<BunPropertyName>) {
        if (!originalBunProperties.has(propertyName)) {
            originalBunProperties.set(
                propertyName,
                Reflect.get(Bun, propertyName),
            )
        }

        if (
            !Reflect.set(
                Bun,
                propertyName,
                Reflect.get(properties, propertyName),
            )
        ) {
            throw new Error(
                `Bun-Testeigenschaft ${propertyName} konnte nicht ersetzt werden.`,
            )
        }
    }
}

export function restoreBunProperties() {
    for (const [propertyName, originalValue] of originalBunProperties) {
        if (!Reflect.set(Bun, propertyName, originalValue)) {
            throw new Error(
                `Bun-Testeigenschaft ${propertyName} konnte nicht wiederhergestellt werden.`,
            )
        }
    }

    originalBunProperties.clear()
}

export function stubTestGlobal(
    propertyName: TestGlobalPropertyName,
    value: unknown,
) {
    if (!originalTestGlobals.has(propertyName)) {
        originalTestGlobals.set(
            propertyName,
            Object.getOwnPropertyDescriptor(globalThis, propertyName),
        )
    }

    Object.defineProperty(globalThis, propertyName, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    })
}

export function restoreTestGlobals() {
    for (const [propertyName, descriptor] of originalTestGlobals) {
        if (descriptor) {
            Object.defineProperty(globalThis, propertyName, descriptor)
            continue
        }

        if (!Reflect.deleteProperty(globalThis, propertyName)) {
            throw new Error(
                `Test-Global ${propertyName} konnte nicht entfernt werden.`,
            )
        }
    }

    originalTestGlobals.clear()
}
