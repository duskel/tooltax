import type { Finding, Rule, RuleContext } from '../../types.js';
import { option, savings, walkSchema } from '../lib.js';

/**
 * `examples` and `default` payloads embedded in a schema are shipped to the
 * model on every request. A single realistic API response pasted in as an
 * example can outweigh every description on the server.
 */
export const rule: Rule = {
  meta: {
    id: 'oversized-example',
    title: 'Embedded example or default payload is large',
    severity: 'warn',
    category: 'structure',
    rationale:
      'JSON Schema examples and defaults are part of the tool definition, so a pasted sample payload is paid for on every single request even though it is only useful once.',
    fix: 'Delete the example, or shrink it to the smallest fragment that disambiguates the format. A one-line format hint in the description is almost always cheaper than a full sample object.',
  },

  check(context: RuleContext): Finding[] {
    const maxTokens = option(context.options, 'maxExampleTokens', 25);
    const findings: Finding[] = [];

    for (const tool of context.tools) {
      for (const { node, path } of walkSchema(tool)) {
        for (const key of ['examples', 'example', 'default'] as const) {
          const value = node[key];
          if (value === undefined || value === null) {
            continue;
          }
          const serialized = JSON.stringify(value);
          if (!serialized) {
            continue;
          }
          const tokens = context.tokenizer.count(serialized);
          if (tokens <= maxTokens) {
            continue;
          }
          findings.push({
            ruleId: rule.meta.id,
            severity: rule.meta.severity,
            tool: tool.name,
            message:
              `${path}.${key} costs ~${tokens} tokens (max ${maxTokens}); ` +
              `shrink it or move the guidance into the description.`,
            estimatedSavings: savings(tokens - maxTokens),
          });
        }
      }
    }

    return findings;
  },
};

export default rule;
