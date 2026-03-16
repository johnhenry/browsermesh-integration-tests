// P2P Encrypted Notes — BrowserMesh Example App
// Demonstrates: LWWMap CRDT, Pod identity, BroadcastChannel peer discovery

// ---------------------------------------------------------------------------
// 1. LWWMap CRDT — Last-Writer-Wins Map
//    Each entry has a timestamp; on merge, the latest timestamp wins.
//    This is the browsermesh-primitives CRDT concept, implemented inline.
// ---------------------------------------------------------------------------

class LWWMap {
  /** @type {Map<string, { value: any, timestamp: number, peerId: string, deleted?: boolean }>} */
  #entries = new Map()

  set(key, value, peerId) {
    const ts = Date.now()
    const existing = this.#entries.get(key)
    if (!existing || ts >= existing.timestamp) {
      this.#entries.set(key, { value, timestamp: ts, peerId, deleted: false })
    }
    return this.#entries.get(key)
  }

  delete(key, peerId) {
    const ts = Date.now()
    const existing = this.#entries.get(key)
    if (!existing || ts >= existing.timestamp) {
      this.#entries.set(key, { value: null, timestamp: ts, peerId, deleted: true })
    }
  }

  get(key) {
    const entry = this.#entries.get(key)
    if (!entry || entry.deleted) return undefined
    return entry.value
  }

  has(key) {
    const entry = this.#entries.get(key)
    return entry != null && !entry.deleted
  }

  entries() {
    const result = []
    for (const [key, entry] of this.#entries) {
      if (!entry.deleted) result.push([key, entry.value])
    }
    return result
  }

  /** Merge a remote entry. Returns true if the local state changed. */
  mergeEntry(key, remoteEntry) {
    const local = this.#entries.get(key)
    if (!local || remoteEntry.timestamp > local.timestamp) {
      this.#entries.set(key, { ...remoteEntry })
      return true
    }
    // Tie-break: higher peerId wins
    if (remoteEntry.timestamp === local.timestamp && remoteEntry.peerId > local.peerId) {
      this.#entries.set(key, { ...remoteEntry })
      return true
    }
    return false
  }

  /** Export all entries (including tombstones) for sync. */
  exportEntries() {
    const out = []
    for (const [key, entry] of this.#entries) {
      out.push({ key, ...entry })
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// 2. Pod — Lightweight identity + lifecycle
//    Represents a browsermesh-pod: unique ID, creation time, status.
// ---------------------------------------------------------------------------

class Pod {
  #id
  #createdAt

  constructor() {
    // Generate a unique per-tab pod identity (sessionStorage is per-tab)
    let stored = sessionStorage.getItem('pod_id')
    if (stored) {
      this.#id = stored
    } else {
      // Generate a short random hex ID (simulates Ed25519 identity fingerprint)
      const bytes = crypto.getRandomValues(new Uint8Array(4))
      this.#id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      sessionStorage.setItem('pod_id', this.#id)
    }
    this.#createdAt = Date.now()
  }

  get id() { return this.#id }
  get createdAt() { return this.#createdAt }
}

// ---------------------------------------------------------------------------
// 3. PeerChannel — BroadcastChannel-based peer discovery & sync
//    Simulates browsermesh transport for same-origin tabs.
// ---------------------------------------------------------------------------

class PeerChannel {
  #channel
  #pod
  #peers = new Map()          // peerId -> lastSeen
  #onSyncCallback = null
  #heartbeatInterval

  constructor(pod) {
    this.#pod = pod
    this.#channel = new BroadcastChannel('p2p-notes-mesh')
    this.#channel.onmessage = (e) => this.#handleMessage(e.data)

    // Announce presence immediately
    this.#announce()

    // Heartbeat every 3 seconds
    this.#heartbeatInterval = setInterval(() => {
      this.#announce()
      this.#pruneStale()
    }, 3000)
  }

  get peerCount() { return this.#peers.size }

  onSync(callback) {
    this.#onSyncCallback = callback
  }

  /** Broadcast our full CRDT state to all peers. */
  broadcastSync(entries) {
    this.#channel.postMessage({
      type: 'sync',
      peerId: this.#pod.id,
      entries,
      timestamp: Date.now(),
    })
  }

  #announce() {
    this.#channel.postMessage({
      type: 'hello',
      peerId: this.#pod.id,
      timestamp: Date.now(),
    })
  }

  #handleMessage(msg) {
    if (msg.peerId === this.#pod.id) return // ignore own messages

    if (msg.type === 'hello') {
      const isNew = !this.#peers.has(msg.peerId)
      this.#peers.set(msg.peerId, Date.now())
      // When a new peer appears, trigger a full sync push
      if (isNew && this.#onSyncCallback) {
        this.#onSyncCallback({ type: 'peer_joined', peerId: msg.peerId })
      }
    }

    if (msg.type === 'sync') {
      this.#peers.set(msg.peerId, Date.now())
      if (this.#onSyncCallback) {
        this.#onSyncCallback({ type: 'sync', peerId: msg.peerId, entries: msg.entries })
      }
    }
  }

  #pruneStale() {
    const now = Date.now()
    for (const [id, lastSeen] of this.#peers) {
      if (now - lastSeen > 10_000) this.#peers.delete(id)
    }
  }

  destroy() {
    clearInterval(this.#heartbeatInterval)
    this.#channel.close()
  }
}

// ---------------------------------------------------------------------------
// 4. NotesApp — ties together CRDT, Pod, PeerChannel, and UI
// ---------------------------------------------------------------------------

class NotesApp {
  #pod
  #crdt = new LWWMap()
  #channel
  #activeNoteId = null
  #saveTimeout = null

  // DOM refs
  #els = {}

  constructor() {
    this.#pod = new Pod()
    this.#channel = new PeerChannel(this.#pod)

    this.#cacheDom()
    this.#bindEvents()
    this.#loadFromStorage()
    this.#setupSync()
    this.#render()

    // Show pod identity
    this.#els.peerId.textContent = this.#pod.id
  }

  #cacheDom() {
    this.#els = {
      peerId: document.getElementById('peerId'),
      peerCount: document.getElementById('peerCount'),
      statusDot: document.getElementById('statusDot'),
      notesList: document.getElementById('notesList'),
      btnNew: document.getElementById('btnNew'),
      editorEmpty: document.getElementById('editorEmpty'),
      editorActive: document.getElementById('editorActive'),
      titleInput: document.getElementById('titleInput'),
      contentTextarea: document.getElementById('contentTextarea'),
      editorMeta: document.getElementById('editorMeta'),
      btnDelete: document.getElementById('btnDelete'),
    }
  }

  #bindEvents() {
    this.#els.btnNew.addEventListener('click', () => this.#createNote())
    this.#els.btnDelete.addEventListener('click', () => this.#deleteActiveNote())
    this.#els.titleInput.addEventListener('input', () => this.#onEdit())
    this.#els.contentTextarea.addEventListener('input', () => this.#onEdit())

    // Update peer count display
    setInterval(() => {
      const count = this.#channel.peerCount
      this.#els.peerCount.textContent = `${count} peer${count !== 1 ? 's' : ''}`
      this.#els.statusDot.classList.toggle('connected', count > 0)
    }, 1000)
  }

  // -- Persistence (localStorage) --

  #loadFromStorage() {
    try {
      const raw = localStorage.getItem('p2p_notes_crdt')
      if (!raw) return
      const entries = JSON.parse(raw)
      for (const entry of entries) {
        this.#crdt.mergeEntry(entry.key, entry)
      }
    } catch { /* ignore corrupt data */ }
  }

  #saveToStorage() {
    const entries = this.#crdt.exportEntries()
    localStorage.setItem('p2p_notes_crdt', JSON.stringify(entries))
  }

  // -- Sync --

  #setupSync() {
    this.#channel.onSync((event) => {
      if (event.type === 'peer_joined') {
        // A new peer appeared; push our full state
        this.#channel.broadcastSync(this.#crdt.exportEntries())
        return
      }

      if (event.type === 'sync' && event.entries) {
        let changed = false
        for (const entry of event.entries) {
          if (this.#crdt.mergeEntry(entry.key, entry)) {
            changed = true
          }
        }
        if (changed) {
          this.#saveToStorage()
          this.#render()
        }
      }
    })
  }

  #broadcastState() {
    this.#channel.broadcastSync(this.#crdt.exportEntries())
  }

  // -- Notes CRUD --

  #createNote() {
    const id = crypto.randomUUID()
    const note = { id, title: '', content: '', updated: Date.now() }
    this.#crdt.set(id, note, this.#pod.id)
    this.#activeNoteId = id
    this.#saveToStorage()
    this.#broadcastState()
    this.#render()
    this.#els.titleInput.focus()
  }

  #deleteActiveNote() {
    if (!this.#activeNoteId) return
    this.#crdt.delete(this.#activeNoteId, this.#pod.id)
    this.#activeNoteId = null
    this.#saveToStorage()
    this.#broadcastState()
    this.#render()
  }

  #onEdit() {
    if (!this.#activeNoteId) return
    // Debounce saves
    clearTimeout(this.#saveTimeout)
    this.#saveTimeout = setTimeout(() => {
      const note = {
        id: this.#activeNoteId,
        title: this.#els.titleInput.value,
        content: this.#els.contentTextarea.value,
        updated: Date.now(),
      }
      this.#crdt.set(this.#activeNoteId, note, this.#pod.id)
      this.#saveToStorage()
      this.#broadcastState()
      this.#renderNotesList()
    }, 300)
  }

  // -- Rendering --

  #render() {
    this.#renderNotesList()
    this.#renderEditor()
  }

  #renderNotesList() {
    const notes = this.#crdt.entries()
      .map(([id, note]) => ({ id, ...note }))
      .sort((a, b) => b.updated - a.updated)

    this.#els.notesList.innerHTML = ''

    for (const note of notes) {
      const btn = document.createElement('button')
      btn.className = `note-item${note.id === this.#activeNoteId ? ' active' : ''}`
      btn.innerHTML = `
        <div class="note-item-title">${this.#escapeHtml(note.title) || 'Untitled'}</div>
        <div class="note-item-preview">${this.#escapeHtml(note.content?.slice(0, 60)) || 'Empty note'}</div>
        <div class="note-item-meta">
          <span>${this.#timeAgo(note.updated)}</span>
        </div>
      `
      btn.addEventListener('click', () => {
        this.#activeNoteId = note.id
        this.#render()
      })
      this.#els.notesList.appendChild(btn)
    }
  }

  #renderEditor() {
    if (!this.#activeNoteId || !this.#crdt.has(this.#activeNoteId)) {
      this.#els.editorEmpty.style.display = 'flex'
      this.#els.editorActive.style.display = 'none'
      return
    }

    this.#els.editorEmpty.style.display = 'none'
    this.#els.editorActive.style.display = 'flex'

    const note = this.#crdt.get(this.#activeNoteId)

    // Only update if the values differ (avoid clobbering cursor position)
    if (this.#els.titleInput.value !== note.title) {
      this.#els.titleInput.value = note.title
    }
    if (this.#els.contentTextarea.value !== note.content) {
      this.#els.contentTextarea.value = note.content
    }

    this.#els.editorMeta.textContent = `Last edited: ${this.#timeAgo(note.updated)}`
  }

  // -- Helpers --

  #escapeHtml(str) {
    if (!str) return ''
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  #timeAgo(ts) {
    const seconds = Math.floor((Date.now() - ts) / 1000)
    if (seconds < 5) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }
}

// Boot
new NotesApp()
