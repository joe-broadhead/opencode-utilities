// Fails if a built binary has the wrong architecture or links anything outside the operating system. Such a change
// needs a reviewed bundling recipe, not a PATH or Homebrew fallback. Prints each binary's minimum OS; writes nothing.
// Usage:
//   node scripts/native-closure.mjs <platform> <binary>...                 architecture, libraries, and the glibc floor printed
//   node scripts/native-closure.mjs --floors <platform> <binary>...        also refuses a Linux binary above its floor
//   node scripts/native-closure.mjs --floors-only <platform> <binary>...   only the floor check, for binaries built on
//                                                                          another runner (readelf reads any architecture)
// The floors are GLIBC_FLOORS in src/domain/contract.ts: 2.35 for time-keep and weather-signal (built on Ubuntu 22.04),
// 2.39 for the speech engine (built on Ubuntu 24.04). A binary's floor is the newest GLIBC_ version it requires.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { GLIBC_FLOORS, PLATFORMS } from '../src/domain/contract.ts';
const args=process.argv.slice(2);
const mode=args[0]==='--floors' || args[0]==='--floors-only' ? args.shift() : undefined;
const [platform,...binaries]=args;
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:64*1024*1024});
// Mach-O: lipo architecture. ELF: objdump file format.
const ARCH=Object.fromEntries(Object.entries(PLATFORMS).map(([platform,p])=>[platform,p.arch]));
// glibc and the GCC runtimes that every glibc distribution ships. ONNX Runtime needs libstdc++ on Linux.
const LINUX=new Set(['libc.so.6','libm.so.6','libpthread.so.0','libdl.so.2','librt.so.1','libgcc_s.so.1','libstdc++.so.6','ld-linux-x86-64.so.2','ld-linux-aarch64.so.1']);
if(!ARCH[platform] || !binaries.length)throw new Error('usage: native-closure.mjs [--floors | --floors-only] <platform> <binary>...');
if(mode==='--floors-only' && !platform.startsWith('linux-'))throw new Error('--floors-only checks Linux binaries only');
const version=v=>v.split('.').map(Number);
const newer=(a,b)=>{const x=version(a),y=version(b);for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??0)!==(y[i]??0))return (x[i]??0)>(y[i]??0);return false;};

/** The newest GLIBC_ version the binary requires, from its version needs (readelf reads an ELF of any architecture). */
function glibcOf(binary) {
  const needs=run('readelf',['-V','-W',binary]);
  return [...needs.matchAll(/\bName: GLIBC_(\d+(?:\.\d+)+)\b/g)].map(m=>m[1]).reduce((a,b)=>newer(b,a)?b:a,'2.0');
}

/** The floor a release binary must meet: the speech engine's, or the program's own. */
function floorOf(name) {
  const key=name.startsWith('utilities-speech-') ? 'utilities-speech' : name;
  const floor=GLIBC_FLOORS[key];
  if(!floor)throw new Error(`${name}: no glibc floor in GLIBC_FLOORS`);
  return floor;
}

/** Refuses a binary above its floor, under --floors and --floors-only; otherwise only names it. */
function checkFloor(name,glibc) {
  if(!mode)return '';
  const floor=floorOf(name);
  if(newer(glibc,floor))throw new Error(`${name}: requires glibc ${glibc}, above its floor ${floor}; build it on a runner with glibc ${floor}`);
  return ` (floor ${floor})`;
}

for(const binary of binaries) {
  const name=basename(binary);
  if(mode==='--floors-only') {
    const glibc=glibcOf(binary);
    console.log(`${name}: glibc ${glibc} or later${checkFloor(name,glibc)}`);
  } else if(platform.startsWith('darwin-')) {
    const architecture=run('lipo',['-archs',binary]).trim();
    if(architecture!==ARCH[platform])throw new Error(`${name}: architecture ${architecture}, expected ${ARCH[platform]}`);
    for(const line of run('otool',['-L',binary]).trim().split('\n').slice(1)) {
      const dependency=line.trim().split(' (')[0];
      if(!dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/Frameworks/'))throw new Error(`${name}: links ${dependency}, which macOS does not provide`);
    }
    const minimum=run('otool',['-l',binary]).match(/\bminos\s+(\S+)/)?.[1];
    if(!minimum)throw new Error(`${name}: no Mach-O platform load command`);
    console.log(`${name}: ${architecture}, macOS ${minimum} or later, system libraries only`);
  } else {
    const header=run('objdump',['-p',binary]);
    const format=header.match(/file format (\S+)/)?.[1];
    if(format!==ARCH[platform])throw new Error(`${name}: format ${format}, expected ${ARCH[platform]}`);
    for(const [,dependency] of header.matchAll(/^\s*NEEDED\s+(\S+)/gm)) {
      if(!LINUX.has(dependency))throw new Error(`${name}: links ${dependency}, which a glibc system does not provide`);
    }
    const glibc=glibcOf(binary);
    console.log(`${name}: ${format}, glibc ${glibc} or later${checkFloor(name,glibc)}, system libraries only`);
  }
}
