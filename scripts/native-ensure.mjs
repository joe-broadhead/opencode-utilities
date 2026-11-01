// Makes sure this machine's native files are built from the current inputs. npm run check runs it first, so the pack
// test resolves and hashes a freshly built platform package. It runs scripts/native-build.sh when an output is
// missing or an input changed, and does nothing otherwise. Without Rust it fails and names npm run native:build; it
// never skips.
// Usage:
//   node scripts/native-ensure.mjs                       ensure this platform
//   node scripts/native-ensure.mjs --record <platform>    (native-build.sh) record the inputs of a finished build
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const TARGETS={'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-x64-gnu':'x86_64-unknown-linux-gnu','linux-arm64-gnu':'aarch64-unknown-linux-gnu'};
const json=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
const stamp=platform=>join(root,'build',`native-${platform}.inputs`);

/** Everything a build reads: pins, locks, the bridge source, the build scripts, license inputs and the versions. */
function inputs(platform) {
  const files=[];
  const walk=dir=>{for(const e of readdirSync(join(root,dir),{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory()){if(e.name!=='target')walk(path);}else files.push(path);}};
  walk('native'); walk('licenses/upstream');
  files.push(...readdirSync(join(root,'scripts')).filter(f=>f.startsWith('native-')).map(f=>join('scripts',f)));
  const hash=createHash('sha256');
  for(const file of files.sort())hash.update(`${file}\0`).update(readFileSync(join(root,file))).update('\0');
  hash.update(`version\0${json('package.json').version}\0${json(`npm/opencode-utilities-bin-${platform}/package.json`).version}`);
  return hash.digest('hex');
}

const [mode,recorded]=process.argv.slice(2);
if(mode==='--record') {
  if(!TARGETS[recorded])throw new Error(`unknown platform: ${recorded}`);
  mkdirSync(join(root,'build'),{recursive:true});
  writeFileSync(stamp(recorded),inputs(recorded)+'\n');
  process.exit(0);
}
if(mode!==undefined)throw new Error('usage: native-ensure.mjs [--record <platform>]');

const platform=process.platform==='linux' ? `linux-${process.arch}-gnu` : `${process.platform}-${process.arch}`;
if(!TARGETS[platform]) { console.error(`There is no platform package for ${process.platform}-${process.arch}, so the native files cannot be built here.`); process.exit(1); }
const pkg=`npm/opencode-utilities-bin-${platform}`;
const engine=Boolean(json('native/onnx-provenance.json').distributions[TARGETS[platform]]);
const outputs=[`${pkg}/bin/time-keep`,`${pkg}/bin/weather-signal`,`${pkg}/NOTICE`,`${pkg}/provenance.json`,'manifest/backends.json','manifest/speech-assets.json',
  ...json('native/model-sources.json').assets.map(a=>`build/speech-assets/${a.name}`),
  ...engine ? [`build/speech-assets/utilities-speech-${platform}`,'build/speech-assets/utilities-speech-NOTICE.txt'] : []];
const fresh=()=>{
  const missing=outputs.filter(file=>!existsSync(join(root,file)));
  if(missing.length)return `missing ${missing.join(', ')}`;
  if((existsSync(stamp(platform)) ? readFileSync(stamp(platform),'utf8').trim() : '')!==inputs(platform))return 'built from other inputs';
  const check=spawnSync(process.execPath,[join(root,'scripts/native-manifest.mjs'),'--check'],{cwd:root,encoding:'utf8'});
  return check.status===0 ? undefined : check.stderr.trim();
};
const stale=fresh();
if(!stale) { console.log(`The ${platform} native files are up to date.`); process.exit(0); }
console.log(`The ${platform} native files need a build: ${stale}`);
const rust=json('native/sources.json').rust;
if(spawnSync('rustup',['run',rust,'cargo','--version'],{stdio:'ignore'}).status!==0) {
  console.error(`The native files cannot be built: the Rust ${rust} toolchain is not installed. Install rustup (https://rustup.rs), run rustup toolchain install ${rust}, then run npm run native:build.`);
  process.exit(1);
}
const build=spawnSync('bash',[join(root,'scripts/native-build.sh'),platform],{cwd:root,stdio:'inherit'});
if(build.status!==0)process.exit(build.status ?? 1);
const after=fresh();
if(after) { console.error(`npm run native:build finished, but the native files are still not usable: ${after}`); process.exit(1); }
