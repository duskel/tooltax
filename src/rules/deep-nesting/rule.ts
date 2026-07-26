import type { Finding, Rule, RuleContext } from '../../types.js';
import { option, savings, walkSchema } from '../lib.js';

/**
 * Deeply nested input schemas cost tokens twice: once for the structural
 * scaffolding at every level, and again because models handle flat arguments
 * more reliably than nested object trees.
 */
export const rule: Rule = {
  meta: {
    id: 'deep-nesting',
    title: 'Input schema nests deeper than models need',
    severity: 'warn',
    category: 'structure',
    rationale:
      'Every level of nesting adds braces, type keywords and required arrays that are re-serialized into context on every request. Past about three levels the structure also starts to hurt argument accuracy.',
    fix: 'Flatten the schema. Accept an opaque string or a single object of primitives where the nested tree only exists to mirror an internal data model, and validate the detail inside the tool instead.',
  },

  check(context: RuleContext): Finding[] {
    const maxDepth = option(context.options, 'maxDepth', 3);
    const findings: Finding[] = [];

    for (const tool of context.tools) {
      const visits = walkSchema(tool);
      let deepest = 0;
      let deepestPath = '';
      for (const visit of visits) {
        if (visit.depth > deepest) {
          deepest = visit.depth;
          deepestPath = visit.path;
        }
      }
      if (deepest <= maxDepth) {
        continue;
      }

      const overDepth = visits.filter((v) => v.depth > maxDepth);
      const wastedTokens = overDepth.reduce(
        (sum, v) => sum + context.tokenizer.count(JSON.stringify(v.node)),
        0,
      );

      findings.push({
        ruleId: rule.meta.id,
        severity: rule.meta.severity,
        tool: tool.name,
        message:
          `schema nests ${deepest} levels deep (max ${maxDepth}) at ${deepestPath}; ` +
          `${overDepth.length} node(s) sit below the limit.`,
        estimatedSavings: savings(wastedTokens * 0.4),
      });
    }

    return findings;
  },
};

export default rule;
