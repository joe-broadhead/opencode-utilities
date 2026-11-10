// Explicit build preparation only. Never imported by runtime or install hooks.
// Fetches the pinned speech models into build/speech-assets/, the flat folder of release files.
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryFailure, withRetry } from './retry.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { assets } = JSON.parse(await readFile(resolve(root, 'native/model-sources.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// One transfer, tried again when the connection fails or the body is cut short (three attempts in all). A status other
// than 429 or 5xx, an oversized body and a failed integrity check are not retried.
const download = asset => withRetry(async () => {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(300_000) }).catch(cause => retryFailure(`model download failed: ${cause.message}`));
  if (response.status === 429 || response.status >= 500) retryFailure(`model download failed: ${response.status}`);
  if (!response.ok) throw new Error(`model download failed: ${response.status}`);
  const chunks = []; let count = 0;
  try {
    for await (const chunk of response.body) {
      count += chunk.length;
      if (count > asset.bytes) throw new Error('model size exceeded');
      chunks.push(chunk);
    }
  } catch (cause) {
    if (cause.message === 'model size exceeded') throw cause;
    retryFailure(`model download interrupted: ${cause.message}`);
  }
  return Buffer.concat(chunks);
});

for (const asset of assets) {
  const path = resolve(root, 'build/speech-assets', asset.name);
  const old = await readFile(path).catch(() => null);
  if (old?.length === asset.bytes && digest(old) === asset.sha256) continue;
  const bytes = await download(asset);
  if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error('model integrity failed');
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.download-${process.pid}`;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
  console.log(`${asset.role}: verified ${bytes.length} bytes`);
}
