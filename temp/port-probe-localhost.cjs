const net = require('node:net')
const ports = [5173, 5174, 5175, 5176, 5177]

function probe(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (error) => resolve(`${port}:${error.code || 'ERROR'}`))
    server.once('listening', () => {
      server.close(() => resolve(`${port}:OPEN`))
    })
    server.listen(port, 'localhost')
  })
}

async function main() {
  for (const port of ports) {
    const result = await probe(port)
    console.log(result)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
