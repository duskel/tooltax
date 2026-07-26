import type { JsonSchemaNode, ToolDefinition } from '../types.js';
import { canonicalize } from '../score/serialize.js';

/** Read a rule option with a typed fallback. */
export function option<T>(options: Record<string, unknown>, key: string, fallback: T): T {
  const value = options[key];
  return value === undefined ? fallback : (value as T);
}

/** True when `value` is a plain object usable as a JSON Schema node. */
export function isSchemaNode(value: unknown): value is JsonSchemaNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type SchemaVisit = {
  node: JsonSchemaNode;
  /** Dotted path from the tool root, e.g. `inputSchema.properties.query`. */
  path: string;
  /** Nesting depth, where the tool's `inputSchema` itself is depth 0. */
  depth: number;
};

/**
 * Walk every schema node under a tool's input and output schemas, depth-first.
 *
 * Only structural keywords are descended into, so a `default` value that happens
 * to be an object is not mistaken for a schema.
 */
export function walkSchema(tool: ToolDefinition): SchemaVisit[] {
  const visits: SchemaVisit[] = [];
  for (const rootKey of ['inputSchema', 'outputSchema'] as const) {
    const root = tool[rootKey];
    if (isSchemaNode(root)) {
      visit(root, rootKey, 0, visits);
    }
  }
  return visits;
}

function visit(node: JsonSchemaNode, path: string, depth: number, out: SchemaVisit[]): void {
  if (depth > 40) {
    return;
  }
  out.push({ node, path, depth });

  const properties = node.properties;
  if (isSchemaNode(properties)) {
    for (const [key, child] of Object.entries(properties)) {
      if (isSchemaNode(child)) {
        visit(child, `${path}.properties.${key}`, depth + 1, out);
      }
    }
  }

  const items = node.items;
  if (Array.isArray(items)) {
    items.forEach((child, index) => {
      if (isSchemaNode(child)) {
        visit(child, `${path}.items[${index}]`, depth + 1, out);
      }
    });
  } else if (isSchemaNode(items)) {
    visit(items, `${path}.items`, depth + 1, out);
  }

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branch = node[key];
    if (Array.isArray(branch)) {
      branch.forEach((child, index) => {
        if (isSchemaNode(child)) {
          visit(child, `${path}.${key}[${index}]`, depth + 1, out);
        }
      });
    }
  }

  const additional = node.additionalProperties;
  if (isSchemaNode(additional)) {
    visit(additional, `${path}.additionalProperties`, depth + 1, out);
  }

  const defs = node['$defs'] ?? node['definitions'];
  if (isSchemaNode(defs)) {
    for (const [key, child] of Object.entries(defs)) {
      if (isSchemaNode(child)) {
        visit(child, `${path}.$defs.${key}`, depth + 1, out);
      }
    }
  }
}

/** Every description string in a tool, with the path it was found at. */
export function collectDescriptions(tool: ToolDefinition): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  if (typeof tool.description === 'string' && tool.description.length > 0) {
    found.push({ path: 'description', text: tool.description });
  }
  for (const { node, path } of walkSchema(tool)) {
    if (typeof node.description === 'string' && node.description.length > 0) {
      found.push({ path: `${path}.description`, text: node.description });
    }
  }
  return found;
}

/**
 * A stable fingerprint of a schema node's structure, ignoring prose. Two nodes
 * with the same fingerprint describe the same shape and are `$ref` candidates.
 */
export function structuralFingerprint(node: JsonSchemaNode): string {
  return JSON.stringify(canonicalize(stripProse(node)));
}

function stripProse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripProse);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'description' || key === 'title' || key === 'examples') {
        continue;
      }
      out[key] = stripProse(child);
    }
    return out;
  }
  return value;
}

/** Split prose into words for length heuristics. */
export function wordCount(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Round to a whole, non-negative token count. */
export function savings(value: number): number {
  return Math.max(0, Math.round(value));
}

/** Format a short preview of a long string for a finding message. */
export function preview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}
