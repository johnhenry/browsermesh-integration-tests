import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  cborEncode, cborDecode, frameEncode, FrameDecoder,
  MSG, MSG_NAMES, CHANNEL_KIND, AUTH_METHOD, PROTOCOL_VERSION,
  hello, serverHello, challenge, auth, authOk, authFail,
  open, openOk, openFail, resize, signal, exit, close, sessionData,
  error, ping, pong, mcpDiscover, mcpTools, mcpCall, mcpResult,
  msgName, isValidMessage,
  generateKeyPair, exportPublicKeyRaw, sign, verify,
  fingerprint, generateNonce,
} from 'wsh-upon-star'

describe('CBOR encode/decode roundtrip', () => {
  it('roundtrips primitive types', () => {
    const values = [0, 1, -1, 42, -100, 3.14, true, false, null, '', 'hello']
    for (const val of values) {
      const encoded = cborEncode(val)
      assert.ok(encoded instanceof Uint8Array)
      const decoded = cborDecode(encoded)
      assert.deepEqual(decoded, val, `Failed for value: ${val}`)
    }
  })

  it('roundtrips arrays', () => {
    const arr = [1, 'two', true, null, [3, 4]]
    const decoded = cborDecode(cborEncode(arr))
    assert.deepEqual(decoded, arr)
  })

  it('roundtrips objects (maps)', () => {
    const obj = { type: 1, channel: 0, data: 'hello', nested: { a: true } }
    const decoded = cborDecode(cborEncode(obj))
    assert.deepEqual(decoded, obj)
  })

  it('roundtrips Uint8Array (byte strings)', () => {
    const bytes = new Uint8Array([0, 1, 128, 255])
    const decoded = cborDecode(cborEncode(bytes))
    assert.ok(decoded instanceof Uint8Array)
    assert.deepEqual(decoded, bytes)
  })

  it('handles large payloads', () => {
    const big = { data: 'x'.repeat(100000), count: 999999 }
    const decoded = cborDecode(cborEncode(big))
    assert.equal(decoded.data.length, 100000)
    assert.equal(decoded.count, 999999)
  })
})

describe('frame encode/decode', () => {
  it('frameEncode wraps CBOR with 4-byte length prefix', () => {
    const payload = { type: MSG.PING }
    const framed = frameEncode(payload)
    assert.ok(framed instanceof Uint8Array)
    // First 4 bytes are big-endian length
    const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength)
    const payloadLen = view.getUint32(0, false)
    assert.equal(framed.length, 4 + payloadLen)
  })

  it('FrameDecoder reassembles frames from chunks', () => {
    const msg1 = { type: MSG.PING, ts: 1 }
    const msg2 = { type: MSG.PONG, ts: 2 }

    const frame1 = frameEncode(msg1)
    const frame2 = frameEncode(msg2)

    // Concatenate both frames
    const combined = new Uint8Array(frame1.length + frame2.length)
    combined.set(frame1, 0)
    combined.set(frame2, frame1.length)

    // Feed in small chunks to test reassembly
    const decoder = new FrameDecoder()
    const decoded = []

    // Feed byte-by-byte
    for (let i = 0; i < combined.length; i++) {
      const frames = decoder.feed(combined.subarray(i, i + 1))
      decoded.push(...frames)
    }

    assert.equal(decoded.length, 2)
    assert.deepEqual(decoded[0], msg1)
    assert.deepEqual(decoded[1], msg2)
  })
})

describe('wsh message constants', () => {
  it('MSG type codes are defined and numeric', () => {
    const values = Object.values(MSG)
    assert.ok(values.length > 50, 'Expected many MSG type codes')
    for (const v of values) {
      assert.equal(typeof v, 'number')
    }
  })

  it('PROTOCOL_VERSION is a string', () => {
    assert.ok(typeof PROTOCOL_VERSION === 'string')
    assert.ok(PROTOCOL_VERSION.length > 0)
  })

  it('CHANNEL_KIND has expected entries', () => {
    assert.ok(typeof CHANNEL_KIND === 'object')
  })

  it('AUTH_METHOD is defined', () => {
    assert.ok(typeof AUTH_METHOD === 'object')
  })
})

describe('wsh message factories', () => {
  it('hello creates valid handshake message', () => {
    const msg = hello({ version: PROTOCOL_VERSION })
    assert.ok(isValidMessage(msg))
    assert.equal(msg.type, MSG.HELLO)
  })

  it('ping/pong are valid messages', () => {
    const p = ping({})
    assert.ok(isValidMessage(p))
    assert.equal(p.type, MSG.PING)

    const po = pong({})
    assert.ok(isValidMessage(po))
    assert.equal(po.type, MSG.PONG)
  })

  it('error creates an error message', () => {
    const msg = error({ message: 'something went wrong', code: 500 })
    assert.ok(isValidMessage(msg))
    assert.equal(msg.type, MSG.ERROR)
    assert.equal(msg.message, 'something went wrong')
  })

  it('open/openOk/openFail form a channel lifecycle', () => {
    const req = open({ kind: CHANNEL_KIND?.PTY || 'pty' })
    assert.equal(req.type, MSG.OPEN)

    const ok = openOk({ channel: 1 })
    assert.equal(ok.type, MSG.OPEN_OK)

    const fail = openFail({ reason: 'no resources' })
    assert.equal(fail.type, MSG.OPEN_FAIL)
  })

  it('MCP messages form discover/tools/call/result flow', () => {
    const disc = mcpDiscover({})
    assert.equal(disc.type, MSG.MCP_DISCOVER)

    const tools = mcpTools({ tools: [{ name: 'test_tool' }] })
    assert.equal(tools.type, MSG.MCP_TOOLS)

    const call = mcpCall({ tool: 'test_tool', params: { q: 'hello' } })
    assert.equal(call.type, MSG.MCP_CALL)

    const result = mcpResult({ result: { output: 'done' } })
    assert.equal(result.type, MSG.MCP_RESULT)
  })

  it('msgName returns human-readable names', () => {
    const name = msgName(MSG.HELLO)
    assert.ok(typeof name === 'string')
    assert.ok(name.length > 0)
  })

  it('sessionData carries binary payloads', () => {
    const msg = sessionData({ channel: 1, data: new Uint8Array([65, 66, 67]) })
    assert.ok(isValidMessage(msg))
    assert.equal(msg.type, MSG.SESSION_DATA)
  })

  it('resize sends terminal dimensions', () => {
    const msg = resize({ channel: 1, cols: 120, rows: 40 })
    assert.ok(isValidMessage(msg))
    assert.equal(msg.cols, 120)
    assert.equal(msg.rows, 40)
  })
})

describe('wsh Ed25519 key operations', () => {
  it('generateKeyPair produces valid key pair', async () => {
    const kp = await generateKeyPair(true)
    assert.ok(kp.publicKey)
    assert.ok(kp.privateKey)
  })

  it('exportPublicKeyRaw returns 32 bytes', async () => {
    const kp = await generateKeyPair(true)
    const raw = await exportPublicKeyRaw(kp.publicKey)
    assert.ok(raw instanceof Uint8Array)
    assert.equal(raw.length, 32)
  })

  it('sign and verify roundtrip', async () => {
    const kp = await generateKeyPair(true)
    const data = new TextEncoder().encode('wsh auth challenge')
    const sig = await sign(kp.privateKey, data)

    assert.ok(sig instanceof Uint8Array)
    assert.ok(sig.length > 0)

    const valid = await verify(kp.publicKey, sig, data)
    assert.equal(valid, true)

    // Tampered data fails
    const tampered = new TextEncoder().encode('tampered')
    const invalid = await verify(kp.publicKey, sig, tampered)
    assert.equal(invalid, false)
  })

  it('fingerprint produces a consistent hash', async () => {
    const kp = await generateKeyPair(true)
    const raw = await exportPublicKeyRaw(kp.publicKey)
    const fp1 = await fingerprint(raw)
    const fp2 = await fingerprint(raw)
    assert.equal(fp1, fp2)
    assert.ok(fp1.length > 0)
  })

  it('generateNonce returns random bytes', () => {
    const n1 = generateNonce()
    const n2 = generateNonce()
    assert.ok(n1 instanceof Uint8Array)
    assert.ok(n1.length > 0)
    // Extremely unlikely to be equal
    assert.notDeepEqual(n1, n2)
  })
})

describe('wsh CBOR + message factory integration', () => {
  it('message factories produce CBOR-serializable output', () => {
    const messages = [
      hello({ version: PROTOCOL_VERSION }),
      ping({}),
      pong({}),
      error({ message: 'test', code: 1 }),
      open({ kind: 'pty' }),
      close({ channel: 0 }),
    ]

    for (const msg of messages) {
      const encoded = cborEncode(msg)
      const decoded = cborDecode(encoded)
      assert.equal(decoded.type, msg.type, `CBOR roundtrip failed for type ${msg.type}`)
    }
  })

  it('framed message roundtrip with FrameDecoder', () => {
    const msg = mcpCall({ tool: 'my_tool', params: { key: 'value' } })
    const framed = frameEncode(msg)

    const decoder = new FrameDecoder()
    const results = decoder.feed(framed)
    assert.equal(results.length, 1)
    assert.equal(results[0].type, MSG.MCP_CALL)
    assert.equal(results[0].tool, 'my_tool')
  })
})
