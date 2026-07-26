import type { Finding, Rule, RuleContext } from '../../types.js';
import { collectDescriptions, option, preview, savings } from '../lib.js';

/**
 * The same sentence pasted into twelve tool descriptions is paid for twelve
 * times. This is the highest-leverage finding on most large servers, because the
 * fix is a delete rather than a redesign.
 */
export const rule: Rule = {
  meta: {
    id: 'repeated-boilerplate',
    title: 'Identical prose repeated across tools',
    severity: 'warn',
    category: 'prose',
    rationale:
      'Authentication notes, rate-limit warnings and formatting instructions get copied into every tool description. The model only needs them once, but the server pays for every copy on every request.',
    fix: 'Say it once. Put shared context in the server instructions field of the initialize response, or drop it entirely and surface it in the tool error message when it actually applies.',
  },

  check(context: RuleContext): Finding[] {
    const minRepeats = option(context.options, 'minRepeats', 3);
    const minTokens = option(context.options, 'minTokens', 8);

    const occurrences = new Map<string, { tools: Set<string>; count: number }>();

    for (const tool of context.tools) {
      for (const { text } of collectDescriptions(tool)) {
        for (const sentence of splitSentences(text)) {
          const key = sentence.toLowerCase();
          const existing = occurrences.get(key);
          if (existing) {
            existing.tools.add(tool.name);
            existing.count += 1;
          } else {
            occurrences.set(key, { tools: new Set([tool.name]), count: 1 });
          }
        }
      }
    }

    const findings: Finding[] = [];
    for (const [sentence, { tools, count }] of occurrences) {
      if (tools.size < minRepeats) {
        continue;
      }
      const tokens = context.tokenizer.count(sentence);
      if (tokens < minTokens) {
        continue;
      }
      findings.push({
        ruleId: rule.meta.id,
        severity: rule.meta.severity,
        tool: null,
        message:
          `"${preview(sentence)}" appears ${count} time(s) across ${tools.size} tools, ` +
          `costing ~${tokens} tokens each time.`,
        estimatedSavings: savings(tokens * (count - 1)),
      });
    }

    findings.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
    return findings;
  },
};

/** Split prose into trimmed sentences, discarding fragments too short to matter. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 12);
}

export default rule;
