import type { CoreCommandOptions } from './core.types.ts'

export type CoreWorkerInput = {
    payload: string
    binaryInput?: Buffer
    binaryOutput?: boolean
}

export type CoreWorkerOptions = CoreCommandOptions & {
    binaryInput?: Uint8Array
}

export type CoreWorkerTerminal =
    | { type: 'result'; requestId: number; result: unknown }
    | {
          type: 'error'
          requestId: number
          error: { code: string; message: string }
      }
