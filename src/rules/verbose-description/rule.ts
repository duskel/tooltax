import type { Finding, Rule, RuleContext } from '../../types.js';
import { collectDescriptions, option, preview, savings } from '../lib.js';

/**
 * Long prose in a tool or parameter description is the single most common cause
 * of an expensive MCP server. Descriptions are paid for on every request, so a
 * paragraph that could be a sentence is a recurring tax.
 */
export const rule: Rule = {
  meta: {
    id: 'verbose-description',
    title: 'Description is longer than it needs to be',
    severity: 'warn',
    category: 'prose',
    rationale:
      'Tool and parameter descriptions are injected into every request. Long prose, usage examples and restatements of the parameter name cost tokens on each call without improving tool selection.',
    fix: 'Cut descriptions to one sentence that says what the tool does and when to pick it. Move examples, caveats and formatting notes into the error messages the tool returns, or into your README.',
  },

  check(context: RuleContext): Finding[] {
    const maxToolTokens = option(context.options, 'maxToolDescriptionTokens', 60);
    const maxParamTokens = option(context.options, 'maxParamDescriptionTokens', 25);
    const findings: Finding[] = [];

    for (const tool of context.tools) {
      for (const { path, text } of collectDescriptions(tool)) {
        const isToolLevel = path === 'description';
        const budget = isToolLevel ? maxToolTokens : maxParamTokens;
        const tokens = context.tokenizer.count(text);
        if (tokens <= budget) {
          continue;
        }
        findings.push({
          ruleId: rule.meta.id,
          severity: rule.meta.severity,
          tool: tool.name,
          message:
            `${path} is ${tokens} tokens (budget ${budget}): "${preview(text)}" ` +
            `-- trim to roughly ${budget} tokens.`,
          estimatedSavings: savings(tokens - budget),
        });
      }
    }

    return findings;
  },
};

export default rule;
