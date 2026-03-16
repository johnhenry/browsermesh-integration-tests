import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  Pod, detectPodKind, detectCapabilities,
  POD_HELLO, POD_HELLO_ACK, POD_GOODBYE, POD_MESSAGE,
  POD_RPC_REQUEST, POD_RPC_RESPONSE,
  createHello, createHelloAck, createGoodbye, createMessage,
  createRpcRequest, createRpcResponse,
} from 'browsermesh-pod'

import {
  PodIdentity, MESH_TYPE, encodeMeshMessage, decodeMeshMessage,
  CapabilityToken, matchScope,
} from 'browsermesh-primitives'

describe('Pod uses PodIdentity from primitives', () => {
  it('Pod can be instantiated and starts in idle state', () => {
    const pod = new Pod()
    assert.equal(pod.state, 'idle')
    assert.equal(pod.podId, null)
    assert.equal(pod.identity, null)
    assert.equal(pod.role, 'autonomous')
  })

  it('Pod boots with a pre-generated PodIdentity', async () => {
    const identity = await PodIdentity.generate()
    const pod = new Pod()

    // Provide a minimal globalThis stub for Node.js (no BroadcastChannel)
    const fakeGlobal = {
      ...globalThis,
      BroadcastChannel: class {
        constructor() {}
        postMessage() {}
        close() {}
        set onmessage(_) {}
      },
    }

    await pod.boot({
      identity,
      globalThis: fakeGlobal,
      handshakeTimeout: 0,
      discoveryTimeout: 0,
    })

    assert.equal(pod.state, 'ready')
    assert.equal(pod.podId, identity.podId)
    assert.ok(pod.podId.length > 10)
    assert.strictEqual(pod.identity, identity)
  })

  it('Pod generates its own identity when none is provided', async () => {
    const pod = new Pod()
    const fakeGlobal = {
      ...globalThis,
      BroadcastChannel: class {
        constructor() {}
        postMessage() {}
        close() {}
        set onmessage(_) {}
      },
    }

    await pod.boot({
      globalThis: fakeGlobal,
      handshakeTimeout: 0,
      discoveryTimeout: 0,
    })

    assert.equal(pod.state, 'ready')
    assert.ok(pod.podId)
    assert.ok(pod.identity instanceof PodIdentity)
  })
})

describe('Pod message factories produce valid structures', () => {
  it('createHello includes all required fields', () => {
    const msg = createHello({ podId: 'pod-1', kind: 'window', capabilities: { worker: true } })
    assert.equal(msg.type, POD_HELLO)
    assert.equal(msg.podId, 'pod-1')
    assert.equal(msg.kind, 'window')
    assert.deepEqual(msg.capabilities, { worker: true })
    assert.ok(typeof msg.ts === 'number')
  })

  it('createHelloAck includes targetPodId', () => {
    const msg = createHelloAck({ podId: 'pod-2', kind: 'worker', targetPodId: 'pod-1' })
    assert.equal(msg.type, POD_HELLO_ACK)
    assert.equal(msg.targetPodId, 'pod-1')
  })

  it('createGoodbye produces a departure message', () => {
    const msg = createGoodbye({ podId: 'pod-1' })
    assert.equal(msg.type, POD_GOODBYE)
    assert.equal(msg.podId, 'pod-1')
  })

  it('createMessage carries arbitrary payload', () => {
    const msg = createMessage({ from: 'a', to: 'b', payload: { data: [1, 2, 3] } })
    assert.equal(msg.type, POD_MESSAGE)
    assert.equal(msg.from, 'a')
    assert.equal(msg.to, 'b')
    assert.deepEqual(msg.payload, { data: [1, 2, 3] })
  })

  it('createRpcRequest / createRpcResponse form a matching pair', () => {
    const req = createRpcRequest({ from: 'a', to: 'b', method: 'ping', params: {}, requestId: 'req-1' })
    assert.equal(req.type, POD_RPC_REQUEST)
    assert.equal(req.method, 'ping')
    assert.equal(req.requestId, 'req-1')

    const res = createRpcResponse({ from: 'b', to: 'a', requestId: 'req-1', result: 'pong' })
    assert.equal(res.type, POD_RPC_RESPONSE)
    assert.equal(res.requestId, req.requestId)
    assert.equal(res.result, 'pong')
    assert.equal(res.error, null)
  })
})

describe('Pod + primitives wire format interop', () => {
  it('Pod messages can be wrapped in mesh wire format', async () => {
    const identity = await PodIdentity.generate()
    const podMessage = createMessage({ from: identity.podId, to: '*', payload: { text: 'hello' } })

    // Wrap the pod message as the payload of a mesh BROADCAST
    const wireMsg = {
      type: MESH_TYPE.BROADCAST,
      from: identity.podId,
      payload: podMessage,
    }

    const bytes = encodeMeshMessage(wireMsg)
    const decoded = decodeMeshMessage(bytes)

    assert.equal(decoded.type, MESH_TYPE.BROADCAST)
    assert.equal(decoded.from, identity.podId)
    assert.equal(decoded.payload.type, POD_MESSAGE)
    assert.equal(decoded.payload.from, identity.podId)
    assert.deepEqual(decoded.payload.payload, { text: 'hello' })
  })

  it('CapabilityToken can gate pod operations', async () => {
    const identity = await PodIdentity.generate()

    const token = new CapabilityToken({
      issuer: 'mesh-root',
      subject: identity.podId,
      scopes: ['mesh:pod:send', 'mesh:pod:receive'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    // Verify the token grants the expected capabilities
    assert.ok(token.covers('mesh:pod:send'))
    assert.ok(token.covers('mesh:pod:receive'))
    assert.ok(!token.covers('mesh:pod:admin'))
    assert.ok(!token.isExpired())
  })
})

describe('detectPodKind in Node.js', () => {
  it('detects server environment in Node.js', () => {
    const kind = detectPodKind()
    assert.equal(kind, 'server')
  })

  it('detects window when given a mock with window and document', () => {
    const fakeGlobal = {
      window: {},
      document: {},
    }
    fakeGlobal.window.parent = fakeGlobal.window // top-level
    const kind = detectPodKind(fakeGlobal)
    assert.equal(kind, 'window')
  })

  it('detects iframe when window !== parent', () => {
    const fakeGlobal = {
      window: {},
      document: {},
    }
    fakeGlobal.window.parent = {} // different parent
    const kind = detectPodKind(fakeGlobal)
    assert.equal(kind, 'iframe')
  })
})
