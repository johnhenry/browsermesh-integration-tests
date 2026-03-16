# Decentralized Chat

A working demo of decentralized browser chat using [BrowserMesh](https://github.com/nicholasgasior/browsermesh) patterns. No server, no database, no accounts. Open a few tabs and talk.

## What it demonstrates

- **BroadcastChannel messaging** — chat messages propagate between same-origin tabs with zero network I/O
- **Pod-style identity** — each tab gets a random `podId` (a UUID), simulating a BrowserMesh Pod
- **Presence tracking** — periodic heartbeats detect who is online; stale peers are swept automatically
- **Typing indicators** — input events broadcast "typing" status via the presence channel
- **Departure detection** — `beforeunload` announces departure; stale-peer sweep handles crashed tabs

## How to run

Any static file server works. For example:

```bash
npx serve .
```

Then open `http://localhost:3000` in two or three tabs. Pick a username in each tab and start chatting.

## Architecture

```
Tab A (Pod A)                Tab B (Pod B)
  app.mjs                      app.mjs
    |                            |
    +--- BroadcastChannel: decentralized-chat:messages ---+
    |                            |
    +--- BroadcastChannel: decentralized-chat:presence ---+
```

Each tab maintains:
- An in-memory message array (no persistence by design)
- A peer map tracking online users and their last heartbeat
- Two BroadcastChannels: one for chat messages, one for presence

Messages use a simple wire format:

```json
{ "type": "chat", "id": "uuid", "sender": "pod-id", "senderName": "Alice", "text": "hello", "timestamp": 1234567890 }
```

Presence uses:

```json
{ "type": "presence", "podId": "pod-id", "name": "Alice", "status": "online|typing|offline", "timestamp": 1234567890 }
```

## Packages referenced

This example demonstrates patterns from the BrowserMesh ecosystem:

| Package | Concept used |
|---------|-------------|
| **browsermesh-primitives** | Wire format conventions, identity (pod IDs), membership tracking |
| **browsermesh-pod** | Pod lifecycle (init, heartbeat, teardown), BroadcastChannel discovery |

## Limitations

- Same-origin only (BroadcastChannel does not cross origins). For cross-origin, you would add WebRTC via a BrowserMesh relay.
- Messages are ephemeral. Close all tabs and the history is gone. This is intentional.
- No encryption in this demo. The full BrowserMesh spec includes AES-GCM room keys and Ed25519 message signatures.

## License

MIT
