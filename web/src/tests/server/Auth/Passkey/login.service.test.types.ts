export type PasskeyLoginTestRow = Record<string, unknown>

export type PasskeyLoginTestScope = {
    challenge?: PasskeyLoginTestRow
    passkey?: PasskeyLoginTestRow
    user?: PasskeyLoginTestRow
}

export type PasskeyLoginTestColumn = {
    scope: keyof PasskeyLoginTestScope
    field: string
}

export type PasskeyLoginTestPredicate =
    | { kind: 'and'; conditions: Array<PasskeyLoginTestPredicate> }
    | { kind: 'eq'; column: PasskeyLoginTestColumn; value: unknown }
    | { kind: 'gt' | 'lt'; column: PasskeyLoginTestColumn; value: Date }

export type PasskeyLoginTestState = {
    challenges: Array<PasskeyLoginTestRow>
    passkeys: Array<PasskeyLoginTestRow>
    users: Array<PasskeyLoginTestRow>
    insertedChallenges: Array<PasskeyLoginTestRow>
    lookupConditions: Array<PasskeyLoginTestPredicate>
}
