export type RouteErrorCategory =
    | 'authorization'
    | 'generic'
    | 'moduleLoad'
    | 'network'
    | 'notFound'
    | 'server'

export type RouteErrorDetails = {
    category: RouteErrorCategory
    cause?: string
    componentStack?: string
    errorName: string
    errorPath?: string
    message: string
    stack?: string
    statusCode?: number
    technicalDetails: string
}
