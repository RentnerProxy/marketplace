export type LazyTestQueryExecution<Value> = () => Promise<Value>

export type LazyTestQueryFulfilled<Value, Result> =
    ((value: Value) => Result | PromiseLike<Result>) | null

export type LazyTestQueryRejected<Result> =
    ((reason: unknown) => Result | PromiseLike<Result>) | null
