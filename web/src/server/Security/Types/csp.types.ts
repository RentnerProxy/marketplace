export type CspRequestContext = Readonly<{
    nonce: string
    websocketOrigin: string
}>

export type CspRequestOperation<Result> = (context: CspRequestContext) => Result
