import { chmod, cp, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy non-TypeScript rule assets into dist/ and make the CLI executable.
 * tsc only emits .js, so each rule's meta.yaml and fixtures would otherwise be
 * missing from a published package.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRules = join(root, 'src', 'rules');
const distRules = join(root, 'dist', 'rules');

const entries = await readdir(srcRules, { withFileTypes: true });
let copied = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }
  for (const asset of ['meta.yaml', 'fixtures']) {
    const from = join(srcRules, entry.name, asset);
    const to = join(distRules, entry.name, asset);
    try {
      await cp(from, to, { recursive: true });
      copied += 1;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

await chmod(join(root, 'dist', 'cli.js'), 0o755);

process.stdout.write(`copy-assets: copied ${copied} rule asset(s), made dist/cli.js executable\n`);
