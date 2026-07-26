import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import type { Tokenizer } from '../types.js';

/**
 * Real BPE tokenizer using the `cl100k_base` encoding (GPT-3.5 / GPT-4 family,
 * and the encoding most third-party token counters still assume). Useful for
 * comparing how much of a schema's cost is encoding-specific.
 */
export const cl100k: Tokenizer = {
  id: 'cl100k',
  label: 'gpt-tokenizer (cl100k_base)',
  encoding: 'cl100k_base',
  exact: true,
  count(text: string): number {
    return encode(text).length;
  },
};

export default cl100k;
