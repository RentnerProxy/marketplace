function getOptionalMailEnv(key: string) {
    const value = process.env[key]?.trim()

    if (!value) {
        return null
    }

    return value
}

export function getRequiredMailEnv(key: string) {
    const value = getOptionalMailEnv(key)

    if (!value) {
        throw new Error(`${key} ist nicht in der Env konfiguriert.`)
    }

    return value
}

export function getNormalizedMailEnv(key: string) {
    const value = getOptionalMailEnv(key)

    if (!value) {
        return null
    }

    const firstChar = value.at(0)
    const lastChar = value.at(-1)

    if (
        value.length >= 2 &&
        ((firstChar === '"' && lastChar === '"') ||
            (firstChar === "'" && lastChar === "'"))
    ) {
        return value.slice(1, -1).trim()
    }

    return value
}
