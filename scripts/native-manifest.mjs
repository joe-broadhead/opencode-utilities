// Generates manifest/backends.json and manifest/speech-assets.json from the native files present:
//   npm/opencode-utilities-bin-<platform>/bin/{time-keep,weather-signal}
//   build/speech-assets/utilities-speech-<platform> and the four models pinned in native/model-sources.json
// Usage:
//   node scripts/native-manifest.mjs                         write both manifests
//   node scripts/native-manifest.mjs --provenance <platform> write that platform package's provenance.json
//   node scripts/native-manifest.mjs --check                 fail unless the manifests, provenance and versions match the files
//   node scripts/native-manifest.mjs --check --release       also require every platform, and an engine wherever one can be built
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const TARGETS={'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-x64-gnu':'x86_64-unknown-linux-gnu','linux-arm64-gnu':'aarch64-unknown-linux-gnu'};
const RELEASES='https://github.com/joe-broadhead/opencode-utilities/releases/download';
const json=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const text=value=>JSON.stringify(value,null,2)+'\n';
const packageDir=platform=>`npm/opencode-utilities-bin-${platform}`;
const engineName=platform=>`utilities-speech-${platform}`;
const sources=await json('native/sources.json');
const {version}=await json('package.json');
const {assets:models}=await json('native/model-sources.json');

/** The file's size and SHA-256, or undefined when it is absent. Only regular files are accepted. */
async function file(path,executable) {
  const info=await lstat(resolve(root,path)).catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});
  if(!info)return undefined;
  if(!info.isFile())throw new Error(`${path} is not a regular file`);
  if(executable && (info.mode&0o111)!==0o111)throw new Error(`${path} is not executable`);
  const bytes=await readFile(resolve(root,path));
  return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const binaries=Object.entries(sources.binaries);

async function backends() {
  const platforms={};
  for(const platform of Object.keys(TARGETS)) {
    const entry={};
    for(const [name,{module}] of binaries) {
      const found=await file(`${packageDir(platform)}/bin/${name}`,true);
      if(found)entry[module]={path:`bin/${name}`,sha256:found.sha256};
    }
    const count=Object.keys(entry).length;
    if(count && count!==binaries.length)throw new Error(`${packageDir(platform)}/bin/ has only some of ${binaries.map(([n])=>n).join(', ')}`);
    if(count)platforms[platform]=Object.fromEntries(['time','weather'].map(m=>[m,entry[m]]));
  }
  return {platforms};
}

async function speechAssets() {
  const asset=(name,found)=>({name,url:`${RELEASES}/v${version}/${name}`,sha256:found.sha256,bytes:found.bytes});
  const engines={};
  for(const platform of Object.keys(TARGETS)) {
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

async function provenance(platform) {
  const toolchain=execFileSync('rustc',[`+${sources.rust}`,'-V'],{encoding:'utf8'}).trim();
  const entries={};
  for(const [name,{repo,commit}] of binaries) {
    const found=await file(`${packageDir(platform)}/bin/${name}`,true);
    if(!found)throw new Error(`${packageDir(platform)}/bin/${name} is missing`);
    entries[`bin/${name}`]={source:{repo,commit},sha256:found.sha256};
  }
  return {package:`@joe-broadhead/opencode-utilities-bin-${platform}`,target:TARGETS[platform],toolchain,binaries:entries};
}

const [mode,platform,...rest]=process.argv.slice(2);
if(mode==='--provenance' && rest.length===0) {
  if(!TARGETS[platform])throw new Error(`unknown platform: ${platform}`);
  await writeFile(resolve(root,packageDir(platform),'provenance.json'),text(await provenance(platform)));
} else if(mode==='--check' && [undefined,'--release'].includes(platform) && rest.length===0) {
  const problems=[], generated={backends:await backends(),speech:await speechAssets()};
  for(const [path,expected] of [['manifest/backends.json',generated.backends],['manifest/speech-assets.json',generated.speech]]) {
    if(await readFile(resolve(root,path),'utf8').catch(()=>'')!==text(expected))problems.push(`${path} does not match the files; run node scripts/native-manifest.mjs`);
  }
  if(platform==='--release') {
    const {distributions}=await json('native/onnx-provenance.json');
    for(const [p,triple] of Object.entries(TARGETS)) {
      if(!generated.backends.platforms[p])problems.push(`release: no ${p} binaries`);
      if(Boolean(distributions[triple])!==Boolean(generated.speech.engines[p]))problems.push(`release: the ${p} speech engine is ${distributions[triple] ? 'missing' : 'unexpected'}`);
    }
  }
  for(const p of Object.keys(TARGETS)) {
    const pkg=await json(`${packageDir(p)}/package.json`);
    if(pkg.name!==`@joe-broadhead/opencode-utilities-bin-${p}`)problems.push(`${packageDir(p)}: name ${pkg.name}`);
    if(pkg.version!==version)problems.push(`${packageDir(p)}: version ${pkg.version}, but the main package is ${version}`);
    if(pkg.scripts)problems.push(`${packageDir(p)}: has scripts`);
    const prov=await readFile(resolve(root,packageDir(p),'provenance.json'),'utf8').then(JSON.parse,()=>undefined);
    const built=await file(`${packageDir(p)}/bin/${binaries[0][0]}`,true);
    if(!built){if(prov)problems.push(`${packageDir(p)}: provenance.json without binaries`);continue;}
    if(!prov){problems.push(`${packageDir(p)}: binaries without provenance.json`);continue;}
    if(prov.package!==pkg.name || prov.target!==TARGETS[p] || !/^rustc \d/.test(prov.toolchain ?? ''))problems.push(`${packageDir(p)}/provenance.json: wrong package, target or toolchain`);
    for(const [name,{repo,commit}] of binaries) {
      const recorded=prov.binaries?.[`bin/${name}`], found=await file(`${packageDir(p)}/bin/${name}`,true);
      if(recorded?.sha256!==found?.sha256 || recorded?.source?.repo!==repo || recorded?.source?.commit!==commit)problems.push(`${packageDir(p)}/provenance.json: bin/${name} does not match`);
    }
    if(!await file(`${packageDir(p)}/NOTICE`,false))problems.push(`${packageDir(p)}: NOTICE is missing`);
  }
  if(problems.length){for(const p of problems)console.error(p);process.exit(1);}
  console.log('The manifests, provenance and versions match the native files.');
} else if(mode===undefined && platform===undefined) {
  await mkdir(resolve(root,'manifest'),{recursive:true});
  await writeFile(resolve(root,'manifest/backends.json'),text(await backends()));
  await writeFile(resolve(root,'manifest/speech-assets.json'),text(await speechAssets()));
} else throw new Error('usage: native-manifest.mjs [--provenance <platform> | --check]');
