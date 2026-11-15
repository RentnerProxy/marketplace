import type {
    LazyTestQueryExecution,
    LazyTestQueryFulfilled,
    LazyTestQueryRejected,
} from './Types/lazy-query.test.types.ts'

export class LazyTestQuery<Value> implements PromiseLike<Value> {
    constructor(private readonly execute: LazyTestQueryExecution<Value>) {}

    then<Fulfilled = Value, Rejected = never>(
        onfulfilled?: LazyTestQueryFulfilled<Value, Fulfilled>,
        onrejected?: LazyTestQueryRejected<Rejected>,
    ): Promise<Fulfilled | Rejected> {
        return this.execute().then(onfulfilled, onrejected)
    }
}

export function createLazyTestQuery<Value>(
    execute: LazyTestQueryExecution<Value>,
): PromiseLike<Value> {
    const query = new LazyTestQuery(execute)
    return { then: query.then.bind(query) }
}
