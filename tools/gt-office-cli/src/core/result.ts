import { randomUUID } from 'node:crypto'

export type OkResult<T> = {
  ok: true
  data: T
  error: null
  traceId: string
}

export type ErrorResult = {
  ok: false
  data: null
  error: {
    code: string
    message: string
  }
  traceId: string
}

export type CliResult<T> = OkResult<T> | ErrorResult

export function okResult<T>(data: T): OkResult<T> {
  return {
    ok: true,
    data,
    error: null,
    traceId: randomUUID(),
  }
}

export function errorResult(code: string, message: string): ErrorResult {
  return {
    ok: false,
    data: null,
    error: {
      code,
      message,
    },
    traceId: randomUUID(),
  }
}
