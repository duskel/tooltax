import type { Finding, Rule, RuleContext } from '../../types.js';
import { option, savings, walkSchema } from '../lib.js';

/**
 * Enumerating every timezone, country code or model name inline turns a
 * one-token parameter into a several-hundred-token one.
 */
export const rule: Rule = {
  meta: {
    id: 'enum-bloat',
    title: 'Enum lists every allowed value inline',
    severity: 'warn',
    category: 'structure',
    rationale:
      'Large inline enums are re-sent on every request. A 200-value enum can cost more than the rest of the server combined, and models rarely need the full list to pick a sensible value.',
    fix: 'Accept a plain string and validate inside the tool, returning the allowed values in the error message. Keep the enum only when the set is small, stable and genuinely unguessable.',
  },

  check(context: RuleContext): Finding[] {
    const maxValues = option(context.options, 'maxEnumValues', 12);
    const findings: Finding[] = [];

    for (const tool of context.tools) {
      for (const { node, path } of walkSchema(tool)) {
        const values = node.enum;
        if (!Array.isArray(values) || values.length <= maxValues) {
          continue;
        }
        const enumTokens = context.tokenizer.count(JSON.stringify(values));
        const keptTokens = context.tokenizer.count(JSON.stringify(values.slice(0, maxValues)));
        findings.push({
          ruleId: rule.meta.id,
          severity: rule.meta.severity,
          tool: tool.name,
          message:
            `${path}.enum lists ${values.length} values (max ${maxValues}) costing ~${enumTokens} tokens; ` +
            `accept a string and validate server-side.`,
          estimatedSavings: savings(enumTokens - keptTokens),
        });
      }
    }

    return findings;
  },
};

export default rule;
