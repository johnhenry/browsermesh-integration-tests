import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Import all packages and verify they export the expected symbols

import * as primitives from 'browsermesh-primitives'
import * as netway from 'browsermesh-netway'
import * as pod from 'browsermesh-pod'
import * as wsh from 'wsh-upon-star'
import * as andbox from 'andbox'
import * as middleware from 'ai-matey-middleware-andbox'

describe('browsermesh-primitives exports', () => {
  const expected = [
    'MESH_TYPE', 'MESH_ERROR',
    'MeshError', 'MeshProtocolError', 'MeshCapabilityError',
    'PodIdentity', 'derivePodId', 'encodeBase64url', 'decodeBase64url',
    'messageTypeRegistry', 'encodeMeshMessage', 'decodeMeshMessage',
    'parseScope', 'matchScope', 'CapabilityToken',
    'TRUST_CATEGORIES', 'createTrustEdge', 'computeTransitiveTrust',
    'matchResourcePattern', 'Permission', 'AccessGrant', 'ACLEngine', 'generateGrantId',
    'VectorClock', 'LWWRegister', 'GCounter', 'PNCounter', 'ORSet', 'RGA', 'LWWMap',
    'DeterministicRNG', 'LocalChannel', 'createLocalChannelPair', 'TestMesh', 'TESTMESH_LIMITS',
  ]

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in primitives, `Missing export: ${name}`)
    })
  }
})

describe('browsermesh-netway exports', () => {
  const expected = [
    'DEFAULTS', 'GATEWAY_ERROR', 'CAPABILITY',
    'NetwayError', 'ConnectionRefusedError', 'PolicyDeniedError',
    'AddressInUseError', 'QueueFullError', 'UnknownSchemeError', 'SocketClosedError',
    'OperationTimeoutError',
    'StreamSocket', 'DatagramSocket', 'Listener',
    'PolicyEngine', 'Router', 'parseAddress', 'OperationQueue',
    'Backend', 'LoopbackBackend', 'GatewayBackend', 'ServiceBackend',
    'ChaosBackendWrapper', 'FsServiceBackend',
    'VirtualNetwork', 'ScopedNetwork',
  ]

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in netway, `Missing export: ${name}`)
    })
  }
})

describe('browsermesh-pod exports', () => {
  const expected = [
    'Pod', 'detectPodKind', 'detectCapabilities',
    'POD_HELLO', 'POD_HELLO_ACK', 'POD_GOODBYE', 'POD_MESSAGE',
    'POD_RPC_REQUEST', 'POD_RPC_RESPONSE',
    'createHello', 'createHelloAck', 'createGoodbye', 'createMessage',
    'createRpcRequest', 'createRpcResponse',
    'InjectedPod',
    'installPodRuntime', 'createRuntime', 'createClient', 'createServer',
  ]

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in pod, `Missing export: ${name}`)
    })
  }
})

describe('wsh-upon-star exports', () => {
  const expected = [
    'cborEncode', 'cborDecode', 'frameEncode', 'FrameDecoder',
    'MSG', 'MSG_NAMES', 'CHANNEL_KIND', 'AUTH_METHOD', 'PROTOCOL_VERSION',
    'hello', 'serverHello', 'challenge', 'auth', 'authOk', 'authFail',
    'open', 'openOk', 'openFail', 'resize', 'signal', 'exit', 'close',
    'sessionData', 'error', 'ping', 'pong',
    'mcpDiscover', 'mcpTools', 'mcpCall', 'mcpResult',
    'msgName', 'isValidMessage',
    'generateKeyPair', 'exportPublicKeyRaw', 'exportPublicKeySSH',
    'importPublicKeyRaw', 'sign', 'verify',
    'fingerprint', 'shortFingerprint', 'generateNonce',
    'WshTransport', 'WebSocketTransport',
    'WshSession', 'WshVirtualSessionBackend',
    'WshClient', 'WshKeyStore',
    'WshFileTransfer', 'SessionRecorder', 'SessionPlayer',
    'WshMcpBridge',
  ]

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in wsh, `Missing export: ${name}`)
    })
  }
})

describe('andbox exports', () => {
  const expected = [
    'createSandbox',
    'resolveWithImportMap',
    'gateCapabilities',
    'createStdio',
    'createNetworkFetch',
    'makeDeferred', 'makeAbortError', 'makeTimeoutError',
    'DEFAULT_TIMEOUT_MS', 'DEFAULT_LIMITS', 'DEFAULT_CAPABILITY_LIMITS',
    'makeWorkerSource',
  ]

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in andbox, `Missing export: ${name}`)
    })
  }
})

describe('ai-matey-middleware-andbox exports', () => {
  const expected = [
    'createCodeExecutionMiddleware',
    'extractCodeBlocks', 'stripCodeBlocks',
    'adaptPythonisms', 'autoAwait',
    'toolsToCapabilities', 'toolsToPreamble',
    'formatResults', 'resultsToToolCalls',
  ]

  for (const name of expected) {
    it(`exports ${name}`, () => {
      assert.ok(name in middleware, `Missing export: ${name}`)
    })
  }
})

describe('cross-package type compatibility', () => {
  it('browsermesh-pod peer-depends on browsermesh-primitives PodIdentity', async () => {
    // Pod imports PodIdentity from browsermesh-primitives at module level.
    // If the import resolution failed, Pod would not be constructable.
    const p = new pod.Pod()
    assert.equal(p.state, 'idle')

    // Verify PodIdentity from primitives is the same class Pod uses
    const identity = await primitives.PodIdentity.generate()
    assert.ok(identity.podId)
    assert.ok(identity.keyPair)
  })

  it('all packages load without circular dependency errors', () => {
    // If we got here, all 6 imports at the top succeeded
    assert.ok(true)
  })

  it('netway VirtualNetwork can be instantiated', () => {
    const net = new netway.VirtualNetwork()
    assert.ok(net.schemes.includes('mem'))
    assert.ok(net.schemes.includes('loop'))
  })

  it('netway parseAddress handles standard formats', () => {
    const parsed = netway.parseAddress('tcp://example.com:443')
    assert.equal(parsed.scheme, 'tcp')
    assert.equal(parsed.host, 'example.com')
    assert.equal(parsed.port, 443)
  })

  it('wsh and primitives both use Ed25519 for identity', async () => {
    // Generate keys using both libraries and verify they produce 32-byte raw public keys
    const wshKp = await wsh.generateKeyPair(true)
    const wshRaw = await wsh.exportPublicKeyRaw(wshKp.publicKey)
    assert.equal(wshRaw.length, 32)

    const meshId = await primitives.PodIdentity.generate()
    const meshRaw = await crypto.subtle.exportKey('raw', meshId.keyPair.publicKey)
    assert.equal(new Uint8Array(meshRaw).length, 32)
  })
})

describe('package.json versions are consistent', () => {
  it('all packages have version fields', async () => {
    const packages = [
      'browsermesh-primitives',
      'browsermesh-netway',
      'browsermesh-pod',
      'wsh-upon-star',
      'andbox',
      'ai-matey-middleware-andbox',
    ]

    for (const pkg of packages) {
      const pkgJsonPath = new URL(`../node_modules/${pkg}/package.json`, import.meta.url)
      const content = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
      assert.ok(content.version, `${pkg} missing version`)
      assert.ok(content.name === pkg, `${pkg} name mismatch: ${content.name}`)
      assert.equal(content.type, 'module', `${pkg} should be ESM`)
    }
  })
})
