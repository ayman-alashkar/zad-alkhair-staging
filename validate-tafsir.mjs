// node validate-tafsir.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root = process.argv[2] || './data/tafsir/al-wajeez';
const index = JSON.parse(fs.readFileSync(path.join(root,'index.json'),'utf8'));
let total=0;
for (const item of index.surah_files) {
  const f=path.join(root,item.file);
  const obj=JSON.parse(fs.readFileSync(f,'utf8'));
  if (obj.surah !== item.surah || Object.keys(obj.ayahs).length !== item.ayah_count) throw new Error(`Bad surah ${item.surah}`);
  for (const [a,v] of Object.entries(obj.ayahs)) {
    const h=crypto.createHash('sha256').update(v.text,'utf8').digest('hex');
    if (h!==v.sha256) throw new Error(`SHA mismatch ${item.surah}:${a}`);
    total++;
  }
}
if(total!==6236) throw new Error(`Expected 6236, got ${total}`);
const fadl=JSON.parse(fs.readFileSync(path.join(root,index.fadl_file),'utf8'));
if(fadl.records.length!==60) throw new Error(`Expected 60 fadl records`);
for(const r of fadl.records){const h=crypto.createHash('sha256').update(r.text,'utf8').digest('hex');if(h!==r.sha256)throw new Error(`Fadl SHA mismatch ${r.key}`)}
console.log('TAFSIR DATASET PASS', {ayah_records:total,fadl_records:fadl.records.length});
