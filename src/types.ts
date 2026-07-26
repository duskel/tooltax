/**
 * Core shared types for tooltax.
 */

/** A JSON Schema fragment as it appears inside an MCP tool definition. */
export type JsonSchemaNode = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  additionalProperties?: boolean | JsonSchemaNode;
  [key: string]: unknown;
};

/** A single MCP tool definition, as returned by a `tools/list` call. */
export type ToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchemaNode;
  outputSchema?: JsonSchemaNode;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
};

/** A tokenizer implementation. Drop a new one in `src/tokenizers/<name>.ts`. */
export type Tokenizer = {
  /** Stable identifier used by `--tokenizer <id>`. */
  id: string;
  /** Human-readable name shown in reports. */
  label: string;
  /** The model family / encoding this tokenizer approximates. */
  encoding: string;
  /**
   * Whether this tokenizer is a real BPE implementation (`true`) or a
   * heuristic approximation (`false`). Approximations are flagged in reports.
   */
  exact: boolean;
  /** Count tokens in a string. Must be deterministic. */
  count(text: string): number;
};

/** Token cost attributed to one tool definition. */
export type ToolCost = {
  name: string;
  tokens: number;
  /** Tokens attributable to the tool's top-level `description`. */
  descriptionTokens: number;
  /** Tokens attributable to the `inputSchema` (and `outputSchema` if present). */
  schemaTokens: number;
  /** Share of the total payload, 0..1. */
  share: number;
  /** Serialized byte length of the tool definition. */
  bytes: number;
};

/** The result of scoring a set of tool definitions. */
export type ScoreReport = {
  source: string;
  tokenizer: { id: string; label: string; encoding: string; exact: boolean };
  toolCount: number;
  totalTokens: number;
  /** Total serialized bytes of the tool payload. */
  totalBytes: number;
  /** Mean tokens per tool, rounded to one decimal. */
  meanTokensPerTool: number;
  /** The assumed context window used for `contextShare`. */
  contextWindow: number;
  /** Fraction of the context window consumed before any conversation, 0..1. */
  contextShare: number;
  /** Per-tool costs, sorted most expensive first. */
  tools: ToolCost[];
};

export type Severity = 'error' | 'warn' | 'info';

/** Metadata loaded from a rule's `meta.yaml`. */
export type RuleMeta = {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  rationale: string;
  fix: string;
};

/** One problem found by a rule. */
export type Finding = {
  ruleId: string;
  severity: Severity;
  /** The tool this finding applies to, or `null` for payload-wide findings. */
  tool: string | null;
  message: string;
  /** Estimated tokens recoverable by acting on this finding. Never negative. */
  estimatedSavings: number;
};

/** Everything a rule needs in order to run. */
export type RuleContext = {
  tools: ToolDefinition[];
  tokenizer: Tokenizer;
  /** Per-tool costs from the scorer, keyed by tool name. */
  costs: Map<string, ToolCost>;
  /** Rule-specific options merged from defaults and user config. */
  options: Record<string, unknown>;
};

/** The contract every rule in `src/rules/<id>/rule.ts` must satisfy. */
export type Rule = {
  meta: RuleMeta;
  check(context: RuleContext): Finding[];
};

export type LintReport = {
  source: string;
  score: ScoreReport;
  findings: Finding[];
  /** Sum of `estimatedSavings` across all findings, capped at `totalTokens`. */
  estimatedSavings: number;
  counts: Record<Severity, number>;
};

/** How to obtain a server's tool schema. */
export type ServerSource =
  | { type: 'npm'; package: string; args?: string[]; env?: Record<string, string> }
  | { type: 'pypi'; package: string; args?: string[]; env?: Record<string, string> }
  | { type: 'command'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'url'; url: string }
  | { type: 'file'; path: string };

/** One registry entry: `servers/<owner>__<name>.json`. */
export type ServerEntry = {
  name: string;
  repo: string;
  source: ServerSource;
  category?: string;
  notes?: string;
};

/** A registry entry paired with its scoring outcome. */
export type LeaderboardRow = {
  slug: string;
  entry: ServerEntry;
  status: 'scored' | 'pending';
  /** Present when `status === 'scored'`. */
  score?: ScoreReport;
  /** Present when `status === 'pending'`: why the schema could not be fetched. */
  reason?: string;
};
