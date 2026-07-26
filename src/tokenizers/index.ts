import type { Tokenizer } from '../types.js';
import { approx } from './approx.js';
import { cl100k } from './cl100k.js';
import { o200k } from './o200k.js';

/**
 * Every tokenizer tooltax knows about.
 *
 * To add one: create `src/tokenizers/<name>.ts` exporting a `Tokenizer`, then
 * add it to this array. The contract test in `test/tokenizers.test.ts` will pick
 * it up automatically and hold it to the shared invariants.
 */
export const TOKENIZERS: readonly Tokenizer[] = [o200k, cl100k, approx];

export const DEFAULT_TOKENIZER_ID = 'o200k';

export function listTokenizerIds(): string[] {
  return TOKENIZERS.map((t) => t.id);
}

/**
 * Resolve a tokenizer by id.
 *
 * @throws {Error} if the id is not registered, listing the valid ids.
 */
export function getTokenizer(id: string = DEFAULT_TOKENIZER_ID): Tokenizer {
  const found = TOKENIZERS.find((t) => t.id === id);
  if (!found) {
    throw new Error(
      `Unknown tokenizer "${id}". Available: ${listTokenizerIds().join(', ')}.`,
    );
  }
  return found;
}

export { o200k, cl100k, approx };
