#!/usr/bin/env node

import { spawn } from 'node:child_process'
import http from 'node:http'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repoRoot, 'apps/desktop-web')
const port = Number(process.env.GTO_STARTUP_PORT ?? 5198)
const mode = process.env.GTO_STARTUP_MODE ?? 'dev'
const targetMs = Number(process.env.GTO_STARTUP_TARGET_MS ?? 3000)
const firstPaintTargetMs = Number(process.env.GTO_STARTUP_FIRST_PAINT_MS ?? 1500)

function fetchTiming(url) {
  const started = performance.now()
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            ms: performance.now() - started,
            bytes: Buffer.concat(chunks).length,
          })
        })
      })
      .on('error', reject)
  })
}

async function waitForServer(baseUrl, timeoutMs = 120000) {
  const started = performance.now()
  while (performance.now() - started < timeoutMs) {
    try {
      const result = await fetchTiming(baseUrl)
      if (result.status >= 200 && result.status < 500) {
        return performance.now() - started
      }
    } catch {
      // retry
    }
    await delay(150)
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`)
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr || stdout || `${command} exited with code ${code}`))
    })
  })
}

async function startDevServer() {
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    {
      cwd: webRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  )

  const readyMs = await waitForServer(`http://localhost:${port}/`)
  return { child, readyMs }
}

async function readText(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      .on('error', reject)
  })
}

async function measureColdLoad(baseUrl, modeName) {
  const index = await fetchTiming(baseUrl)
  const htmlBody = await readText(baseUrl)

  if (modeName === 'build') {
    const scriptMatch = htmlBody.match(/<script[^>]+src="([^"]+index-[^"]+\.js)"/)
    const cssMatch = htmlBody.match(/<link[^>]+href="([^"]+index-[^"]+\.css)"/)
    const script = scriptMatch?.[1]
      ? await fetchTiming(new URL(scriptMatch[1], baseUrl).toString())
      : null
    const css = cssMatch?.[1] ? await fetchTiming(new URL(cssMatch[1], baseUrl).toString()) : null

    const lazyChunks = []
    if (script) {
      const scriptBody = await readText(new URL(scriptMatch[1], baseUrl).toString())
      const imports = [...scriptBody.matchAll(/import\("\.\/([^"]+\.js)"\)/g)].map((match) => match[1])
      for (const chunk of imports) {
        lazyChunks.push(await fetchTiming(new URL(`./assets/${chunk}`, baseUrl).toString()))
      }
    }

    const total =
      index.ms +
      (script?.ms ?? 0) +
      (css?.ms ?? 0) +
      lazyChunks.reduce((sum, chunk) => sum + chunk.ms, 0)

    return { index, mainModule: null, script, css, lazyChunks, total }
  }

  const mainModule = await fetchTiming(new URL('/src/main.tsx', baseUrl).toString())
  const match = htmlBody.match(/src="([^"]+main\.tsx[^"]*)"/)
  const script = match?.[1] ? await fetchTiming(new URL(match[1], baseUrl).toString()) : null
  const total = index.ms + mainModule.ms + (script?.ms ?? 0)

  return { index, mainModule, script, css: null, total }
}

async function main() {
  console.log(`[measure-startup] starting ${mode} server on :${port}`)
  const baseUrl = `http://localhost:${port}/`
  const { child, readyMs } =
    mode === 'build'
      ? await (async () => {
          await runCommand('npm', ['run', 'build'], { cwd: webRoot })
          const preview = spawn(
            process.execPath,
            [path.join(repoRoot, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'],
            { cwd: webRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
          )
          const ready = await waitForServer(baseUrl)
          return { child: preview, readyMs: ready }
        })()
      : await startDevServer()

  try {
    const cold = await measureColdLoad(baseUrl, mode)
    const warm = await measureColdLoad(baseUrl, mode)
    const htmlBody = await readText(baseUrl)
    const hasInstantSplash = htmlBody.includes('shell-startup-frame-rail')

    console.log('')
    console.log('GT Office startup measurement')
    console.log(`- mode: ${mode}`)
    console.log(`- server ready: ${readyMs.toFixed(0)} ms`)
    console.log(`- cold index.html: ${cold.index.ms.toFixed(0)} ms (${cold.index.bytes} bytes)`)
    if (cold.mainModule) {
      console.log(`- cold /src/main.tsx transform: ${cold.mainModule.ms.toFixed(0)} ms`)
    }
    if (cold.script) {
      console.log(`- cold app script: ${cold.script.ms.toFixed(0)} ms (${cold.script.bytes} bytes)`)
    }
    if (cold.css) {
      console.log(`- cold app css: ${cold.css.ms.toFixed(0)} ms (${cold.css.bytes} bytes)`)
    }
    if (cold.lazyChunks?.length) {
      cold.lazyChunks.forEach((chunk, index) => {
        console.log(`- cold lazy chunk ${index + 1}: ${chunk.ms.toFixed(0)} ms (${chunk.bytes} bytes)`)
      })
    }
    console.log(`- cold estimated critical path: ${cold.total.toFixed(0)} ms`)
    console.log(`- warm estimated critical path: ${warm.total.toFixed(0)} ms`)
    console.log(`- index includes instant splash: ${hasInstantSplash ? 'yes' : 'no'}`)
    console.log(`- target warm critical path: <= ${targetMs} ms`)
    console.log(`- target first paint (html only): <= ${firstPaintTargetMs} ms`)

    const passed = warm.total <= targetMs && hasInstantSplash && cold.index.ms <= firstPaintTargetMs
    if (!passed) {
      if (!hasInstantSplash) {
        console.error('FAILED: index.html does not include instant startup splash markup')
      }
      if (cold.index.ms > firstPaintTargetMs) {
        console.error(
          `FAILED: index.html took ${cold.index.ms.toFixed(0)}ms, exceeds first paint target ${firstPaintTargetMs}ms`,
        )
      }
      if (warm.total > targetMs) {
        console.error(`FAILED: warm critical path ${warm.total.toFixed(0)}ms exceeds target ${targetMs}ms`)
      }
      process.exitCode = 1
      return
    }

    console.log('PASSED: warm startup within target')
  } finally {
    child.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error('[measure-startup] error:', error.message)
  process.exitCode = 1
})
