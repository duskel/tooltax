import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import type { Tokenizer } from '../types.js';

/**
 * Real BPE tokenizer using the `o200k_base` encoding (GPT-4o / GPT-4.1 / GPT-5
 * family). This is the tooltax default: it is exact, synchronous, and needs no
 * network access, which matters because the leaderboard runs in CI.
 *
 * Frontier models from different vendors do not share an encoding, so no single
 * tokenizer is "correct" for every consumer of an MCP server. What matters for a
 * leaderboard is that one ranking is produced by one reproducible method. Use
 * `--tokenizer` to re-score with a different one.
 */
export const o200k: Tokenizer = {
  id: 'o200k',
  label: 'gpt-tokenizer (o200k_base)',
  encoding: 'o200k_base',
  exact: true,
  count(text: string): number {
    return encode(text).length;
  },
};

export default o200k;
