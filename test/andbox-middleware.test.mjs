import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSandbox,
  DEFAULT_TIMEOUT_MS, DEFAULT_LIMITS,
  makeDeferred,
} from 'andbox'

import {
  extractCodeBlocks, stripCodeBlocks,
  adaptPythonisms, autoAwait,
  toolsToCapabilities, toolsToPreamble,
  formatResults, resultsToToolCalls,
} from 'ai-matey-middleware-andbox'

describe('andbox inline sandbox executes code', () => {
  it('runs simple expressions and captures output', async () => {
    const sandbox = createSandbox({ mode: 'inline' })
    const result = await sandbox.execute('print("hello from andbox")')
    assert.equal(result.success, true)
    assert.ok(result.output.includes('hello from andbox'))
  })

  it('returns errors for invalid code', async () => {
    const sandbox = createSandbox({ mode: 'inline' })
    const result = await sandbox.execute('throw new Error("boom")')
    assert.equal(result.success, false)
    assert.ok(result.error.includes('boom'))
  })

  it('provides globals to sandbox code', async () => {
    const sandbox = createSandbox({
      mode: 'inline',
      globals: { myValue: 42 },
    })
    const result = await sandbox.execute('print(myValue * 2)')
    assert.equal(result.success, true)
    assert.ok(result.output.includes('84'))
  })
})

describe('middleware code extraction', () => {
  it('extracts fenced code blocks from LLM output', () => {
    const text = `Here is some code:
\`\`\`js
const x = 1 + 2;
print(x);
\`\`\`
And here is more:
\`\`\`python
y = True
print(y)
\`\`\``
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0].lang, 'js')
    assert.ok(blocks[0].code.includes('const x = 1 + 2'))
    assert.equal(blocks[1].lang, 'python')
    assert.ok(blocks[1].code.includes('y = True'))
  })

  it('stripCodeBlocks removes code and keeps conversation', () => {
    const text = 'I will run some code:\n```js\nprint(1)\n```\nDone!'
    const stripped = stripCodeBlocks(text)
    assert.ok(stripped.includes('I will run some code'))
    assert.ok(stripped.includes('Done'))
    assert.ok(!stripped.includes('print(1)'))
    assert.ok(!stripped.includes('```'))
  })

  it('handles text with no code blocks', () => {
    const text = 'Just a regular message with no code.'
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 0)
    assert.equal(stripCodeBlocks(text), text)
  })
})

describe('middleware code adaptation', () => {
  it('adaptPythonisms converts True/False/None to JS', () => {
    const code = 'const a = True; const b = False; const c = None;'
    const adapted = adaptPythonisms(code)
    assert.ok(adapted.includes('true'))
    assert.ok(adapted.includes('false'))
    assert.ok(adapted.includes('null'))
    assert.ok(!adapted.includes('True'))
    assert.ok(!adapted.includes('False'))
    assert.ok(!adapted.includes('None'))
  })

  it('autoAwait inserts await before print calls', () => {
    const code = 'print("hello")'
    const result = autoAwait(code)
    assert.ok(result.includes('await print("hello")'))
  })

  it('autoAwait does not double-await', () => {
    const code = 'await print("hello")'
    const result = autoAwait(code)
    assert.ok(!result.includes('await await'))
  })

  it('autoAwait handles custom async function patterns', () => {
    const code = 'fetchData(42)'
    const result = autoAwait(code, ['fetchData'])
    assert.ok(result.includes('await fetchData(42)'))
  })
})

describe('middleware tool injection', () => {
  it('toolsToCapabilities creates callable functions', async () => {
    const tools = [
      { name: 'search', description: 'Search the web' },
      { name: 'fetch_page', description: 'Fetch a URL' },
    ]
    const calls = []
    const executeFn = async (name, params) => {
      calls.push({ name, params })
      return { success: true, output: `${name} result` }
    }

    const caps = toolsToCapabilities(tools, executeFn)
    assert.ok(typeof caps.search === 'function')
    assert.ok(typeof caps.fetch_page === 'function')

    await caps.search({ query: 'test' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'search')
    assert.deepEqual(calls[0].params, { query: 'test' })
  })

  it('toolsToPreamble generates function stubs with host.call', () => {
    const tools = [
      { name: 'read_file' },
      { name: 'write_file' },
    ]
    const preamble = toolsToPreamble(tools)
    assert.ok(preamble.includes('async function read_file'))
    assert.ok(preamble.includes('async function write_file'))
    assert.ok(preamble.includes("host.call('read_file'"))
    assert.ok(preamble.includes("host.call('write_file'"))
    // Also includes print helper
    assert.ok(preamble.includes('async function print'))
  })
})

describe('middleware result formatting', () => {
  it('formatResults produces human-readable output', () => {
    const results = [
      { code: 'print(1)', output: '1' },
      { code: 'throw', output: '', error: 'SyntaxError' },
    ]
    const formatted = formatResults(results)
    assert.ok(formatted.includes('Block 1: 1'))
    assert.ok(formatted.includes('Block 2 (error): SyntaxError'))
  })

  it('formatResults returns empty string for no results', () => {
    assert.equal(formatResults([]), '')
  })

  it('resultsToToolCalls creates synthetic tool call entries', () => {
    const results = [
      { code: '1 + 1', output: '2' },
      { code: 'bad()', output: '', error: 'ReferenceError' },
    ]
    const toolCalls = resultsToToolCalls(results)
    assert.equal(toolCalls.length, 2)

    assert.equal(toolCalls[0].name, '_code_exec')
    assert.equal(toolCalls[0]._result.success, true)
    assert.equal(toolCalls[0]._result.output, '2')

    assert.equal(toolCalls[1].name, '_code_exec')
    assert.equal(toolCalls[1]._result.success, false)
    assert.ok(toolCalls[1]._result.error.includes('ReferenceError'))
  })
})

describe('andbox + middleware end-to-end', () => {
  it('extracts code from LLM output, adapts it, and executes in sandbox', async () => {
    const llmOutput = `Let me calculate that:
\`\`\`js
const result = True ? 42 : 0;
print(result);
\`\`\``

    // Step 1: Extract code blocks
    const blocks = extractCodeBlocks(llmOutput)
    assert.equal(blocks.length, 1)

    // Step 2: Adapt Python-isms
    const adapted = adaptPythonisms(blocks[0].code)
    assert.ok(adapted.includes('true'))
    assert.ok(!adapted.includes('True'))

    // Step 3: Execute in sandbox
    const sandbox = createSandbox({ mode: 'inline' })
    const result = await sandbox.execute(adapted)
    assert.equal(result.success, true)
    assert.ok(result.output.includes('42'))

    // Step 4: Format results
    const formatted = formatResults([{ code: adapted, output: result.output }])
    assert.ok(formatted.includes('42'))
  })

  it('handles multi-block extraction and execution', async () => {
    const llmOutput = `First:
\`\`\`js
print("one")
\`\`\`
Then:
\`\`\`js
print("two")
\`\`\``

    const blocks = extractCodeBlocks(llmOutput)
    const sandbox = createSandbox({ mode: 'inline' })

    const results = []
    for (const block of blocks) {
      const r = await sandbox.execute(block.code)
      results.push({ code: block.code, output: r.output, error: r.error })
    }

    assert.equal(results.length, 2)
    const formatted = formatResults(results)
    assert.ok(formatted.includes('Block 1'))
    assert.ok(formatted.includes('Block 2'))
  })
})

describe('andbox constants are accessible', () => {
  it('DEFAULT_TIMEOUT_MS is a reasonable number', () => {
    assert.ok(typeof DEFAULT_TIMEOUT_MS === 'number')
    assert.ok(DEFAULT_TIMEOUT_MS > 0)
  })

  it('DEFAULT_LIMITS is defined', () => {
    assert.ok(typeof DEFAULT_LIMITS === 'object')
  })
})
