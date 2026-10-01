/* global console, process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const assets = [
  {
    src: path.join(rootDir, 'src/Services/probe/languages/python/harness.py'),
    dest: path.join(rootDir, 'dist/Services/probe/languages/python/harness.py'),
  },
];

for (const { src, dest } of assets) {
  if (!fs.existsSync(src)) {
    console.error(`[build:copy-assets] Error: Source file not found : ${src}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[build:copy-assets] Copied : ${path.relative(rootDir, dest)}`);
}
