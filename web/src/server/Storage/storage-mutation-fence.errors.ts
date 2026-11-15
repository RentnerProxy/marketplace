export class StorageMutationFenceUnavailableError extends Error {
    constructor() {
        super('Storage admission requires verified operator recovery.')
        this.name = 'StorageMutationFenceUnavailableError'
    }
}

export class StorageMutationAdmissionBusyError extends Error {
    constructor() {
        super('Storage admission is busy.')
        this.name = 'StorageMutationAdmissionBusyError'
    }
}
