// Explicit acquisition of the static ONNX Runtime distribution that ort-sys pins for one Rust target.
// Usage: node scripts/native-onnx.mjs <rust-target> <directory>
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [triple,out]=process.argv.slice(2);
if(!triple || !out)throw new Error('usage: native-onnx.mjs <rust-target> <directory>');
const pin=JSON.parse(await readFile(resolve(root,'native/onnx-provenance.json'),'utf8'));
const dist=pin.distributions[triple];
if(!dist)throw new Error(`ONNX Runtime ${pin.runtimeVersion} has no prebuilt static distribution for ${triple}, so there is no speech engine for it.`);
const dir=resolve(out);
const marker=resolve(dir,'.sha256');
if(await readFile(marker,'utf8').catch(()=>'')===dist.sha256)process.exit(0);
await rm(dir,{recursive:true,force:true});
await mkdir(dir,{recursive:true});
const r=await fetch(dist.url,{signal:AbortSignal.timeout(600_000)});
if(!r.ok)throw new Error(`ONNX download: ${r.status}`);
const chunks=[];let size=0;
for await(const chunk of r.body){size+=chunk.length;if(size>256*1024*1024)throw new Error('ONNX download too large');chunks.push(chunk);}
const bytes=Buffer.concat(chunks);
if(createHash('sha256').update(bytes).digest('hex')!==dist.sha256)throw new Error('ONNX archive integrity mismatch');
const archive=resolve(dir,'pinned.tar.lzma2');await writeFile(archive,bytes);
// The archive is a raw LZMA2 tar of regular files at its root; ort-sys links libonnxruntime.a from there.
execFileSync('python3',['-I','-c',`
import io,lzma,pathlib,sys,tarfile
directory=pathlib.Path(sys.argv[1])
data=lzma.decompress((directory/'pinned.tar.lzma2').read_bytes(),format=lzma.FORMAT_RAW,filters=[{'id':lzma.FILTER_LZMA2,'dict_size':1<<26}])
assert len(data)<1024*1024*1024
with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as tar:
    for m in tar.getmembers():
        if m.isdir():continue
        name=m.name.removeprefix('./')
        assert m.isfile() and name and '/' not in name and not name.startswith('.'),m.name
        (directory/name).write_bytes(tar.extractfile(m).read())
assert (directory/'libonnxruntime.a').is_file()
`,dir]);
await rm(archive);
await writeFile(marker,dist.sha256);
console.log(`Verified ONNX Runtime ${pin.runtimeVersion} for ${triple}`);
