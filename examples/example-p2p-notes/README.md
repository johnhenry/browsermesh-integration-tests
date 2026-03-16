# P2P Encrypted Notes

A peer-to-peer note-taking app that syncs across browser tabs without any server. Built as a flagship example of [BrowserMesh](https://github.com/nicholasgasior/browsermesh) concepts: CRDTs for conflict-free state, pod identity, and peer discovery over BroadcastChannel.

## Quick Start

Serve the directory with any static file server:

```bash
npx serve .
```

Open `http://localhost:3000` in two (or more) browser tabs. Notes created or edited in one tab appear in all others in real time.

## What This Demonstrates

| BrowserMesh Concept | Implementation in This App |
|---|---|
| **browsermesh-primitives: LWWMap CRDT** | `LWWMap` class — last-writer-wins map with per-entry timestamps and tie-breaking by peer ID. Supports merge, tombstone deletes, and full state export for sync. |
| **browsermesh-primitives: Wire format** | Sync messages are structured `{ type, peerId, entries, timestamp }` objects sent over BroadcastChannel (structured clone). |
| **browsermesh-pod: Pod identity** | `Pod` class — generates a random hex identity on first use, persists it in localStorage. Simulates the Ed25519 fingerprint a real pod would derive from WebAuthn. |
| **browsermesh-pod: Peer discovery** | `PeerChannel` class — uses `BroadcastChannel` for same-origin tab discovery with heartbeat/presence and automatic full-state sync on peer join. |
| **browsermesh-pod: Pod lifecycle** | Pod is created once per tab, identity restored on reload, channel cleaned up on unload. |

## Architecture

```
┌──────────────┐    BroadcastChannel     ┌──────────────┐
│   Tab A      │◄───────────────────────►│   Tab B      │
│              │    "p2p-notes-mesh"      │              │
│  Pod (id:a1) │                         │  Pod (id:b2) │
│  LWWMap      │   sync messages:        │  LWWMap      │
│  PeerChannel │   hello / sync          │  PeerChannel │
│  NotesApp    │                         │  NotesApp    │
└──────────────┘                         └──────────────┘
       │                                        │
       └──── localStorage (persistence) ────────┘
```

Each tab runs its own `Pod` with a unique identity. The `PeerChannel` broadcasts heartbeats every 3 seconds. When a new peer appears, both sides exchange their full CRDT state. The `LWWMap` merges incoming entries by timestamp, so edits converge automatically.

Notes are persisted to `localStorage` as serialized CRDT entries (including tombstones for deletes), so they survive page reloads.

## How Sync Works

1. **Discovery**: Tabs announce themselves via `hello` messages on the `p2p-notes-mesh` BroadcastChannel.
2. **Full sync on join**: When a new peer is detected, the local tab pushes its entire CRDT state.
3. **Incremental sync on edit**: Every note edit broadcasts the full state (sufficient for this demo scale).
4. **Merge**: `LWWMap.mergeEntry()` compares timestamps. Latest write wins. Equal timestamps are broken by peer ID comparison.
5. **Tombstones**: Deletes are recorded with `deleted: true` so they propagate correctly.

## Extending This Example

To evolve this toward a production BrowserMesh app, you would:

- Replace `BroadcastChannel` with WebRTC DataChannels for cross-device sync
- Replace the random hex Pod ID with WebAuthn-attested Ed25519 identity
- Add Noise IK encrypted sessions between paired devices
- Derive per-note encryption keys via HD key derivation from a root secret
- Add vector clocks for more efficient delta sync
- Use CBOR wire format instead of JSON structured clone

See the [full spec](https://github.com/nicholasgasior/browsermesh/blob/main/docs/examples/03-p2p-encrypted-notes.md) for the complete architecture.

## License

MIT
