# Collaborative Code Sandbox

A browser-native collaborative code editor with sandboxed execution. Open it in multiple tabs and code together in real time.

## What This Demonstrates

This example app showcases BrowserMesh patterns using pure browser APIs:

- **Pod lifecycle** — Each tab creates a `SandboxPod` with a unique identity. Pods announce themselves, track peers, and clean up on shutdown.
- **Real-time sync** — Code edits broadcast to all connected tabs via `BroadcastChannel`, simulating the CRDT sync layer a `SharedWorkerPod` would provide.
- **Sandboxed execution** — Code runs inside a short-lived `Worker` (simulating a `WorkerPod`) with restricted capabilities: no `fetch`, no `WebSocket`, no `indexedDB`. The worker is terminated after execution or on timeout.
- **Session protocol** — The announce/heartbeat/cleanup cycle mirrors the session handshake and keepalive patterns from the @johnhenry/wsh protocol.

## Packages Referenced

| Package | Role in this demo |
|---------|-------------------|
| **andbox** | Concept: sandboxed code execution in isolated workers |
| **browsermesh-primitives** | Concept: wire format, CRDTs for shared document state |
| **browsermesh-pod** | Concept: Pod identity, lifecycle (boot/running/stopped) |
| **@johnhenry/wsh** | Concept: session announce, heartbeat, peer tracking |

## How to Run

```bash
# Option 1: any static file server
npx serve .

# Option 2: Python
python3 -m http.server 8080

# Option 3: just open the file
open index.html
```

Then open the URL in two or more browser tabs.

## Usage

1. **Edit code** in the left pane — changes sync to other open tabs instantly
2. **Click Run** (or press `Ctrl+Enter` / `Cmd+Enter`) to execute in a sandboxed worker
3. **See output** in the right pane — console.log, return values, errors, and timing
4. **Watch the tab counter** in the toolbar update as you open/close tabs

## Security Model

Each code execution runs in a fresh Web Worker with:
- No network access (`fetch`, `XMLHttpRequest`, `WebSocket` are blocked)
- No storage access (`indexedDB`, `caches` are removed)
- 5-second timeout with automatic termination
- Blob URL revoked after execution

This mirrors the BrowserMesh `WorkerPod` pattern where each execution pod gets minimal capabilities and is destroyed after use.

## License

MIT
