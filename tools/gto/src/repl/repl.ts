import readline from 'node:readline/promises'

import { splitCommandLine } from '../core/argv.js'

interface WritableLike {
  write(chunk: string): void
}

interface ReadableLike {
  on?(event: string, listener: (...args: unknown[]) => void): void
}

export function createRepl({ dispatch }: { dispatch: (argv: string[]) => Promise<number> }) {
  return {
    async run({
      stdin,
      stdout,
    }: {
      stdin?: ReadableLike
      stdout?: WritableLike
      dispatch?: (argv: string[]) => Promise<number>
    }) {
      const activeDispatch = dispatch
      const output = stdout

      if (!stdin || !output) {
        return 0
      }

      const rl = readline.createInterface({
        input: stdin as NodeJS.ReadableStream,
        output: output as NodeJS.WritableStream,
      })

      output.write('GTO CLI\n')

      for (;;) {
        let line: string

        try {
          line = await rl.question('gto> ')
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
          if (code === 'ERR_USE_AFTER_CLOSE') {
            return 0
          }
          throw error
        }

        const trimmed = line.trim()

        if (!trimmed) {
          continue
        }

        if (trimmed === 'exit' || trimmed === 'quit') {
          rl.close()
          return 0
        }

        if (trimmed === 'help') {
          output.write('Commands: agent, role, channel, directory, help, exit, quit\n')
          continue
        }

        await activeDispatch(splitCommandLine(trimmed))
      }
    },
  }
}
