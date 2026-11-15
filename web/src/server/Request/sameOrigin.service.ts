export class SameOriginRequestError extends Error {
    constructor() {
        super('Cross-Origin-Anfrage wurde abgelehnt.')
        this.name = 'SameOriginRequestError'
    }
}

export function assertSameOriginRequest(request: Request) {
    const configuredOrigin = process.env.ORIGIN?.trim()

    if (!configuredOrigin) {
        throw new Error('ORIGIN ist nicht konfiguriert.')
    }

    const requestOrigin = request.headers.get('origin')
    const fetchSite = request.headers.get('sec-fetch-site')

    if (
        requestOrigin !== configuredOrigin ||
        (fetchSite && fetchSite !== 'same-origin')
    ) {
        throw new SameOriginRequestError()
    }
}
