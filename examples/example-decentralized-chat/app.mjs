// Decentralized Chat — BrowserMesh example
// Uses BroadcastChannel for same-origin tab-to-tab messaging.
// No server, no WebSocket, no database. Open multiple tabs and chat.

// ---------------------------------------------------------------------------
// Pod identity (lightweight — a random ID per tab)
// ---------------------------------------------------------------------------
const podId = crypto.randomUUID()
let displayName = ''

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
const chatChannel = new BroadcastChannel('decentralized-chat:messages')
const presenceChannel = new BroadcastChannel('decentralized-chat:presence')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const messages = []          // { id, sender, senderName, text, timestamp }
const peers = new Map()      // podId → { name, status, lastSeen }

const HEARTBEAT_MS = 3000
const STALE_MS = 8000
const TYPING_TIMEOUT_MS = 2000

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $modal      = document.getElementById('username-modal')
const $nameInput  = document.getElementById('username-input')
const $joinBtn    = document.getElementById('join-btn')
const $app        = document.getElementById('app')
const $podId      = document.getElementById('pod-id')
const $messages   = document.getElementById('messages')
const $userList   = document.getElementById('user-list')
const $msgInput   = document.getElementById('msg-input')
const $sendBtn    = document.getElementById('send-btn')

// ---------------------------------------------------------------------------
// Join flow
// ---------------------------------------------------------------------------
function join () {
  const name = $nameInput.value.trim()
  if (!name) return
  displayName = name

  $modal.classList.add('hidden')
  $app.classList.add('active')
  $podId.textContent = `pod:${podId.slice(0, 8)}`

  // Register self in peer list
  peers.set(podId, { name: displayName, status: 'online', lastSeen: Date.now() })
  renderUsers()

  // Announce arrival
  presenceChannel.postMessage({
    type: 'presence',
    podId,
    name: displayName,
    status: 'online',
    timestamp: Date.now(),
  })

  // System message locally
  addSystemMessage(`You joined as ${displayName}`)

  // Start heartbeat & stale-peer sweep
  setInterval(sendHeartbeat, HEARTBEAT_MS)
  setInterval(sweepStalePeers, STALE_MS)

  $msgInput.focus()
}

$joinBtn.addEventListener('click', join)
$nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join() })

// ---------------------------------------------------------------------------
// Sending messages
// ---------------------------------------------------------------------------
function sendMessage () {
  const text = $msgInput.value.trim()
  if (!text) return

  const msg = {
    id: crypto.randomUUID(),
    sender: podId,
    senderName: displayName,
    text,
    timestamp: Date.now(),
  }

  chatChannel.postMessage({ type: 'chat', ...msg })

  // Also display locally (BroadcastChannel doesn't echo to sender)
  messages.push(msg)
  renderMessage(msg, true)
  $msgInput.value = ''
  $msgInput.focus()
}

$sendBtn.addEventListener('click', sendMessage)
$msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage()
})

// Typing indicator
let typingTimer
$msgInput.addEventListener('input', () => {
  presenceChannel.postMessage({
    type: 'presence',
    podId,
    name: displayName,
    status: 'typing',
    timestamp: Date.now(),
  })
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    presenceChannel.postMessage({
      type: 'presence',
      podId,
      name: displayName,
      status: 'online',
      timestamp: Date.now(),
    })
  }, TYPING_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// Receiving messages
// ---------------------------------------------------------------------------
chatChannel.addEventListener('message', (e) => {
  if (e.data.type !== 'chat') return
  const msg = {
    id: e.data.id,
    sender: e.data.sender,
    senderName: e.data.senderName,
    text: e.data.text,
    timestamp: e.data.timestamp,
  }
  messages.push(msg)
  renderMessage(msg, false)
})

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------
presenceChannel.addEventListener('message', (e) => {
  if (e.data.type !== 'presence') return
  if (e.data.podId === podId) return  // ignore own echo

  const isNew = !peers.has(e.data.podId)
  peers.set(e.data.podId, {
    name: e.data.name,
    status: e.data.status,
    lastSeen: e.data.timestamp,
  })

  if (isNew) {
    addSystemMessage(`${e.data.name} joined`)
    // Reply so the newcomer sees us
    presenceChannel.postMessage({
      type: 'presence',
      podId,
      name: displayName,
      status: 'online',
      timestamp: Date.now(),
    })
  }

  renderUsers()
})

function sendHeartbeat () {
  presenceChannel.postMessage({
    type: 'presence',
    podId,
    name: displayName,
    status: 'online',
    timestamp: Date.now(),
  })
}

function sweepStalePeers () {
  const now = Date.now()
  for (const [id, peer] of peers) {
    if (id === podId) continue
    if (now - peer.lastSeen > STALE_MS) {
      addSystemMessage(`${peer.name} left`)
      peers.delete(id)
    }
  }
  renderUsers()
}

// Announce departure on unload
window.addEventListener('beforeunload', () => {
  presenceChannel.postMessage({
    type: 'presence',
    podId,
    name: displayName,
    status: 'offline',
    timestamp: Date.now(),
  })
})

presenceChannel.addEventListener('message', (e) => {
  if (e.data.type !== 'presence') return
  if (e.data.status === 'offline' && peers.has(e.data.podId)) {
    addSystemMessage(`${peers.get(e.data.podId).name} left`)
    peers.delete(e.data.podId)
    renderUsers()
  }
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderMessage (msg, isSelf) {
  const div = document.createElement('div')
  div.className = `msg ${isSelf ? 'self' : 'other'}`
  div.innerHTML = `
    <div class="sender">${escapeHtml(msg.senderName)}</div>
    <div class="body">${escapeHtml(msg.text)}</div>
    <div class="time">${formatTime(msg.timestamp)}</div>
  `
  $messages.appendChild(div)
  $messages.scrollTop = $messages.scrollHeight
}

function addSystemMessage (text) {
  const div = document.createElement('div')
  div.className = 'msg system'
  div.textContent = text
  $messages.appendChild(div)
  $messages.scrollTop = $messages.scrollHeight
}

function renderUsers () {
  $userList.innerHTML = ''
  for (const [id, peer] of peers) {
    const el = document.createElement('div')
    el.className = 'user-entry'
    const isTyping = peer.status === 'typing'
    el.innerHTML = `
      <span class="dot${isTyping ? ' typing' : ''}"></span>
      <span class="name">${escapeHtml(peer.name)}</span>
      ${id === podId ? '<span class="you">(you)</span>' : ''}
    `
    $userList.appendChild(el)
  }
}

function formatTime (ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function escapeHtml (str) {
  const el = document.createElement('span')
  el.textContent = str
  return el.innerHTML
}
