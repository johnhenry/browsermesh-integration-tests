import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MESH_TYPE, MESH_ERROR,
  encodeMeshMessage, decodeMeshMessage, messageTypeRegistry,
  PodIdentity, derivePodId, encodeBase64url, decodeBase64url,
  parseScope, matchScope, CapabilityToken,
  VectorClock, LWWRegister, GCounter, PNCounter, ORSet, LWWMap,
  MeshError, MeshProtocolError, MeshCapabilityError,
} from 'browsermesh-primitives'

describe('wire format encode/decode roundtrip', () => {
  it('roundtrips a UNICAST message', () => {
    const original = {
      type: MESH_TYPE.UNICAST,
      from: 'pod-alice',
      to: 'pod-bob',
      payload: { greeting: 'hello mesh' },
      ttl: 60,
    }
    const bytes = encodeMeshMessage(original)
    assert.ok(bytes instanceof Uint8Array)
    assert.ok(bytes.length > 5)
    assert.equal(bytes[0], MESH_TYPE.UNICAST)

    const decoded = decodeMeshMessage(bytes)
    assert.equal(decoded.type, MESH_TYPE.UNICAST)
    assert.equal(decoded.from, 'pod-alice')
    assert.equal(decoded.to, 'pod-bob')
    assert.deepEqual(decoded.payload, { greeting: 'hello mesh' })
    assert.equal(decoded.ttl, 60)
  })

  it('roundtrips a BROADCAST message with no recipient', () => {
    const original = {
      type: MESH_TYPE.BROADCAST,
      from: 'pod-charlie',
      payload: [1, 2, 3],
    }
    const bytes = encodeMeshMessage(original)
    const decoded = decodeMeshMessage(bytes)
    assert.equal(decoded.type, MESH_TYPE.BROADCAST)
    assert.equal(decoded.from, 'pod-charlie')
    assert.equal(decoded.to, undefined)
    assert.deepEqual(decoded.payload, [1, 2, 3])
  })

  it('roundtrips every known message type code', () => {
    for (const [name, code] of Object.entries(MESH_TYPE)) {
      const bytes = encodeMeshMessage({
        type: code,
        from: 'test',
        payload: { msgType: name },
      })
      const decoded = decodeMeshMessage(bytes)
      assert.equal(decoded.type, code, `Failed for ${name}`)
      assert.equal(decoded.payload.msgType, name)
    }
  })

  it('rejects unknown message type codes', () => {
    assert.throws(() => encodeMeshMessage({ type: 0x00, from: 'x', payload: null }), MeshProtocolError)
  })

  it('rejects truncated bytes', () => {
    const bytes = encodeMeshMessage({ type: MESH_TYPE.PING, from: 'x', payload: null })
    assert.throws(() => decodeMeshMessage(bytes.subarray(0, 3)), MeshProtocolError)
  })

  it('messageTypeRegistry covers all MESH_TYPE entries', () => {
    const typeCount = Object.keys(MESH_TYPE).length
    assert.equal(messageTypeRegistry.size, typeCount)
    for (const [name, code] of Object.entries(MESH_TYPE)) {
      assert.ok(messageTypeRegistry.has(code), `Missing registry entry for ${name}`)
    }
  })
})

describe('identity — base64url encoding', () => {
  it('roundtrips arbitrary bytes through base64url', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 62, 63])
    const encoded = encodeBase64url(original)
    assert.ok(typeof encoded === 'string')
    // base64url has no padding or + or /
    assert.ok(!encoded.includes('+'))
    assert.ok(!encoded.includes('/'))
    assert.ok(!encoded.includes('='))
    const decoded = decodeBase64url(encoded)
    assert.deepEqual(decoded, original)
  })

  it('handles empty input', () => {
    const encoded = encodeBase64url(new Uint8Array([]))
    assert.equal(encoded, '')
    const decoded = decodeBase64url('')
    assert.equal(decoded.length, 0)
  })
})

describe('identity — PodIdentity generation', () => {
  it('generates unique identities with valid podId strings', async () => {
    const id1 = await PodIdentity.generate()
    const id2 = await PodIdentity.generate()

    assert.ok(id1.podId.length > 0)
    assert.ok(id2.podId.length > 0)
    assert.notEqual(id1.podId, id2.podId)
    assert.ok(id1.keyPair.publicKey)
    assert.ok(id1.keyPair.privateKey)
  })

  it('signs and verifies data correctly', async () => {
    const identity = await PodIdentity.generate()
    const data = new TextEncoder().encode('hello mesh world')
    const signature = await identity.sign(data)

    assert.ok(signature instanceof Uint8Array)
    assert.ok(signature.length > 0)

    const valid = await PodIdentity.verify(identity.keyPair.publicKey, data, signature)
    assert.equal(valid, true)

    // tampered data should fail verification
    const tampered = new TextEncoder().encode('tampered data')
    const invalid = await PodIdentity.verify(identity.keyPair.publicKey, tampered, signature)
    assert.equal(invalid, false)
  })

  it('derivePodId produces same ID for same public key', async () => {
    const identity = await PodIdentity.generate()
    const id1 = await derivePodId(identity.keyPair.publicKey)
    const id2 = await derivePodId(identity.keyPair.publicKey)
    assert.equal(id1, id2)
    assert.equal(id1, identity.podId)
  })
})

describe('capability scope parsing and matching', () => {
  it('parses a fully-qualified scope', () => {
    const parsed = parseScope('mesh:crdt:write')
    assert.deepEqual(parsed, { namespace: 'mesh', resource: 'crdt', action: 'write' })
  })

  it('parses partial scopes with wildcard defaults', () => {
    const parsed = parseScope('mesh')
    assert.deepEqual(parsed, { namespace: 'mesh', resource: '*', action: '*' })
  })

  it('wildcard scope matches everything', () => {
    assert.ok(matchScope('*:*:*', 'mesh:crdt:write'))
    assert.ok(matchScope('mesh:*:*', 'mesh:crdt:write'))
    assert.ok(matchScope('mesh:crdt:*', 'mesh:crdt:write'))
  })

  it('exact scope matches only itself', () => {
    assert.ok(matchScope('mesh:crdt:write', 'mesh:crdt:write'))
    assert.ok(!matchScope('mesh:crdt:read', 'mesh:crdt:write'))
    assert.ok(!matchScope('net:crdt:write', 'mesh:crdt:write'))
  })
})

describe('CapabilityToken', () => {
  it('checks expiry correctly', () => {
    const token = new CapabilityToken({
      issuer: 'alice', subject: 'bob',
      scopes: ['mesh:crdt:*'],
      expiresAt: 1000,
    })
    assert.equal(token.isExpired(999), false)
    assert.equal(token.isExpired(1000), true)
    assert.equal(token.isExpired(1001), true)
  })

  it('covers checks scope matching', () => {
    const token = new CapabilityToken({
      issuer: 'alice', subject: 'bob',
      scopes: ['mesh:crdt:*', 'net:socket:read'],
      expiresAt: 0,
    })
    assert.ok(token.covers('mesh:crdt:write'))
    assert.ok(token.covers('mesh:crdt:read'))
    assert.ok(token.covers('net:socket:read'))
    assert.ok(!token.covers('net:socket:write'))
  })

  it('serializes to JSON without signature', () => {
    const token = new CapabilityToken({
      issuer: 'a', subject: 'b',
      scopes: ['*:*:*'], expiresAt: 9999,
      signature: new Uint8Array([1, 2, 3]),
    })
    const json = token.toJSON()
    assert.equal(json.issuer, 'a')
    assert.equal(json.subject, 'b')
    assert.deepEqual(json.scopes, ['*:*:*'])
    assert.equal(json.expiresAt, 9999)
    assert.ok(!('signature' in json))
  })
})

describe('CRDT merge operations', () => {
  it('VectorClock merges take max of each entry', () => {
    const a = new VectorClock().increment('A').increment('A').increment('B')
    const b = new VectorClock().increment('B').increment('B').increment('C')

    assert.equal(a.get('A'), 2)
    assert.equal(b.get('B'), 2)

    const merged = a.merge(b)
    assert.equal(merged.get('A'), 2)
    assert.equal(merged.get('B'), 2) // max(1, 2)
    assert.equal(merged.get('C'), 1)
  })

  it('VectorClock compare detects causal ordering', () => {
    const a = new VectorClock().increment('A')
    const b = new VectorClock().increment('A').increment('B')

    assert.equal(a.compare(b), 'before')
    assert.equal(b.compare(a), 'after')
    assert.equal(a.compare(a), 'equal')

    const c = new VectorClock().increment('C')
    assert.equal(a.compare(c), 'concurrent')
  })

  it('VectorClock roundtrips through JSON', () => {
    const original = new VectorClock().increment('X').increment('X').increment('Y')
    const json = original.toJSON()
    const restored = VectorClock.fromJSON(json)
    assert.equal(restored.get('X'), 2)
    assert.equal(restored.get('Y'), 1)
    assert.equal(original.compare(restored), 'equal')
  })

  it('GCounter increments and merges correctly', () => {
    const a = new GCounter()
    const b = new GCounter()

    a.increment('A', 3)
    b.increment('B', 5)

    assert.equal(a.value, 3)
    assert.equal(b.value, 5)

    const merged = a.merge(b)
    assert.equal(merged.value, 8)
  })

  it('PNCounter supports increment and decrement', () => {
    const c = new PNCounter()
    c.increment('node1', 10)
    c.decrement('node1', 3)
    assert.equal(c.value, 7)
  })

  it('ORSet add/remove with merge', () => {
    const a = new ORSet('A')
    const b = new ORSet('B')

    a.add('x')
    a.add('y')
    b.add('y')
    b.add('z')

    const merged = a.merge(b)
    assert.ok(merged.has('x'))
    assert.ok(merged.has('y'))
    assert.ok(merged.has('z'))
  })

  it('LWWMap set/get with merge', () => {
    const a = new LWWMap('A')
    const b = new LWWMap('B')

    a.set('key', 'from-a', 1)
    b.set('key', 'from-b', 2)

    const merged = a.merge(b)
    assert.equal(merged.get('key'), 'from-b') // later timestamp wins
  })
})

describe('error hierarchy', () => {
  it('MeshProtocolError extends MeshError', () => {
    const err = new MeshProtocolError('test')
    assert.ok(err instanceof MeshError)
    assert.ok(err instanceof Error)
    assert.equal(err.message, 'test')
  })

  it('MeshCapabilityError extends MeshError', () => {
    const err = new MeshCapabilityError('denied')
    assert.ok(err instanceof MeshError)
  })

  it('MESH_ERROR codes are all distinct numbers', () => {
    const values = Object.values(MESH_ERROR)
    const unique = new Set(values)
    assert.equal(values.length, unique.size)
  })
})
