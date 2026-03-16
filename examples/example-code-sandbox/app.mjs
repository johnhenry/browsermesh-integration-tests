// ── Collaborative Code Sandbox ──
// Demonstrates BrowserMesh concepts: Pod lifecycle, CRDT-style sync,
// sandboxed execution, and session protocol patterns.

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const editor    = document.getElementById('editor')
const output    = document.getElementById('output')
const btnRun    = document.getElementById('btn-run')
const btnClear  = document.getElementById('btn-clear')
const userCount = document.getElementById('user-count')
const podStatus = document.getElementById('pod-status')
const syncStatus = document.getElementById('sync-status')

// ---------------------------------------------------------------------------
// Pod — lightweight simulation of a BrowserMesh WindowPod
// ---------------------------------------------------------------------------
class SandboxPod {
  #id
  #createdAt
  #state = 'booting'

  constructor() {
    this.#id = 'pod_' + crypto.randomUUID().slice(0, 8)
    this.#createdAt = Date.now()
  }

  get id()    { return this.#id }
  get state() { return this.#state }

  boot() {
    this.#state = 'running'
    podStatus.textContent = `Pod: ${this.#id}`
    return this
  }

  shutdown() {
    this.#state = 'stopped'
    podStatus.textContent = `Pod: stopped`
  }
}

const pod = new SandboxPod().boot()

// ---------------------------------------------------------------------------
// Sync — BroadcastChannel for multi-tab collaboration
// ---------------------------------------------------------------------------
const CHANNEL_NAME = 'code-sandbox-sync'
const channel = new BroadcastChannel(CHANNEL_NAME)

// Track connected tabs
let knownPeers = new Set([pod.id])

// Announce ourselves periodically
function announce() {
  channel.postMessage({ type: 'announce', podId: pod.id })
}

// Send heartbeat every 2 seconds
announce()
const heartbeatTimer = setInterval(announce, 2000)

// Peer timeout — remove peers not seen in 5 seconds
const peerLastSeen = new Map()
peerLastSeen.set(pod.id, Date.now())

const peerCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [peerId, ts] of peerLastSeen) {
    if (peerId !== pod.id && now - ts > 5000) {
      knownPeers.delete(peerId)
      peerLastSeen.delete(peerId)
    }
  }
  userCount.textContent = knownPeers.size
}, 3000)

// Handle incoming messages
channel.addEventListener('message', (e) => {
  const msg = e.data

  switch (msg.type) {
    case 'announce':
      knownPeers.add(msg.podId)
      peerLastSeen.set(msg.podId, Date.now())
      userCount.textContent = knownPeers.size
      // Reply so the new peer knows about us
      channel.postMessage({ type: 'announce-reply', podId: pod.id })
      break

    case 'announce-reply':
      knownPeers.add(msg.podId)
      peerLastSeen.set(msg.podId, Date.now())
      userCount.textContent = knownPeers.size
      break

    case 'code-update':
      if (msg.podId !== pod.id) {
        // Apply remote edit (last-writer-wins for simplicity)
        const pos = editor.selectionStart
        editor.value = msg.code
        // Restore cursor position as best we can
        editor.selectionStart = editor.selectionEnd = Math.min(pos, msg.code.length)
        syncStatus.textContent = `Sync: received from ${msg.podId.slice(0, 12)}`
      }
      break

    case 'execution-result':
      if (msg.podId !== pod.id) {
        // Show that another tab ran code
        appendOutput(`[${msg.podId.slice(0, 12)}] ran code`, 'log-info')
      }
      break
  }
})

// Broadcast code changes on input
let broadcastTimer = null
editor.addEventListener('input', () => {
  // Debounce to avoid flooding
  clearTimeout(broadcastTimer)
  broadcastTimer = setTimeout(() => {
    channel.postMessage({
      type: 'code-update',
      podId: pod.id,
      code: editor.value,
      timestamp: Date.now(),
    })
    syncStatus.textContent = 'Sync: sent'
  }, 50)
})

// ---------------------------------------------------------------------------
// Sandboxed Execution — simulates a WorkerPod execution boundary
// ---------------------------------------------------------------------------
function executeInSandbox(code) {
  return new Promise((resolve) => {
    const logs = []
    const startTime = performance.now()

    // Build a worker that captures console output and runs the code
    const workerSource = `
      'use strict';

      const __output = [];

      // Override console to capture output
      const __origConsole = { log: console.log, error: console.error, warn: console.warn };
      console.log   = (...args) => __output.push({ level: 'log',   text: args.map(String).join(' ') });
      console.error = (...args) => __output.push({ level: 'error', text: args.map(String).join(' ') });
      console.warn  = (...args) => __output.push({ level: 'warn',  text: args.map(String).join(' ') });

      // Block dangerous APIs (simulating WorkerPod capability restrictions)
      self.fetch = () => { throw new Error('Network access denied — sandbox has no fetch capability'); };
      self.XMLHttpRequest = undefined;
      self.WebSocket = undefined;
      try { self.indexedDB = undefined; } catch { /* read-only in some browsers */ }

      (async () => {
        try {
          const __fn = new Function(${JSON.stringify(code)});
          const __result = await __fn();
          self.postMessage({
            status: 'success',
            output: __output,
            returnValue: __result === undefined ? undefined : String(__result),
            duration: 0,
          });
        } catch (err) {
          self.postMessage({
            status: 'error',
            output: __output,
            error: { name: err.name, message: err.message, stack: err.stack },
            duration: 0,
          });
        }
      })();
    `

    const blob = new Blob([workerSource], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)

    // Timeout: kill worker after 5 seconds
    const timeout = setTimeout(() => {
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({
        status: 'timeout',
        output: [{ level: 'error', text: 'Execution timed out after 5000ms' }],
        duration: performance.now() - startTime,
      })
    }, 5000)

    worker.onmessage = (e) => {
      clearTimeout(timeout)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({
        ...e.data,
        duration: performance.now() - startTime,
      })
    }

    worker.onerror = (e) => {
      clearTimeout(timeout)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve({
        status: 'error',
        output: [],
        error: { name: 'WorkerError', message: e.message, stack: '' },
        duration: performance.now() - startTime,
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Output Display
// ---------------------------------------------------------------------------
function clearOutput() {
  output.innerHTML = ''
}

function appendOutput(text, className = 'log-line') {
  const line = document.createElement('div')
  line.className = className
  line.textContent = text
  output.appendChild(line)
  output.scrollTop = output.scrollHeight
}

// ---------------------------------------------------------------------------
// Run Button
// ---------------------------------------------------------------------------
async function runCode() {
  const code = editor.value.trim()
  if (!code) return

  clearOutput()
  appendOutput('--- Executing in sandbox ---', 'log-info')
  btnRun.disabled = true
  btnRun.textContent = 'Running...'

  try {
    const result = await executeInSandbox(code)

    // Show captured console output
    for (const entry of result.output) {
      const cls = entry.level === 'error' ? 'log-error'
               : entry.level === 'warn'  ? 'log-warn'
               : 'log-line'
      appendOutput(entry.text, cls)
    }

    // Show return value
    if (result.returnValue !== undefined) {
      appendOutput(`=> ${result.returnValue}`, 'log-return')
    }

    // Show error
    if (result.error) {
      appendOutput(`${result.error.name}: ${result.error.message}`, 'log-error')
      if (result.error.stack) {
        appendOutput(result.error.stack, 'log-error')
      }
    }

    // Show status + timing
    const statusIcon = result.status === 'success' ? 'OK'
                     : result.status === 'timeout' ? 'TIMEOUT'
                     : 'ERROR'
    appendOutput(`[${statusIcon}] ${result.duration.toFixed(1)}ms`, 'log-timing')

    // Notify other tabs
    channel.postMessage({
      type: 'execution-result',
      podId: pod.id,
      status: result.status,
    })

  } catch (err) {
    appendOutput(`Sandbox error: ${err.message}`, 'log-error')
  } finally {
    btnRun.disabled = false
    btnRun.textContent = 'Run'
  }
}

btnRun.addEventListener('click', runCode)
btnClear.addEventListener('click', clearOutput)

// Ctrl/Cmd+Enter to run
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    runCode()
  }
  // Tab key inserts spaces
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = editor.selectionStart
    const end = editor.selectionEnd
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end)
    editor.selectionStart = editor.selectionEnd = start + 2
  }
})

// ---------------------------------------------------------------------------
// Cleanup on unload
// ---------------------------------------------------------------------------
window.addEventListener('beforeunload', () => {
  clearInterval(heartbeatTimer)
  clearInterval(peerCleanupTimer)
  channel.postMessage({ type: 'peer-leave', podId: pod.id })
  channel.close()
  pod.shutdown()
})
