# Good first issues

Concrete, self-contained tasks. Each says what to change, where, and how to know
you are done. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first for setup.

If you pick one up, comment on the tracking issue so two people do not do the
same work.

---

## 1. Add an MCP server to the registry

**Difficulty:** starter. **Files:** one new `servers/<owner>__<name>.json`.

The leaderboard is only as useful as its coverage. Pick a real MCP server that is
not in `servers/` yet and add it.

1. Copy an existing entry as a template.
2. Name the file `<owner>__<name>.json`, lowercase.
3. Verify it before opening the PR:
   ```bash
   npm run build
   node dist/cli.js validate
   node dist/cli.js score npm:the-package
   ```

**Done when:** `validate` passes and CI posts a score on your PR. If the server
needs credentials and cannot start, the entry still belongs here -- it lands in
the pending section with the reason attached.

---

## 2. Add a `--format=csv` output mode

**Difficulty:** starter. **Files:** `src/report.ts`, `src/cli.ts`, a new test.

`--json` is good for programs and the text table is good for humans, but people
pasting results into a spreadsheet currently have to write their own `jq`.

Add `--format <text|json|csv>` to `score` and `leaderboard`, keeping `--json` as
an alias for `--format json` so nothing breaks. CSV columns for `score`:
`tool,tokens,share,description_tokens,schema_tokens,bytes`.

**Done when:** `tooltax score fixtures.json --format csv` emits a valid header
row plus one row per tool, quoted correctly for tool names containing commas, and
a test covers the quoting.

---

## 3. Add a `required-field-bloat` rule

**Difficulty:** starter. **Files:** a new `src/rules/required-field-bloat/`.

Some servers list every property in `required`, which forces the model to invent
values for parameters that have sensible defaults. It costs tokens in the
`required` array and costs accuracy in the call.

Flag tools where `required` covers more than about 80 percent of properties and
there are more than three of them.

Follow the layout in [CONTRIBUTING.md](../CONTRIBUTING.md#2-add-a-rule): the
contract test enforces `meta.yaml` parity and both fixtures automatically.

**Done when:** `npm test` passes with your `trigger.json` producing a finding and
your `clean.json` producing none.

---

## 4. Add a `$ref`-aware schema resolver

**Difficulty:** intermediate. **Files:** `src/score/serialize.ts` plus tests.

Servers that already follow the SEP-1576 advice and deduplicate with `$ref` are
currently scored on their compact form, which is correct for wire cost but
understates what the model actually sees once the schema is inlined.

Add an opt-in `--resolve-refs` flag that expands internal `#/$defs/...`
references before tokenizing, so a maintainer can compare the two numbers. Guard
against circular references with a depth limit and a visited set.

**Done when:** a schema using `$defs` scores higher with the flag than without,
a circular `$ref` does not hang, and both cases have tests.

---

## 5. Cache leaderboard scores between runs

**Difficulty:** intermediate. **Files:** `src/registry/leaderboard.ts`, the
leaderboard workflow.

The nightly run launches every server from scratch. As the registry grows this
gets slow and hammers npm.

Add a `--cache <path>` option storing per-slug results with a timestamp and a
hash of the entry, and a `--max-age <hours>` to reuse anything fresher than the
cutoff. A changed entry must always be re-scored.

**Done when:** a second run with `--cache` is measurably faster, editing an entry
forces a re-score, and there is a test for the invalidation logic.

---

## 6. Report the prompt-caching cost separately

**Difficulty:** intermediate. **Files:** `src/score/score.ts`, `src/report.ts`.

Tool definitions usually sit in the cacheable prefix of a request, so their
billing cost after the first call is much lower than the sticker number -- but
their *context window* cost is unchanged. The README says this; the tool does
not show it.

Add a `--cache-discount <ratio>` option and report an effective per-call cost
alongside the raw count, making clear that context share is unaffected.

**Done when:** `score` shows both figures, the JSON output includes both, and the
default behaviour is unchanged.

---

## 7. Add a real Anthropic token-counting tokenizer

**Difficulty:** intermediate. **Files:** a new `src/tokenizers/anthropic.ts`.

Every current tokenizer uses an OpenAI BPE encoding. Claude tokenizes
differently, and it is a major MCP consumer.

Wrap Anthropic's token-counting endpoint behind the `Tokenizer` interface. The
interface is synchronous by design, so this needs care: either extend the
interface to allow an async `countBatch`, or have this tokenizer pre-warm a cache
and fail loudly when a string is not in it. Propose the approach in an issue
before writing much code.

It must be opt-in and must never be required for `npm test` to pass, since CI has
no API key.

**Done when:** `--tokenizer anthropic` works with `ANTHROPIC_API_KEY` set, fails
with a clear message without one, and the offline tests still pass.

---

## 8. Serve the badges from GitHub Pages

**Difficulty:** intermediate. **Files:** a new workflow, `src/badge.ts`.

`badges/*.json` is committed to the repo and served through raw.githubusercontent
URLs, which are rate-limited and cached aggressively by shields.io.

Publish `badges/` to GitHub Pages after each leaderboard run and update
`badgeMarkdown()` to point at the Pages URL.

**Done when:** a badge URL resolves from Pages, `badgeMarkdown` emits it, and the
badge test covers the new base URL.

---

## 9. Detect tool lists that vary by configuration

**Difficulty:** advanced. **Files:** `src/registry/leaderboard.ts`, the schema.

Some servers expose different tools depending on their arguments or environment,
which makes a single score misleading.

Allow an entry to declare several named variants, score each, and show the range
in the leaderboard rather than one number.

This changes `schema/server.schema.json`, so open an issue to agree the shape
before implementing. Existing single-source entries must keep working unchanged.

**Done when:** an entry with two variants renders a range, single-source entries
are unaffected, and `validate` accepts both forms.

---

## 10. Write the methodology comparison

**Difficulty:** starter, no TypeScript. **Files:** a new `docs/METHODOLOGY.md`.

The README explains how tooltax serializes and counts. What it does not do is
show how much the answer moves when you change the assumptions.

Score five servers from the registry with each tokenizer and write up the spread,
plus how canonical JSON compares with a provider's real wire format. Use real
output from commands you actually ran.

**Done when:** the doc exists with reproducible commands, and every number in it
came from a command in the doc. Do not estimate anything.
