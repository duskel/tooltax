import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, costIndex, scoreTools } from '../src/score/score.js';
import { serializeTool } from '../src/score/serialize.js';
import { getTokenizer } from '../src/tokenizers/index.js';
import type { ToolDefinition } from '../src/types.js';

const tokenizer = getTokenizer('o200k');

const cheap: ToolDefinition = {
  name: 'ping',
  description: 'Check liveness.',
  inputSchema: { type: 'object', properties: {} },
};

const expensive: ToolDefinition = {
  name: 'query',
  description: 'Run a query against the warehouse and return matching rows with full metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A SELECT statement to execute.' },
      limit: { type: 'integer', description: 'Maximum rows to return.' },
    },
    required: ['sql'],
  },
};

describe('scoreTools', () => {
  it('totals the per-tool costs', () => {
    const report = scoreTools([cheap, expensive], tokenizer);
    const sum = report.tools.reduce((acc, t) => acc + t.tokens, 0);
    expect(report.totalTokens).toBe(sum);
    expect(report.toolCount).toBe(2);
  });

  it('sorts tools most expensive first', () => {
    const report = scoreTools([cheap, expensive], tokenizer);
    expect(report.tools[0]?.name).toBe('query');
    expect(report.tools[1]?.name).toBe('ping');
  });

  it('computes shares that sum to 1', () => {
    const report = scoreTools([cheap, expensive], tokenizer);
    const total = report.tools.reduce((acc, t) => acc + t.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('reports context share against the default window', () => {
    const report = scoreTools([expensive], tokenizer);
    expect(report.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(report.contextShare).toBeCloseTo(report.totalTokens / DEFAULT_CONTEXT_WINDOW, 10);
  });

  it('honours a custom context window', () => {
    const report = scoreTools([expensive], tokenizer, { contextWindow: 8_000 });
    expect(report.contextShare).toBeCloseTo(report.totalTokens / 8_000, 10);
  });

  it('rejects a non-positive context window', () => {
    expect(() => scoreTools([cheap], tokenizer, { contextWindow: 0 })).toThrowError(
      /positive number/,
    );
  });

  it('handles a server with no tools', () => {
    const report = scoreTools([], tokenizer);
    expect(report.totalTokens).toBe(0);
    expect(report.meanTokensPerTool).toBe(0);
    expect(report.tools).toEqual([]);
  });

  it('attributes description and schema tokens separately', () => {
    const report = scoreTools([expensive], tokenizer);
    const cost = report.tools[0];
    expect(cost?.descriptionTokens).toBeGreaterThan(0);
    expect(cost?.schemaTokens).toBeGreaterThan(0);
    expect(cost?.tokens).toBeGreaterThan(cost?.descriptionTokens ?? 0);
  });

  it('indexes costs by tool name', () => {
    const index = costIndex(scoreTools([cheap, expensive], tokenizer));
    expect(index.get('ping')?.name).toBe('ping');
    expect(index.get('query')?.tokens).toBeGreaterThan(0);
  });
});

describe('serializeTool', () => {
  it('is stable regardless of key order', () => {
    const a = serializeTool({ name: 'x', description: 'd', inputSchema: { type: 'object' } });
    const b = serializeTool({ inputSchema: { type: 'object' }, description: 'd', name: 'x' });
    expect(a).toBe(b);
  });

  it('ignores fields that are not sent to the model', () => {
    const withExtra = serializeTool({
      name: 'x',
      description: 'd',
      _meta: { internal: 'a'.repeat(500) },
    } as ToolDefinition);
    const without = serializeTool({ name: 'x', description: 'd' });
    expect(withExtra).toBe(without);
  });

  it('keeps outputSchema, which is billed', () => {
    const serialized = serializeTool({
      name: 'x',
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    });
    expect(serialized).toContain('outputSchema');
  });

  it('makes reordered nested keys score identically', () => {
    const first = scoreTools(
      [{ name: 't', inputSchema: { type: 'object', properties: { a: {}, b: {} } } }],
      tokenizer,
    );
    const second = scoreTools(
      [{ name: 't', inputSchema: { properties: { b: {}, a: {} }, type: 'object' } }],
      tokenizer,
    );
    expect(first.totalTokens).toBe(second.totalTokens);
  });
});
