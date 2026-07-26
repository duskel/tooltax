import type { Tokenizer } from '../types.js';

/**
 * A deliberately-labelled heuristic. It exists so that reports can show what a
 * `length / 4` estimate would have claimed, and so tests have a dependency-free
 * tokenizer to exercise the plumbing with. It is never the default and always
 * reports `exact: false`, which surfaces a warning in every report that uses it.
 *
 * Do not use this to score anything you intend to publish.
 */
export const approx: Tokenizer = {
  id: 'approx',
  label: 'character heuristic (length / 4)',
  encoding: 'none',
  exact: false,
  count(text: string): number {
    return Math.ceil(text.length / 4);
  },
};

export default approx;
