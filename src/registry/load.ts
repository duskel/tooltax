import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AjvModule, { type ValidateFunction } from 'ajv';
import type { ServerEntry } from '../types.js';

/**
 * Ajv ships CommonJS with an `exports.default` alias, so the shape of a default
 * import differs between bundlers, tsc and plain Node ESM. Normalise it once
 * here instead of scattering casts at every call site.
 */
type AjvConstructor = new (options?: {
  allErrors?: boolean;
  strict?: boolean;
}) => { compile(schema: unknown): ValidateFunction };

const Ajv = ((AjvModule as unknown as { default?: unknown }).default ??
  AjvModule) as unknown as AjvConstructor;

/** `servers/<owner>__<name>.json` -- two underscores separate owner from name. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9.-]*__[a-z0-9][a-z0-9.-]*$/;

export type LoadedEntry = {
  slug: string;
  path: string;
  entry: ServerEntry;
};

export type ValidationIssue = {
  slug: string;
  path: string;
  message: string;
};

export type RegistryLoadResult = {
  entries: LoadedEntry[];
  issues: ValidationIssue[];
};

/** Default location of the registry directory. */
export function defaultRegistryDir(cwd = process.cwd()): string {
  return resolve(cwd, 'servers');
}

/** Default location of the entry JSON Schema. */
export function defaultSchemaPath(cwd = process.cwd()): string {
  return resolve(cwd, 'schema', 'server.schema.json');
}

async function buildValidator(schemaPath: string): Promise<ValidateFunction> {
  let raw: string;
  try {
    raw = await readFile(schemaPath, 'utf8');
  } catch {
    throw new Error(
      `Could not read the registry schema at ${schemaPath}. ` +
        `Run tooltax from the repository root, or pass --schema <path>.`,
    );
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(JSON.parse(raw));
}

/**
 * Read and validate every `servers/*.json` entry.
 *
 * Invalid entries are collected into `issues` rather than thrown, so `tooltax
 * validate` can report all problems in one pass instead of one per run.
 */
export async function loadRegistry(
  registryDir: string = defaultRegistryDir(),
  schemaPath: string = defaultSchemaPath(),
): Promise<RegistryLoadResult> {
  const validate = await buildValidator(schemaPath);

  let files: string[];
  try {
    files = (await readdir(registryDir)).filter((f) => f.endsWith('.json')).sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `No registry directory at ${registryDir}. Run tooltax from the repository root, ` +
          `or pass --registry <path>.`,
      );
    }
    throw error;
  }

  const entries: LoadedEntry[] = [];
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const slug = file.replace(/\.json$/, '');
    const path = join(registryDir, file);

    if (!SLUG_PATTERN.test(slug)) {
      issues.push({
        slug,
        path,
        message:
          `file name must be <owner>__<name>.json using lowercase letters, digits, dots and dashes ` +
          `(for example modelcontextprotocol__filesystem.json).`,
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      issues.push({
        slug,
        path,
        message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (!validate(parsed)) {
      for (const err of validate.errors ?? []) {
        const where = err.instancePath || '(root)';
        issues.push({ slug, path, message: `${where} ${err.message ?? 'is invalid'}` });
      }
      continue;
    }

    entries.push({ slug, path, entry: parsed as ServerEntry });
  }

  return { entries, issues };
}
