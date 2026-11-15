export class MaintenanceModeError extends Error {
    readonly code = 'MAINTENANCE_ACTIVE'
    readonly status = 503

    constructor() {
        super(
            'Die Anwendung wird gerade gewartet. Bitte versuche es später erneut.',
        )
        this.name = 'MaintenanceModeError'
    }
}
