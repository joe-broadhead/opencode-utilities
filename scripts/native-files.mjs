// Writes the release manifests from the native files present:
//   manifest/native.json          time-keep and weather-signal, per platform: the gzip of each executable, pinned by
//                                 its size and SHA-256 and the executable's own size and SHA-256 (NATIVE-DESIGN.md)
//   manifest/speech-assets.json   the speech engine (build/speech-assets/utilities-speech-<platform>) and the four
//                                 models pinned in native/model-sources.json, as release files
// Every URL is the release asset of this repository at v<package version>.
// Usage:
//   node scripts/native-files.mjs [--commit <sha> --run <id>]   write both manifests (the release passes the build's
//                                                                    commit and workflow run; a checkout writes zeros)
//   node scripts/native-files.mjs --check                        fail unless both manifests match the files
//   node scripts/native-files.mjs --check --release              also require every platform, and an engine wherever one can be built
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PLATFORMS } from '../src/domain/contract.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REPOSITORY='joe-broadhead/opencode-utilities';
const json=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const text=value=>JSON.stringify(value,null,2)+'\n';
const nativeDir=platform=>`build/native/${platform}`;
const engineName=platform=>`utilities-speech-${platform}`;
const sources=await json('native/sources.json');
const {version}=await json('package.json');
const TAG=`v${version}`;
const {assets:models}=await json('native/model-sources.json');
const RELEASE=name=>`https://github.com/${REPOSITORY}/releases/download/${TAG}/${name}`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** The file's bytes and SHA-256, or undefined when it is absent. Only regular files are accepted. */
async function file(path,executable) {
  const info=await lstat(resolve(root,path)).catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});
  if(!info)return undefined;
  if(!info.isFile())throw new Error(`${path} is not a regular file`);
  if(executable && (info.mode&0o111)!==0o111)throw new Error(`${path} is not executable`);
  const bytes=await readFile(resolve(root,path));
  return {bytes:bytes.length,sha256:sha(bytes),data:bytes};
}
const binaries=Object.entries(sources.binaries).map(([name,{module}])=>({name,module}));

/** The release manifest for the native programs, from build/native/<platform>/<name>. */
async function native(built) {
  const modules={};
  for(const {name,module} of binaries) {
    const platforms={};
    for(const platform of Object.keys(PLATFORMS)) {
      const found=await file(`${nativeDir(platform)}/${name}`,true);
      if(!found)continue;
      const gz=gzipSync(found.data,{level:9}), asset=`${name}-${platform}.gz`;
      platforms[platform]={name:asset,url:RELEASE(asset),bytes:gz.length,sha256:sha(gz),executable:{name,bytes:found.bytes,sha256:found.sha256}};
    }
    if(Object.keys(platforms).length)modules[name]=platforms;
  }
  return {schema:1,plugin:'opencode-utilities',repository:REPOSITORY,tag:TAG,built,modules};
}

/** The speech engine and the models, as release files under the same tag. */
async function speechAssets() {
  const asset=(name,found)=>({name,url:RELEASE(name),sha256:found.sha256,bytes:found.bytes});
  const engines={};
  for(const platform of Object.keys(PLATFORMS)) {
    const found=await file(`build/speech-assets/${engineName(platform)}`,true);
    if(found)engines[platform]=asset(engineName(platform),found);
  }
  const roles={};
  for(const m of models) {
    const found=await file(`build/speech-assets/${m.name}`,false);
    if(!found)throw new Error(`build/speech-assets/${m.name} is missing: run node scripts/native-models.mjs`);
    if(found.sha256!==m.sha256 || found.bytes!==m.bytes)throw new Error(`build/speech-assets/${m.name} does not match native/model-sources.json`);
    roles[m.role]=asset(m.name,found);
  }
  const manifest={engines,models:Object.fromEntries(['tiny-q5_1','kitten-model','kitten-voices','kitten-config'].map(r=>[r,roles[r]]))};
  const all=[...Object.values(manifest.engines),...Object.values(manifest.models)];
  // The pre-seed folder and the release are flat, so every name is unique.
  if(new Set(all.map(a=>a.name)).size!==all.length)throw new Error('speech asset names are not unique');
  for(const a of all)if(new URL(a.url).protocol!=='https:')throw new Error(`${a.name}: not an HTTPS URL`);
  return manifest;
}

const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const mode=args.includes('--check')?'check':'write';
if(mode==='write') {
  const commit=flag('--commit')??'0'.repeat(40), run=Number(flag('--run')??0);
  if(!/^[a-f0-9]{40}$/.test(commit)||!Number.isInteger(run))throw new Error('--commit needs a 40-hex commit, --run a workflow run id');
  await mkdir(resolve(root,'manifest'),{recursive:true});
  await writeFile(resolve(root,'manifest/native.json'),text(await native({commit,run,workflow:'native'})));
  await writeFile(resolve(root,'manifest/speech-assets.json'),text(await speechAssets()));
} else {
  const problems=[];
  const recorded=await json('manifest/native.json').catch(()=>undefined);
  const generated=await native(recorded?.built??{commit:'0'.repeat(40),run:0,workflow:'native'});
  if(JSON.stringify(recorded)!==JSON.stringify(generated)) problems.push('manifest/native.json does not match the files; run node scripts/native-files.mjs');
  const speech=await speechAssets();
  if(await readFile(resolve(root,'manifest/speech-assets.json'),'utf8').catch(()=>'')!==text(speech))problems.push('manifest/speech-assets.json does not match the files; run node scripts/native-files.mjs');
  if(args.includes('--release')) {
    const {distributions}=await json('native/onnx-provenance.json');
    for(const [p,info] of Object.entries(PLATFORMS)) {
      if(!generated.modules['time-keep']?.[p])problems.push(`release: no ${p} time-keep`);
      if(Boolean(distributions[info.triple])!==Boolean(speech.engines[p]))problems.push(`release: the ${p} speech engine is ${distributions[info.triple] ? 'missing' : 'unexpected'}`);
    }
  }
  if(problems.length){for(const p of problems)console.error(p);process.exit(1);}
  console.log('The release manifests match the native files.');
}
