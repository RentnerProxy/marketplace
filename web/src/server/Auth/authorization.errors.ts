export class AuthenticationRequiredError extends Error {
    constructor() {
        super('Du musst angemeldet sein.')
        this.name = 'AuthenticationRequiredError'
    }
}

export class PermissionDeniedError extends Error {
    constructor() {
        super('Dir fehlt die erforderliche Berechtigung.')
        this.name = 'PermissionDeniedError'
    }
}
