/**
 * Standalone server for the packaged skill: serves the built dashboard and the /api routes from a
 * single file with no dependencies. Bundled to plugin/skills/skills-dashboard/scripts/server.mjs by
 * `bun run build:plugin`; runs on Node 18+ or Bun.
 *
 *   node server.mjs [--port 5179] [--no-open]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ID, apiHandler } from './skillsApi.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
// Layout inside the skill: scripts/server.mjs next to app/
const APP_DIR = path.resolve(here, '..', 'app')

const args = process.argv.slice(2)
const portArg = args.includes('--port') ? args[args.indexOf('--port') + 1] : undefined
const START_PORT = Number(portArg ?? process.env.SKILLS_DASHBOARD_PORT ?? 5179)
const OPEN_BROWSER = !args.includes('--no-open')
const PORT_ATTEMPTS = 10

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function openBrowser(url: string) {
  const [cmd, cmdArgs] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // No browser launcher available (e.g. headless box) — the URL is printed anyway
  }
}

async function isOurs(port: number) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
    return ((await res.json()) as { app?: string }).app === APP_ID
  } catch {
    return false
  }
}

async function serveStatic(pathname: string, res: http.ServerResponse) {
  let rel: string
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400).end('Bad request')
    return
  }
  const file = path.resolve(APP_DIR, `.${rel === '/' ? '/index.html' : rel}`)
  if (file !== APP_DIR && !file.startsWith(APP_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  try {
    const body = await fs.readFile(file)
    const hashed = rel.startsWith('/assets/')
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}

function createServer(port: number) {
  // Only answer to our own address: blocks DNS-rebinding pages from reaching the API.
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  return http.createServer((req, res) => {
    if (!allowedHosts.has(req.headers.host ?? '')) {
      res.writeHead(403).end('Forbidden host')
      return
    }
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      req.url = (req.url ?? '').slice('/api'.length) || '/'
      void apiHandler(req, res, () => {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"Not found"}')
      })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed')
      return
    }
    void serveStatic(pathname, res)
  })
}

function listen(server: http.Server, port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (err.code === 'EADDRINUSE') resolve(false)
      else reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function main() {
  try {
    await fs.access(path.join(APP_DIR, 'index.html'))
  } catch {
    console.error(`Dashboard files not found in ${APP_DIR}. Run \`bun run build:plugin\` first.`)
    process.exit(1)
  }

  for (let port = START_PORT; port < START_PORT + PORT_ATTEMPTS; port++) {
    if (await isOurs(port)) {
      const url = `http://127.0.0.1:${port}`
      console.log(`Skills Dashboard is already running at ${url}`)
      if (OPEN_BROWSER) openBrowser(url)
      return
    }
    const server = createServer(port)
    if (await listen(server, port)) {
      const url = `http://127.0.0.1:${port}`
      console.log(`Skills Dashboard running at ${url}  (Ctrl+C to stop)`)
      if (OPEN_BROWSER) openBrowser(url)
      const stop = () => server.close(() => process.exit(0))
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      return
    }
  }
  console.error(`No free port between ${START_PORT} and ${START_PORT + PORT_ATTEMPTS - 1}. Try --port <n>.`)
  process.exit(1)
}

void main()
