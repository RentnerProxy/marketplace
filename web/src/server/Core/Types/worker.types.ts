export type CoreWorkerInput = {
    payload: string
    binaryInput?: Buffer
    binaryOutput: boolean
}

export type CoreWorkerTerminal =
    | { type: 'result'; requestId: number; result: unknown }
    | {
          type: 'error'
          requestId: number
          error: { code: string; message: string }
      }
