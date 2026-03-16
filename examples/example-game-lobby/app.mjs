// ============================================================
// Multiplayer Tic-Tac-Toe — BrowserMesh Game Lobby Example
// ============================================================
// Demonstrates P2P game state synchronization, turn ordering,
// host migration, and lobby management using BroadcastChannel.
//
// No server required — open index.html in two browser tabs.
// ============================================================

// --- Pod identity (lightweight stand-in for browsermesh-primitives) ---

function createPodId() {
  return crypto.randomUUID()
}

// --- VectorClock for causal ordering (browsermesh-primitives concept) ---

class VectorClock {
  #clocks = new Map()

  increment(nodeId) {
    this.#clocks.set(nodeId, (this.#clocks.get(nodeId) ?? 0) + 1)
    return this
  }

  merge(other) {
    for (const [k, v] of Object.entries(other)) {
      this.#clocks.set(k, Math.max(this.#clocks.get(k) ?? 0, v))
    }
    return this
  }

  toJSON() {
    return Object.fromEntries(this.#clocks)
  }
}

// --- Constants ---

const WIN_LINES = [
  [0,1,2], [3,4,5], [6,7,8], // rows
  [0,3,6], [1,4,7], [2,5,8], // cols
  [0,4,8], [2,4,6],          // diags
]

const SYMBOLS = ['X', 'O']
const CELL_POS = ['top-left','top-center','top-right','mid-left','center','mid-right','bot-left','bot-center','bot-right']

// --- State ---

let myId = createPodId()
let myName = ''
let mySymbol = null   // 'X' or 'O'
let channel = null     // BroadcastChannel
let roomId = null
let isHost = false

// Game state (authoritative copy lives on host, replicated to guest)
let gameState = null   // { board, turn, players, phase, moveLog, winner, winLine }
let vclock = new VectorClock()

// --- DOM refs ---

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

const dom = {
  lobby:        $('#lobby'),
  game:         $('#game'),
  nameInput:    $('#name-input'),
  playerInfo:   $('#player-info'),
  btnCreate:    $('#btn-create'),
  btnJoinToggle:$('#btn-join-toggle'),
  btnJoin:      $('#btn-join'),
  btnStart:     $('#btn-start'),
  btnRematch:   $('#btn-rematch'),
  btnLeave:     $('#btn-leave'),
  roomCreated:  $('#room-created'),
  roomIdText:   $('#room-id-text'),
  joinSection:  $('#join-section'),
  roomIdInput:  $('#room-id-input'),
  playerListSec:$('#player-list-section'),
  playerList:   $('#player-list'),
  board:        $('#board'),
  statusBar:    $('#status-bar'),
  moveLog:      $('#move-log'),
}

// --- Messaging layer (BroadcastChannel as the transport) ---

function openChannel(id) {
  roomId = id
  channel = new BroadcastChannel(`game-lobby:${id}`)
  channel.onmessage = (e) => handleMessage(e.data)
}

function broadcast(msg) {
  if (!channel) return
  channel.postMessage({ ...msg, from: myId, ts: Date.now() })
}

// --- Message handler ---

function handleMessage(msg) {
  if (msg.from === myId) return

  switch (msg.type) {
    case 'JOIN_REQUEST':
      handleJoinRequest(msg)
      break
    case 'JOIN_ACCEPTED':
      handleJoinAccepted(msg)
      break
    case 'ROOM_FULL':
      alert('Room is full or game already started.')
      break
    case 'PLAYER_JOINED':
      handlePlayerJoined(msg)
      break
    case 'GAME_START':
      handleGameStart(msg)
      break
    case 'MOVE':
      handleRemoteMove(msg)
      break
    case 'REMATCH_REQUEST':
      handleRematchRequest(msg)
      break
    case 'REMATCH_ACCEPTED':
      handleRematchAccepted(msg)
      break
    case 'PLAYER_LEFT':
      handlePlayerLeft(msg)
      break
    case 'HOST_CLAIM':
      handleHostClaim(msg)
      break
    case 'HEARTBEAT':
      // Peer is alive — update last-seen
      if (gameState) {
        const p = gameState.players.find(p => p.id === msg.from)
        if (p) p.lastSeen = msg.ts
      }
      break
  }
}

// --- Lobby: Create Room ---

dom.btnCreate.onclick = () => {
  myName = dom.nameInput.value.trim() || 'Player 1'
  dom.playerInfo.textContent = `${myName} (host)`

  const id = crypto.randomUUID().slice(0, 8)
  openChannel(id)
  isHost = true

  gameState = {
    board: Array(9).fill(null),
    turn: 0,
    players: [{ id: myId, name: myName, symbol: 'X', isHost: true, lastSeen: Date.now() }],
    phase: 'lobby',
    moveLog: [],
    winner: null,
    winLine: null,
  }
  mySymbol = 'X'

  dom.roomIdText.textContent = id
  dom.roomCreated.style.display = ''
  dom.btnCreate.disabled = true
  dom.btnJoinToggle.disabled = true
  dom.playerListSec.style.display = ''
  renderPlayerList()

  // Start heartbeat
  startHeartbeat()
}

// --- Lobby: Join Room ---

dom.btnJoinToggle.onclick = () => {
  dom.joinSection.style.display = dom.joinSection.style.display === 'none' ? '' : 'none'
}

dom.btnJoin.onclick = () => {
  const id = dom.roomIdInput.value.trim()
  if (!id) return

  myName = dom.nameInput.value.trim() || 'Player 2'
  dom.playerInfo.textContent = myName

  openChannel(id)
  isHost = false

  broadcast({ type: 'JOIN_REQUEST', name: myName })

  dom.btnCreate.disabled = true
  dom.btnJoinToggle.disabled = true
  dom.btnJoin.disabled = true
}

// --- Host: handle join request ---

function handleJoinRequest(msg) {
  if (!isHost) return
  if (!gameState || gameState.phase !== 'lobby') {
    broadcast({ type: 'ROOM_FULL', target: msg.from })
    return
  }
  if (gameState.players.length >= 2) {
    broadcast({ type: 'ROOM_FULL', target: msg.from })
    return
  }

  const player = { id: msg.from, name: msg.name, symbol: 'O', isHost: false, lastSeen: Date.now() }
  gameState.players.push(player)

  // Tell the joiner they're in
  broadcast({
    type: 'JOIN_ACCEPTED',
    target: msg.from,
    gameState: structuredClone(gameState),
  })

  // Tell everyone about the new player
  broadcast({ type: 'PLAYER_JOINED', player })

  dom.playerListSec.style.display = ''
  dom.roomCreated.querySelector('small:last-child').textContent = 'Opponent joined!'
  dom.btnStart.disabled = false
  renderPlayerList()
}

// --- Joiner: accepted ---

function handleJoinAccepted(msg) {
  if (msg.target !== myId) return

  gameState = msg.gameState
  mySymbol = 'O'
  dom.playerInfo.textContent = `${myName} (O)`
  dom.joinSection.style.display = 'none'
  dom.playerListSec.style.display = ''
  renderPlayerList()
  startHeartbeat()
}

function handlePlayerJoined(msg) {
  if (!gameState) return
  const exists = gameState.players.find(p => p.id === msg.player.id)
  if (!exists) {
    gameState.players.push(msg.player)
  }
  renderPlayerList()
}

// --- Start Game ---

dom.btnStart.onclick = () => {
  if (!isHost) return
  gameState.phase = 'playing'
  gameState.turn = 0
  gameState.board = Array(9).fill(null)
  gameState.moveLog = []
  gameState.winner = null
  gameState.winLine = null
  broadcast({ type: 'GAME_START', gameState: structuredClone(gameState) })
  showGame()
}

function handleGameStart(msg) {
  gameState = msg.gameState
  showGame()
}

// --- Game UI ---

function showGame() {
  dom.lobby.style.display = 'none'
  dom.game.style.display = 'flex'
  dom.btnRematch.style.display = 'none'
  renderBoard()
  renderStatus()
  renderMoveLog()
}

function showLobby() {
  dom.game.style.display = 'none'
  dom.lobby.style.display = ''
}

function renderBoard() {
  const cells = $$('.cell')
  cells.forEach((cell, i) => {
    const val = gameState.board[i]
    cell.textContent = val ?? ''
    cell.className = 'cell'
    if (val === 'X') cell.classList.add('x')
    if (val === 'O') cell.classList.add('o')
    if (gameState.winLine?.includes(i)) cell.classList.add('win-cell')
    if (gameState.phase !== 'playing' || val !== null) {
      cell.setAttribute('data-disabled', '')
    } else {
      cell.removeAttribute('data-disabled')
    }
  })
}

function renderStatus() {
  const bar = dom.statusBar
  bar.className = 'status-bar'

  if (gameState.phase === 'finished') {
    if (gameState.winner) {
      const wp = gameState.players.find(p => p.symbol === gameState.winner)
      bar.textContent = `${wp?.name ?? gameState.winner} wins!`
      bar.classList.add('win')
    } else {
      bar.textContent = "It's a draw!"
      bar.classList.add('draw')
    }
    dom.btnRematch.style.display = ''
    return
  }

  const currentSymbol = SYMBOLS[gameState.turn % 2]
  const currentPlayer = gameState.players.find(p => p.symbol === currentSymbol)
  const isMyTurn = currentSymbol === mySymbol
  bar.textContent = isMyTurn
    ? `Your turn (${mySymbol})`
    : `${currentPlayer?.name ?? '?'}'s turn (${currentSymbol})`
}

function renderMoveLog() {
  const ul = dom.moveLog.querySelector('ul')
  ul.innerHTML = ''
  for (const m of gameState.moveLog) {
    const li = document.createElement('li')
    const p = gameState.players.find(p => p.id === m.playerId)
    li.textContent = `#${m.turn + 1} ${p?.name ?? '?'} (${m.symbol}) → ${CELL_POS[m.cell]}`
    ul.appendChild(li)
  }
  ul.scrollTop = ul.scrollHeight
}

function renderPlayerList() {
  dom.playerList.innerHTML = ''
  for (const p of gameState.players) {
    const li = document.createElement('li')
    li.innerHTML = `
      <span class="marker" style="background:${p.symbol === 'X' ? 'var(--x-color)' : 'var(--o-color)'}"></span>
      ${escHtml(p.name)} (${p.symbol})
      <span class="role">${p.isHost ? 'host' : 'guest'}</span>
    `
    dom.playerList.appendChild(li)
  }
}

// --- Making Moves ---

dom.board.onclick = (e) => {
  const cell = e.target.closest('.cell')
  if (!cell || cell.hasAttribute('data-disabled')) return
  if (gameState.phase !== 'playing') return

  const idx = Number(cell.dataset.cell)
  const currentSymbol = SYMBOLS[gameState.turn % 2]
  if (currentSymbol !== mySymbol) return  // Not my turn
  if (gameState.board[idx] !== null) return

  // Apply move locally
  applyMove(idx, mySymbol)

  // Broadcast
  vclock.increment(myId)
  broadcast({
    type: 'MOVE',
    cell: idx,
    symbol: mySymbol,
    turn: gameState.turn - 1, // turn was already incremented
    playerId: myId,
    vclock: vclock.toJSON(),
  })
}

function applyMove(cellIdx, symbol) {
  gameState.board[cellIdx] = symbol
  gameState.moveLog.push({
    turn: gameState.turn,
    playerId: symbol === mySymbol ? myId : gameState.players.find(p => p.symbol === symbol)?.id,
    symbol,
    cell: cellIdx,
    ts: Date.now(),
  })
  gameState.turn++

  // Check win
  const result = checkWin(gameState.board)
  if (result) {
    gameState.phase = 'finished'
    gameState.winner = result.winner
    gameState.winLine = result.line
  } else if (gameState.board.every(c => c !== null)) {
    gameState.phase = 'finished'
    gameState.winner = null
    gameState.winLine = null
  }

  renderBoard()
  renderStatus()
  renderMoveLog()
}

function handleRemoteMove(msg) {
  if (msg.from === myId) return
  if (!gameState || gameState.phase !== 'playing') return

  // Validate: correct turn and empty cell
  const expectedSymbol = SYMBOLS[gameState.turn % 2]
  if (msg.symbol !== expectedSymbol) return
  if (gameState.board[msg.cell] !== null) return

  // Merge vector clock
  if (msg.vclock) vclock.merge(msg.vclock)

  applyMove(msg.cell, msg.symbol)
}

function checkWin(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return { winner: board[a], line }
    }
  }
  return null
}

// --- Rematch ---

dom.btnRematch.onclick = () => {
  broadcast({ type: 'REMATCH_REQUEST' })
  dom.btnRematch.disabled = true
  dom.btnRematch.textContent = 'Waiting...'
  // If host, go ahead and reset
  if (isHost) startRematch()
}

function handleRematchRequest(msg) {
  if (isHost) {
    startRematch()
    broadcast({ type: 'REMATCH_ACCEPTED', gameState: structuredClone(gameState) })
  } else {
    // Guest requested — ask host (auto-accept for simplicity)
    broadcast({ type: 'REMATCH_REQUEST' })
  }
}

function handleRematchAccepted(msg) {
  gameState = msg.gameState
  showGame()
}

function startRematch() {
  // Swap symbols
  for (const p of gameState.players) {
    p.symbol = p.symbol === 'X' ? 'O' : 'X'
  }
  mySymbol = gameState.players.find(p => p.id === myId)?.symbol ?? mySymbol

  gameState.board = Array(9).fill(null)
  gameState.turn = 0
  gameState.moveLog = []
  gameState.winner = null
  gameState.winLine = null
  gameState.phase = 'playing'

  dom.playerInfo.textContent = `${myName} (${mySymbol})${isHost ? ' host' : ''}`
  showGame()
}

// --- Leave ---

dom.btnLeave.onclick = () => {
  broadcast({ type: 'PLAYER_LEFT', playerId: myId, name: myName })
  channel?.close()
  channel = null
  gameState = null
  roomId = null
  isHost = false
  mySymbol = null
  location.reload()
}

function handlePlayerLeft(msg) {
  if (!gameState) return
  gameState.players = gameState.players.filter(p => p.id !== msg.playerId)

  if (gameState.phase === 'playing') {
    gameState.phase = 'finished'
    gameState.winner = mySymbol // The remaining player wins by default
    renderBoard()
    renderStatus()
    renderMoveLog()
    dom.statusBar.textContent = `${msg.name ?? 'Opponent'} left — you win!`
  }
}

// --- Host Migration ---
// If the host disconnects (no heartbeat for 3s), the guest promotes itself.

let heartbeatInterval = null
let hostCheckInterval = null

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    broadcast({ type: 'HEARTBEAT' })
  }, 1000)

  if (!isHost) {
    hostCheckInterval = setInterval(() => {
      if (!gameState) return
      const host = gameState.players.find(p => p.isHost)
      if (host && host.id !== myId && host.lastSeen && Date.now() - host.lastSeen > 3000) {
        promoteToHost()
      }
    }, 1500)
  }
}

function promoteToHost() {
  if (isHost) return
  isHost = true

  // Update player records
  for (const p of gameState.players) {
    p.isHost = (p.id === myId)
  }

  dom.playerInfo.textContent = `${myName} (${mySymbol}) host`

  // Broadcast claim
  broadcast({ type: 'HOST_CLAIM', newHostId: myId })

  console.log('[host-migration] Promoted to host')
}

function handleHostClaim(msg) {
  if (!gameState) return
  for (const p of gameState.players) {
    p.isHost = (p.id === msg.newHostId)
  }
  if (gameState.phase === 'lobby') renderPlayerList()
}

// --- Cleanup ---

window.addEventListener('beforeunload', () => {
  broadcast({ type: 'PLAYER_LEFT', playerId: myId, name: myName })
  channel?.close()
})

// --- Helpers ---

function escHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

// --- Init ---

dom.nameInput.value = `Player ${Math.floor(Math.random() * 999) + 1}`
dom.nameInput.focus()
