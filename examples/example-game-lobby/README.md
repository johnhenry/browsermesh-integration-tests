# Multiplayer Game Lobby — BrowserMesh Example

A peer-to-peer tic-tac-toe game that runs entirely in the browser. No server, no build step — just open `index.html` in two tabs and play.

## What This Demonstrates

- **BroadcastChannel as transport** — same-origin tabs discover and communicate without a server
- **Pod-style identity** — each tab gets a unique pod ID (UUID) representing a player
- **VectorClock for causal ordering** — moves carry vector clock metadata for conflict resolution
- **Host/guest architecture** — the room creator is the authoritative host; the joiner is the guest
- **Host migration** — if the host disconnects (tab closed), the guest automatically promotes itself to host via heartbeat detection
- **Signed move log** — every move is recorded with player ID, cell, turn number, and timestamp for a verifiable game history

## How to Run

```bash
# Any static file server works. Examples:
npx serve .
python3 -m http.server 8000
```

Open `http://localhost:8000` (or whatever port) in **two browser tabs**.

1. **Tab 1**: Enter a name, click **Create Room**. Copy the Room ID.
2. **Tab 2**: Enter a name, click **Join Room**, paste the Room ID, click **Join**.
3. The host clicks **Start Game** and you're playing tic-tac-toe.

## BrowserMesh Packages Used (Conceptually)

This example is a standalone demo that implements the patterns from:

| Package | Concept Used |
|---------|-------------|
| `browsermesh-primitives` | Wire format (structured messages), identity (pod IDs), `VectorClock` for turn ordering |
| `browsermesh-pod` | Pod lifecycle (create/join/leave), discovery via BroadcastChannel, host migration |
| `browsermesh-netway` | Virtual networking — BroadcastChannel as the same-origin transport layer |

## Architecture

```
Tab 1 (Host)                    Tab 2 (Guest)
┌─────────────┐                ┌─────────────┐
│  Pod (X)    │◄──Broadcast──►│  Pod (O)    │
│  GameState  │   Channel      │  GameState  │
│  MoveLog    │                │  MoveLog    │
│  Host=true  │                │  Host=false │
└─────────────┘                └─────────────┘
```

Messages flow over `BroadcastChannel("game-lobby:<roomId>")`. The host validates moves and both sides maintain a replicated game state.

## File Structure

```
index.html    — single-page app with lobby + game views
app.mjs       — all game logic: lobby, messaging, state, host migration
styles.css    — dark-themed game UI
```

## License

MIT
