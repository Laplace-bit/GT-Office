export class CliError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

export function parseJsonOption(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    throw new CliError('INVALID_JSON', 'Option must be valid JSON')
  }
}
