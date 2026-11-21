import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { listListeningPids, resolveLsofPath, runLsof } from '../lsof.js'

// Card 77a48069. The takeover (index.ts listPortHolders) and the EADDRINUSE
// reclaim (web.ts) SIGTERM own-UID node processes from this list. A bare
// `lsof -ti :<port>` also returns processes holding a CLIENT connection to
// the port, so a node client calling the dashboard was a "previous instance".
// Real processes, real lsof: a listener in this process, a client in a child.

const haveLsof = resolveLsofPath() != null

let server: Server | null = null
let client: ChildProcess | null = null

afterEach(async () => {
  client?.kill('SIGKILL')
  client = null
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

async function listenerAndClient(): Promise<{ port: number; clientPid: number }> {
  server = createServer((sock) => sock.on('error', () => {}))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  client = spawn(
    process.execPath,
    ['-e', `const s=require('net').connect(${port},'127.0.0.1',()=>console.log('connected'));s.on('error',()=>{});setInterval(()=>{},1000)`],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('client did not connect in 5 s')), 5000)
    client!.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('connected')) {
        clearTimeout(t)
        resolve()
      }
    })
  })
  return { port, clientPid: client.pid! }
}

describe.skipIf(!haveLsof)('listListeningPids (77a48069): the listener, never a client of the port', () => {
  it('returns the listening process and not the connected client', async () => {
    const { port, clientPid } = await listenerAndClient()
    // Control: the client IS visible to a bare lsof on this port, so the
    // assertion below is about the filter, not about lsof missing the client.
    const bare = (runLsof(['-ti', `:${port}`], 3000) ?? '').split('\n').map((s) => parseInt(s, 10))
    expect(bare).toContain(clientPid)

    const pids = listListeningPids(port)
    expect(pids).toContain(process.pid)
    expect(pids).not.toContain(clientPid)
  })

  it('is empty for a port nobody listens on', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    expect(listListeningPids(port)).toEqual([])
  })
})
