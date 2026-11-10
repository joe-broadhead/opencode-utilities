// Writes manifest/speech-assets.json from a folder of the speech release files. A maintainer command: build, pack and release
// never run it, and the committed manifest is pinned by test/unit/speech-manifest.test.ts.
//   npm run speech:manifest -- --from <folder>
// The folder holds the speech engine of each platform that has one (utilities-speech-<platform>) and the four models, under
// their release names. Each model must match native/model-sources.json; each engine's size and sha256 are read from its
// file. Every URL names this package's release tag, v<version>. Review the diff before committing it.
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS } from '../src/domain/contract.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--from');
const from = at < 0 ? undefined : args[at + 1];
if (!from) throw new Error('usage: npm run speech:manifest -- --from <folder of the speech release files>');

const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const { version } = await json('package.json');
const TAG = `v${version}`;
const { assets: models } = await json('native/model-sources.json');
const RELEASE = (name) => `https://github.com/joe-broadhead/opencode-utilities/releases/download/${TAG}/${name}`;
const ROLES = ['tiny-q5_1', 'kitten-model', 'kitten-voices', 'kitten-config'];

/** The size and SHA-256 of one file. A missing file is an error: the manifest names only files that exist. */
async function info(name) {
  const bytes = await readFile(join(from, name));
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const asset = (name, found) => ({ name, url: RELEASE(name), sha256: found.sha256, bytes: found.bytes });

const engines = {};
for (const platform of Object.keys(PLATFORMS)) {
  const name = `utilities-speech-${platform}`;
  const present = await stat(join(from, name)).then((entry) => entry.isFile(), () => false);
  if (present) engines[platform] = asset(name, await info(name));
}

const roles = {};
for (const model of models) {
  const found = await info(model.name);
  if (found.sha256 !== model.sha256 || found.bytes !== model.bytes) {
    throw new Error(`${model.name} does not match native/model-sources.json`);
  }
  roles[model.role] = asset(model.name, found);
}
for (const role of ROLES) if (!roles[role]) throw new Error(`native/model-sources.json has no model for ${role}`);

const manifest = { engines, models: Object.fromEntries(ROLES.map((role) => [role, roles[role]])) };
await writeFile(resolve(root, 'manifest/speech-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote manifest/speech-assets.json: ${Object.keys(engines).length} engines and ${ROLES.length} models at ${TAG}`);
