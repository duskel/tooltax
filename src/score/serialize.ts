import type { ToolDefinition } from '../types.js';

/**
 * Fields that are actually sent to a model as part of a tool definition.
 * Anything else an MCP server returns (vendor extensions, `_meta`, and so on)
 * is dropped, because it does not occupy context.
 */
const BILLED_FIELDS = [
  'name',
  'description',
  'inputSchema',
  'outputSchema',
] as const;

/**
 * Recursively sort object keys so that two semantically identical schemas
 * serialize to identical strings regardless of key order. Without this, a server
 * that happens to emit keys in a different order would score differently on
 * every run.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * Serialize a tool definition the way tooltax bills it.
 *
 * The exact wire format differs per vendor, so tooltax standardises on compact
 * canonical JSON of the billed fields. This is reproducible and vendor-neutral,
 * which is what a leaderboard needs. It is a close proxy for real cost, not a
 * byte-exact reproduction of any one provider's serialization.
 */
export function serializeTool(tool: ToolDefinition): string {
  const billed: Record<string, unknown> = {};
  for (const field of BILLED_FIELDS) {
    const value = tool[field];
    if (value !== undefined && value !== null) {
      billed[field] = value;
    }
  }
  return JSON.stringify(canonicalize(billed));
}

/** Serialize just the schema portion of a tool (input + output schemas). */
export function serializeToolSchema(tool: ToolDefinition): string {
  const schemas: Record<string, unknown> = {};
  if (tool.inputSchema) {
    schemas['inputSchema'] = tool.inputSchema;
  }
  if (tool.outputSchema) {
    schemas['outputSchema'] = tool.outputSchema;
  }
  if (Object.keys(schemas).length === 0) {
    return '';
  }
  return JSON.stringify(canonicalize(schemas));
}

export { canonicalize };
