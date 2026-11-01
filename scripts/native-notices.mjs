// Writes the license notices that ship beside the native files, from actual license files in the locked Cargo graphs.
// Deliberately conservative: includes build and development dependencies.
//   npm/opencode-utilities-bin-<platform>/NOTICE           time-keep and weather-signal, for that platform's target
//   build/speech-assets/utilities-speech-NOTICE.txt        (--speech) the speech engine, for every engine target
// Usage: node scripts/native-notices.mjs <platform> <directory with the time-keep and weather-signal checkouts> [--speech]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [platform,checkouts,flag]=process.argv.slice(2);
const TARGETS={'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-x64-gnu':'x86_64-unknown-linux-gnu','linux-arm64-gnu':'aarch64-unknown-linux-gnu'};
if(!TARGETS[platform] || !checkouts || ![undefined,'--speech'].includes(flag))throw new Error('usage: native-notices.mjs <platform> <checkouts> [--speech]');
const sources=JSON.parse(await readFile(resolve(root,'native/sources.json'),'utf8'));
const onnx=JSON.parse(await readFile(resolve(root,'native/onnx-provenance.json'),'utf8'));
const sha256=text=>createHash('sha256').update(text).digest('hex');
const extraPath='licenses/upstream/cargo-extra-sources.json';
const extra=JSON.parse(await readFile(resolve(root,extraPath),'utf8'));

/** Every package in the locked graphs of `manifests`, resolved for each of `triples`, excluding `skip`. */
function graph(manifests,triples,skip) {
  const packages=new Map();
  for(const manifest of manifests) for(const triple of triples) {
    const metadata=JSON.parse(execFileSync('cargo',[`+${sources.rust}`,'metadata','--locked','--format-version','1','--filter-platform',triple,'--manifest-path',manifest],{encoding:'utf8',maxBuffer:64*1024*1024}));
    const resolved=new Set(metadata.resolve.nodes.map(n=>n.id));
    for(const p of metadata.packages) if(resolved.has(p.id) && !skip.includes(p.name))packages.set(`${p.name}@${p.version}`,p);
  }
  return [...packages].sort(([a],[b])=>a.localeCompare(b));
}
const licenseRE=/^(licen[cs]e|copying|copyright|notice|third[-_]?party[-_]?notices)([._-].*)?$/i;
async function texts(dir,base=dir,depth=0) {
  const found=[];
  for(const e of await readdir(dir,{withFileTypes:true})) {
    if(e.name.startsWith('.') || ['target','node_modules'].includes(e.name))continue;
    const path=resolve(dir,e.name);
    if(e.isDirectory() && depth<8)found.push(...await texts(path,base,depth+1));
    else if(e.isFile() && licenseRE.test(e.name)) {
      const bytes=await readFile(path);
      if(bytes.length>2*1024*1024 || bytes.includes(0))continue;
      found.push({path:relative(base,path),text:bytes.toString('utf8')});
    }
  }
  return found.sort((a,b)=>a.path.localeCompare(b.path));
}
// Some published crates omit their workspace's license. Use the copy fetched earlier from that crate's recorded VCS
// commit, or fetch it now; never a moving branch or a guessed release tag.
async function fetched(id,p) {
  const known=extra.filter(e=>e.package===id);
  if(known.length) return Promise.all(known.map(async e=>{
    const text=await readFile(resolve(root,e.path),'utf8');
    if(sha256(text)!==e.sha256)throw new Error(`${e.path} does not match ${extraPath}`);
    return {path:e.path,text};
  }));
  const vcs=JSON.parse(await readFile(resolve(dirname(p.manifest_path),'.cargo_vcs_info.json'),'utf8'));
  const match=p.repository?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)/);
  if(!match || !/^[0-9a-f]{40}$/.test(vcs.git.sha1))throw new Error(`Missing pinned license source: ${id}`);
  const repo=match[1].replace(/\.git$/,''), files=[];
  for(const filename of ['LICENSE','LICENSE-MIT','LICENSE-APACHE','LICENSE.md','LICENSE.txt','COPYING','NOTICE']) {
    const url=`https://raw.githubusercontent.com/${repo}/${vcs.git.sha1}/${filename}`;
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(response.status===404)continue;
    if(!response.ok)throw new Error(`License fetch failed: ${id}: ${response.status}`);
    const text=await response.text(), path=`licenses/upstream/cargo-extra/${p.name}-${p.version}-${filename}`;
    await mkdir(dirname(resolve(root,path)),{recursive:true});
    await writeFile(resolve(root,path),text);
    extra.push({package:id,path,url,sha256:sha256(text)});
    files.push({path,text});
  }
  if(!files.length)throw new Error(`No license text at pinned source: ${id}`);
  return files;
}
// A text identical to one already in the notice, such as a shared Apache-2.0 text or a workspace's licence copied into
// every crate, is printed once and referred to afterwards. Every crate still lists each of its licence files.
async function crates(packages) {
  let out='';
  const printed=new Map();
  for(const [id,p] of packages) {
    const files=await texts(dirname(p.manifest_path));
    if(p.license_file && !files.some(f=>f.path===p.license_file))files.push({path:p.license_file,text:await readFile(resolve(dirname(p.manifest_path),p.license_file),'utf8')});
    if(!files.length)files.push(...await fetched(id,p));
    out+=`\n${'='.repeat(72)}\n${id}\nLicense expression: ${p.license || '(see source)'}\nSource: ${p.source || p.repository}\n`;
    for(const f of files) {
      const hash=sha256(f.text), first=printed.get(hash);
      if(first) { out+=`\n--- ${f.path} ---\nIdentical to ${first} above.\n`; continue; }
      printed.set(hash,`${f.path} of ${id}`);
      out+=`\n--- ${f.path} ---\n${f.text}\n`;
    }
  }
  return out;
}
const upstream=async name=>(await readFile(resolve(root,'licenses/upstream',name),'utf8')).trimEnd();
const section=(title,text)=>`\n${'='.repeat(72)}\n${title}\n\n${text}\n`;

const pkg=`opencode-utilities-bin-${platform}`;
const names=Object.keys(sources.binaries);
let notice=`@joe-broadhead/${pkg}\n\nThis package contains programs built from pinned sources:\n`;
for(const [name,{repo,commit}] of Object.entries(sources.binaries))notice+=`  bin/${name}  ${repo} at ${commit} (MIT)\n`;
notice+=`\nTheir licenses follow, then the license files of every crate in their locked Cargo graphs for\n${TARGETS[platform]}, including build and development dependencies.\n`;
for(const name of names)notice+=section(`bin/${name}`,await upstream(`${name}-MIT.txt`));
notice+=await crates(graph(names.map(name=>resolve(checkouts,name,'Cargo.toml')),[TARGETS[platform]],names));
await writeFile(resolve(root,'npm',pkg,'NOTICE'),notice);

if(flag==='--speech') {
  const engines=Object.keys(onnx.distributions);
  let speech='utilities-speech, the speech engine of @joe-broadhead/opencode-utilities\n\n';
  speech+=`Built from native/speech-bridge in https://github.com/joe-broadhead/opencode-utilities (MIT) over aurum-core,\n`;
  speech+=`with ONNX Runtime ${onnx.runtimeVersion} linked statically from ${onnx.runtimeSource.repo} at ${onnx.runtimeSource.commit}.\n`;
  speech+=`The speech models are separate release files with their own licenses. The licenses of the bridge, aurum,\n`;
  speech+=`ONNX Runtime and the original Misaki lexicon follow, then the license files of every crate in the locked\nCargo graph for ${engines.join(', ')}, including build and development dependencies.\n`;
  speech+=section('utilities-speech (native/speech-bridge)',(await readFile(resolve(root,'LICENSE'),'utf8')).trimEnd());
  speech+=section('aurum',await upstream('aurum-MIT.txt'));
  speech+=section(`ONNX Runtime ${onnx.runtimeVersion}`,await upstream('onnxruntime-LICENSE.txt'));
  speech+=section(`ONNX Runtime ${onnx.runtimeVersion} third-party notices`,await upstream('onnxruntime-ThirdPartyNotices.txt'));
  speech+=section('Misaki (original lexicon)',await upstream('misaki-original-LICENSE.txt'));
  speech+=await crates(graph([resolve(root,'native/speech-bridge/Cargo.toml')],engines,['utilities-speech']));
  await mkdir(resolve(root,'build/speech-assets'),{recursive:true});
  await writeFile(resolve(root,'build/speech-assets/utilities-speech-NOTICE.txt'),speech);
}
extra.sort((a,b)=>a.path.localeCompare(b.path));
await writeFile(resolve(root,extraPath),JSON.stringify(extra,null,2)+'\n');
console.log(`Wrote the ${platform} NOTICE${flag ? ' and the speech engine notice' : ''}.`);
