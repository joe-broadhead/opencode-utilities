// Fails if a built binary has the wrong architecture or links anything outside the operating system. Such a change
// needs a reviewed bundling recipe, not a PATH or Homebrew fallback. Prints each binary's minimum OS; writes nothing.
// Usage: node scripts/native-closure.mjs <platform> <binary>...
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { PLATFORMS } from '../src/domain/contract.ts';
const [platform,...binaries]=process.argv.slice(2);
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:64*1024*1024});
// Mach-O: lipo architecture. ELF: objdump file format.
const ARCH=Object.fromEntries(Object.entries(PLATFORMS).map(([platform,p])=>[platform,p.arch]));
// glibc and the GCC runtimes that every glibc distribution ships. ONNX Runtime needs libstdc++ on Linux.
const LINUX=new Set(['libc.so.6','libm.so.6','libpthread.so.0','libdl.so.2','librt.so.1','libgcc_s.so.1','libstdc++.so.6','ld-linux-x86-64.so.2','ld-linux-aarch64.so.1']);
if(!ARCH[platform] || !binaries.length)throw new Error('usage: native-closure.mjs <platform> <binary>...');
const version=v=>v.split('.').map(Number);
const newer=(a,b)=>{const x=version(a),y=version(b);for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??0)!==(y[i]??0))return (x[i]??0)>(y[i]??0);return false;};
for(const binary of binaries) {
  const name=basename(binary);
  if(platform.startsWith('darwin-')) {
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
    const glibc=[...header.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g)].map(m=>m[1]).reduce((a,b)=>newer(b,a)?b:a,'2.0');
    console.log(`${name}: ${format}, glibc ${glibc} or later, system libraries only`);
  }
}
