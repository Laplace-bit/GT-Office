export function splitCommandLine(line: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quote) {
      if (char === '\\' && index + 1 < line.length) {
        const next = line[index + 1]
        if (quote === '"' && next === '"') {
          current += '"'
        } else {
          current += `\\${next}`
        }
        index += 1
        continue
      }

      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    parts.push(current)
  }

  return parts
}
