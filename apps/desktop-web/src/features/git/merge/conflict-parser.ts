export interface ConflictBlock {
  ours: string
  theirs: string
  startLine: number
  endLine: number
}

export function parseConflictMarkers(content: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i
      let ours = ''
      let theirs = ''
      let inOurs = true

      i++
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        if (lines[i].startsWith('=======')) {
          inOurs = false
        } else if (inOurs) {
          ours += lines[i] + '\n'
        } else {
          theirs += lines[i] + '\n'
        }
        i++
      }

      blocks.push({
        ours: ours.trimEnd(),
        theirs: theirs.trimEnd(),
        startLine,
        endLine: i,
      })
    }
    i++
  }

  return blocks
}
