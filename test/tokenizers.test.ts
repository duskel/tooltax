import { describe, expect, it } from 'vitest';
import { TOKENIZERS, getTokenizer, listTokenizerIds } from '../src/tokenizers/index.js';

describe('tokenizer registry', () => {
  it('exposes at least one exact tokenizer and defaults to it', () => {
    expect(TOKENIZERS.some((t) => t.exact)).toBe(true);
    expect(getTokenizer().exact).toBe(true);
  });

  it('has unique ids', () => {
    const ids = listTokenizerIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('throws a helpful error for an unknown id', () => {
    expect(() => getTokenizer('nope')).toThrowError(/Unknown tokenizer "nope"/);
    expect(() => getTokenizer('nope')).toThrowError(/Available:/);
  });
});

describe.each(TOKENIZERS.map((t) => [t.id, t] as const))('tokenizer contract: %s', (_id, tokenizer) => {
  it('returns 0 for the empty string', () => {
    expect(tokenizer.count('')).toBe(0);
  });

  it('returns a non-negative integer', () => {
    const count = tokenizer.count('the quick brown fox');
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const text = '{"name":"search","description":"Search the index."}';
    expect(tokenizer.count(text)).toBe(tokenizer.count(text));
  });

  it('grows monotonically as text is appended', () => {
    const short = tokenizer.count('hello');
    const long = tokenizer.count('hello hello hello hello hello');
    expect(long).toBeGreaterThan(short);
  });

  it('produces a plausible token-per-character ratio for English prose', () => {
    const text =
      'Search the document index and return the highest scoring matches for a query.';
    const ratio = text.length / tokenizer.count(text);
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(8);
  });
});

describe('exact tokenizers match published tiktoken reference counts', () => {
  const cl100k = getTokenizer('cl100k');
  const o200k = getTokenizer('o200k');

  it('counts "hello world" as 2 tokens', () => {
    expect(cl100k.count('hello world')).toBe(2);
    expect(o200k.count('hello world')).toBe(2);
  });

  it('counts "Hello, world!" as 4 tokens in cl100k_base', () => {
    expect(cl100k.count('Hello, world!')).toBe(4);
  });

  it('counts the canonical tiktoken example as 6 tokens', () => {
    expect(cl100k.count('tiktoken is great!')).toBe(6);
  });

  it('differs from the naive length/4 heuristic on real schema text', () => {
    const schema = JSON.stringify({
      name: 'get_weather',
      description: 'Get the current weather for a city.',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    });
    const approx = getTokenizer('approx');
    expect(o200k.count(schema)).not.toBe(approx.count(schema));
  });
});
