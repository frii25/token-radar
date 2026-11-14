// Token launch radar — entrypoint.
//
// Reads the sealed snapshot (default /input/snapshot.json, overridable with
// --input), ranks every protocol by launch-implied value, and writes:
//   /output/board.json        the ranked board (200 rows)
//   /output/dashboard/rows.js  the dashboard's data, beside the page
//   /output/dashboard/         a copy of dashboard/
//   /output/screenshots/       a copy of screenshots/
//   /output/dossier.json       buildDossier's dossier of dashboard/ + screenshots/
//
// Output directory comes from MAKEFUN_OUTPUT_DIR (default /output). Node 22,
// standard library only, no network, deterministic: the same snapshot bytes
// always produce the same output bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, type Protocol } from './lib/model.ts';

const PRE_TOKEN_ROWS = 160;
const TOKENIZED_ROWS = 40;

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1] !== undefined) input = argv[++i]!;
    else if (argv[i] === '--output' && argv[i + 1] !== undefined) output = argv[++i]!;
    else if (argv[i]!.startsWith('--input=')) input = argv[i]!.slice('--input='.length);
    else if (argv[i]!.startsWith('--output=')) output = argv[i]!.slice('--output='.length);
  }
  return { input, output };
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function checkBoard(rows: ReturnType<typeof buildBoard>, watchlist: string[], slugs: Set<string>): void {
  if (rows.length < 100 || rows.length > 4000) throw new Error(`board has ${rows.length} rows`);
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = true;
  const first = rows[0]?.implied_value_usd;
  for (const r of rows) {
    if (!slugs.has(r.slug)) throw new Error(`unknown slug ${r.slug}`);
    if (seen.has(r.slug)) throw new Error(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (r.rank < 1 || r.rank > rows.length) throw new Error(`bad rank ${r.rank}`);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) throw new Error(`bad value for ${r.slug}`);
    if (r.implied_value_usd > prev) throw new Error(`value rises at rank ${r.rank}`);
    prev = r.implied_value_usd;
    if (r.implied_value_usd !== first) allEqual = false;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) throw new Error(`bad farm steps for ${r.slug}`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) throw new Error(`farm step length ${t.length} for ${r.slug}`);
    }
  }
  if (allEqual) throw new Error('all implied values equal');
  for (let i = 0; i < rows.length; i++) if (rows[i]!.rank !== i + 1) throw new Error(`ranks are not 1..N`);
  for (const w of watchlist) if (!seen.has(w)) throw new Error(`watchlist slug missing: ${w}`);
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(readFileSync(input, 'utf8')) as {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: Protocol[];
    watchlist: string[];
  };

  const rows = buildBoard(snapshot.protocols, snapshot.watchlist, snapshot.as_of, PRE_TOKEN_ROWS, TOKENIZED_ROWS);
  checkBoard(rows, snapshot.watchlist, new Set(snapshot.protocols.map((p) => p.slug)));

  mkdirSync(output, { recursive: true });
  const board = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    rows,
  };
  writeFileSync(join(output, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');

  // Dashboard data: the same rows, compact, as a script the page loads.
  const dashDir = join(output, 'dashboard');
  copyTree(join(import.meta.dirname, 'dashboard'), dashDir);
  const dataJs = `// Token launch radar data, generated from the sealed snapshot of ${snapshot.as_of}.\n// Pre-token rows carry a launch-implied value; tokenized rows carry their recorded market cap.\nwindow.RADAR_DATA = ${JSON.stringify({ as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, rows })};\n`;
  // Named rows.js so the dossier's text shows index.html whole before the data
  // file (shown in path order) is cut at the 64 KiB cap.
  writeFileSync(join(dashDir, 'rows.js'), dataJs, 'utf8');

  const shotsDir = join(output, 'screenshots');
  const localShots = join(import.meta.dirname, 'screenshots');
  if (existsSync(localShots)) copyTree(localShots, shotsDir);

  writeFileSync(join(output, 'dossier.json'), buildDossier(output, { text_max_bytes: 65536 }));
  console.log(`token-radar: ${rows.length} rows, ${rows.filter((r) => !r.has_token).length} pre-token, as of ${snapshot.as_of}`);
}

main();
