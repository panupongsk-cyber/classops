import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,resolve,basename} from 'node:path';
import {z} from 'zod';
import {packageHash} from '../activities/engine.js';
import {withTransaction,type DatabaseClient,type DatabasePool} from '../db.js';
import {validateLibraryPackage,type LibraryPackage} from './package.js';

type Item={source_id:string;seq:number;content:Record<string,unknown>};
type Figure={id:string;sha256:string};
export type PaperSnapshot={paper_id:string;revision:string;metadata:Record<string,unknown>;questions:Item[];figures:Figure[];source_commit:string;source_path:string;package_format:string;package_sha256:string|null};
export type ReleaseInput={revision:string;papers:PaperSnapshot[];media:Map<string,Buffer>};
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const paperIdentity=(p:Pick<PaperSnapshot,'paper_id'|'metadata'|'questions'|'figures'>)=>packageHash({paper_id:p.paper_id,metadata:p.metadata,questions:p.questions,figures:p.figures});
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function releaseInput(papers:PaperSnapshot[],media=new Map<string,Buffer>()):ReleaseInput{
 papers=[...papers].sort((a,b)=>order(a.paper_id,b.paper_id));
 if(new Set(papers.map(p=>p.paper_id)).size!==papers.length)throw Error('Duplicate paper IDs');
 return {revision:packageHash(papers.map(p=>({paper_id:p.paper_id,revision:p.revision}))),papers,media};
}
export function preparePackages(packages:LibraryPackage[]):ReleaseInput{
 const media=new Map<string,Buffer>();
 const papers=packages.map(pkg=>{
  const errors=validateLibraryPackage(pkg);if(errors.length)throw Error('Invalid library package: '+errors.join('; '));
  const p:PaperSnapshot={paper_id:pkg.paper.exam.content_id,revision:'',metadata:{...pkg.paper.exam,family:pkg.paper.family},questions:pkg.paper.questions.map(q=>({source_id:q.content_id,seq:q.seq,content:q as unknown as Record<string,unknown>})).sort((a,b)=>a.seq-b.seq),figures:pkg.paper.figures.map(f=>({id:f.id,sha256:f.sha256})).sort((a,b)=>order(a.id,b.id)),source_commit:pkg.source.commit,source_path:pkg.source.path,package_format:pkg.format,package_sha256:null};
  p.revision=paperIdentity(p);
  for(const f of pkg.paper.figures)media.set(f.sha256,Buffer.from(f.data_base64,'base64'));
  return p;
 });
 return releaseInput(papers,media);
}
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const inventorySchema=z.object({format:z.literal('ps-library-inventory/v1').optional(),source_commit:z.string().regex(/^[a-f0-9]{40}$/),total_sets:z.number().int().positive(),total_items:z.number().int().positive(),sets:z.array(z.object({slug:z.string(),paper_id:z.string(),file:z.string(),source_ids:z.array(z.string()),content_ids:z.array(z.string()),count:z.number().int().positive(),figures:z.number().int().nonnegative(),sha256:digest,package_format:z.enum(['ps-library-package/v1','ps-library-package/v2']).optional(),media:z.array(z.object({id:z.string(),sha256:digest})).optional()}).strict()).min(1)}).strict();
export async function loadInventory(filename:string):Promise<ReleaseInput>{
 const inventory=inventorySchema.parse(JSON.parse(await readFile(filename,'utf8'))),root=await realpath(dirname(resolve(filename)));
 if(inventory.sets.length!==inventory.total_sets||new Set(inventory.sets.map(s=>s.file)).size!==inventory.sets.length)throw Error('Inventory set count/duplicate files');
 const papers:PaperSnapshot[]=[],media=new Map<string,Buffer>();
 for(const entry of inventory.sets){
  if(basename(entry.file)!==entry.file||entry.file==='inventory.json')throw Error('Unsafe inventory path');
  const file=await realpath(resolve(root,entry.file));if(dirname(file)!==root)throw Error('Inventory file escapes directory');
  const bytes=await readFile(file);if(sha(bytes)!==entry.sha256)throw Error('Package checksum mismatch: '+entry.paper_id);
  const pkg=JSON.parse(bytes.toString()) as LibraryPackage;
  const prepared=preparePackages([pkg]),paper=prepared.papers[0]!;
  if(pkg.source.commit!==inventory.source_commit||paper.paper_id!==entry.paper_id||paper.questions.length!==entry.count||paper.figures.length!==entry.figures||packageHash(paper.questions.map(q=>q.source_id))!==packageHash(entry.content_ids)||packageHash(paper.questions.map(q=>String(q.content.source_number??q.seq)))!==packageHash(entry.source_ids))throw Error('Inventory source/ID/count mismatch: '+entry.paper_id);
  if(inventory.format&&(!entry.package_format||!entry.media))throw Error('Versioned inventory requires package format/media hashes');
  if(entry.package_format&&entry.package_format!==pkg.format)throw Error('Inventory package version mismatch');
  if(entry.media&&packageHash([...entry.media].sort((a,b)=>order(a.id,b.id)))!==packageHash(paper.figures))throw Error('Inventory media hash mismatch');
  paper.package_sha256=entry.sha256;papers.push(paper);for(const [key,value]of prepared.media)media.set(key,value);
 }
 if(papers.reduce((n,p)=>n+p.questions.length,0)!==inventory.total_items)throw Error('Inventory total item count mismatch');
 return releaseInput(papers,media);
}
async function readProjection(client:DatabaseClient,includeBytes:boolean){
 const papers:PaperSnapshot[]=[],media=new Map<string,Buffer>();
 const exams=(await client.query('SELECT source_id,metadata,source_commit,source_path FROM library_exams ORDER BY source_id COLLATE "C"')).rows;
 for(const exam of exams){
  const questions=(await client.query('SELECT source_id,seq,content FROM library_questions WHERE exam_id=$1 ORDER BY seq',[exam.source_id])).rows as Item[];
  const figs=(await client.query(`SELECT source_id,sha256${includeBytes?',data':''} FROM library_figures WHERE exam_id=$1 ORDER BY source_id COLLATE "C"`,[exam.source_id])).rows;
  const paper:PaperSnapshot={paper_id:exam.source_id,revision:'',metadata:exam.metadata,questions,figures:figs.map(f=>({id:f.source_id,sha256:f.sha256})),source_commit:exam.source_commit,source_path:exam.source_path,package_format:'source_notes' in exam.metadata?'ps-library-package/v2':'ps-library-package/v1',package_sha256:null};
  paper.revision=paperIdentity(paper);papers.push(paper);
  if(includeBytes)for(const f of figs){if(sha(f.data)!==f.sha256)throw Error('Existing library media checksum mismatch');media.set(f.sha256,f.data)}
 }
 return releaseInput(papers,media);
}
async function current(client:DatabaseClient){
 const head=(await client.query('SELECT active_revision,activated_at FROM library_release_state WHERE singleton')).rows[0];
 const input=await readProjection(client,!head);
 if(head&&head.active_revision!==input.revision)throw Error('Active library projection does not match its release');
 return {input,token:head?.active_revision??'legacy:'+input.revision,head};
}
function diff(before:ReleaseInput,after:ReleaseInput){
 const old=new Map(before.papers.map(p=>[p.paper_id,p]));const fresh=new Map(after.papers.map(p=>[p.paper_id,p]));
 const papers=[...new Set([...old.keys(),...fresh.keys()])].sort().map(id=>{
  const a=old.get(id),b=fresh.get(id),oldItems=new Map(a?.questions.map(q=>[q.source_id,q.content])),newItems=new Map(b?.questions.map(q=>[q.source_id,q.content]));
  const oldMedia=new Map(a?.figures.map(f=>[f.id,f.sha256])),newMedia=new Map(b?.figures.map(f=>[f.id,f.sha256]));
  const metadataChanged=[...new Set([...Object.keys(a?.metadata??{}),...Object.keys(b?.metadata??{})])].sort().filter(key=>packageHash({value:a?.metadata[key]})!==packageHash({value:b?.metadata[key]}));
  return {metadata_changed:metadataChanged,media_added:[...newMedia.keys()].filter(id=>!oldMedia.has(id)),media_removed:[...oldMedia.keys()].filter(id=>!newMedia.has(id)),media_changed:[...newMedia.keys()].filter(id=>oldMedia.has(id)&&newMedia.get(id)!==oldMedia.get(id)),paper_id:id,status:!a?'added':!b?'removed':a.revision===b.revision?'unchanged':'changed',added:[...newItems.keys()].filter(id=>!oldItems.has(id)),removed:[...oldItems.keys()].filter(id=>!newItems.has(id)),changed:[...newItems.keys()].filter(id=>oldItems.has(id)&&packageHash(oldItems.get(id))!==packageHash(newItems.get(id))),media_before:a?.figures.length??0,media_after:b?.figures.length??0};
 });
 return {expected_active:before.revision,target_revision:after.revision,total_sets:after.papers.length,total_items:after.papers.reduce((n,p)=>n+p.questions.length,0),papers};
}
function verifyInput(input:ReleaseInput){
 if(releaseInput(input.papers).revision!==input.revision)throw Error('Release identity mismatch');
 for(const p of input.papers){if(paperIdentity(p)!==p.revision)throw Error('Paper revision mismatch');for(const f of p.figures){const bytes=input.media.get(f.sha256);if(!bytes||sha(bytes)!==f.sha256)throw Error('Release media missing or corrupt')}}
}
export function manifest(input:ReleaseInput){return {format:'ps-library-release/v1',revision:input.revision,total_sets:input.papers.length,total_items:input.papers.reduce((n,p)=>n+p.questions.length,0),sets:input.papers.map(p=>({paper_id:p.paper_id,revision:p.revision,source_commit:p.source_commit,source_path:p.source_path,package_format:p.package_format,package_sha256:p.package_sha256,item_ids:p.questions.map(q=>q.source_id),source_ids:p.questions.map(q=>String(q.content.source_number??q.seq)),count:p.questions.length,media:p.figures}))}}
async function store(client:DatabaseClient,input:ReleaseInput){
 verifyInput(input);
 for(const [hash,data]of input.media)await client.query('INSERT INTO library_media_blobs(sha256,mime,data) VALUES($1,\'image/png\',$2) ON CONFLICT DO NOTHING',[hash,data]);
 for(const p of input.papers)await client.query('INSERT INTO library_paper_revisions(revision,paper_id,metadata,questions,figures,source_commit,source_path,package_format) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8) ON CONFLICT DO NOTHING',[p.revision,p.paper_id,JSON.stringify(p.metadata),JSON.stringify(p.questions),JSON.stringify(p.figures),p.source_commit,p.source_path,p.package_format]);
 const result=await client.query('INSERT INTO library_releases(revision,manifest) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING revision',[input.revision,JSON.stringify(manifest(input))]);
 if(result.rowCount)for(const p of input.papers)await client.query('INSERT INTO library_release_papers(release_revision,paper_id,paper_revision) VALUES($1,$2,$3)',[input.revision,p.paper_id,p.revision]);
}
export async function loadArchivedRelease(client:DatabaseClient,revision:string):Promise<ReleaseInput>{
 if(!/^[a-f0-9]{64}$/.test(revision))throw Error('Invalid release revision');
 const release=(await client.query('SELECT manifest FROM library_releases WHERE revision=$1',[revision])).rows[0];if(!release)throw Error('Unknown library release');
 const rows=(await client.query('SELECT p.* FROM library_paper_revisions p JOIN library_release_papers r ON r.paper_revision=p.revision WHERE r.release_revision=$1 ORDER BY p.paper_id COLLATE "C"',[revision])).rows;
 const papers=rows.map(r=>{const entry=release.manifest.sets.find((s:{paper_id:string})=>s.paper_id===r.paper_id);if(!entry)throw Error('Missing archived manifest entry');return {...r,source_commit:entry.source_commit,source_path:entry.source_path,package_format:entry.package_format,package_sha256:entry.package_sha256}}) as PaperSnapshot[];
 const hashes=[...new Set(papers.flatMap(p=>p.figures.map(f=>f.sha256)))];
 const media=new Map<string,Buffer>((await client.query('SELECT sha256,data FROM library_media_blobs WHERE sha256=ANY($1::text[])',[hashes])).rows.map(r=>[r.sha256,r.data]));
 const input=releaseInput(papers,media);verifyInput(input);
 if(packageHash(manifest(input))!==packageHash(release.manifest))throw Error('Archived manifest mismatch');
 if(input.revision!==revision||release.manifest.total_sets!==papers.length||release.manifest.total_items!==papers.reduce((n,p)=>n+p.questions.length,0))throw Error('Archived release inventory mismatch');
 return input;
}
export async function previewRelease(pool:DatabasePool,target:ReleaseInput|string){
 return withTransaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const before=await current(client),after=typeof target==='string'?await loadArchivedRelease(client,target):target;
  verifyInput(after);return {...diff(before.input,after),expected_active:before.token,approval_digest:packageHash(manifest(after)),manifest:manifest(after)};
 });
}
export async function activateRelease(pool:DatabasePool,target:ReleaseInput|string,options:{expectedActive:string;targetRevision:string;approvalDigest:string;operator:string;reason:string}){
 if(!options.operator.trim()||options.operator.length>120||!options.reason.trim()||options.reason.length>1000)throw Error('Explicit operator and reason required');
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('library:publication'))");
  const before=await current(client),after=typeof target==='string'?await loadArchivedRelease(client,target):target;verifyInput(after);
  if(options.targetRevision!==after.revision||options.approvalDigest!==packageHash(manifest(after)))throw Error('Target changed since preview');
  for(const p of after.papers){const prior=before.input.papers.find(a=>a.paper_id===p.paper_id);if(prior)for(const q of p.questions){const previous=prior.questions.find(a=>a.source_id===q.source_id);if(previous&&String(previous.content.source_number??previous.seq)!==String(q.content.source_number??q.seq))throw Error('Stable item ID cannot change source number')}}
  if(before.input.revision===after.revision&&before.head)return {status:'unchanged',revision:after.revision};
  if(before.token!==options.expectedActive)throw Error('Active release changed; preview again');
  if(!before.head){await store(client,before.input);await client.query('INSERT INTO library_activation_history(revision,operator,reason) VALUES($1,$2,$3)',[before.input.revision,options.operator,'Preserved legacy baseline before managed activation'])}
  await store(client,after);
  // The active tables are a materialized projection. Readers use repeatable-read snapshots.
  await client.query('DELETE FROM library_exams');
  for(const p of after.papers){
   await client.query('INSERT INTO library_exams(source_id,revision,source_commit,source_path,metadata) VALUES($1,$2,$3,$4,$5::jsonb)',[p.paper_id,p.revision,p.source_commit,p.source_path,JSON.stringify(p.metadata)]);
   for(const q of p.questions)await client.query('INSERT INTO library_questions(exam_id,source_id,seq,content) VALUES($1,$2,$3,$4::jsonb)',[p.paper_id,q.source_id,q.seq,JSON.stringify(q.content)]);
   for(const f of p.figures)await client.query('INSERT INTO library_figures(exam_id,source_id,sha256,data) VALUES($1,$2,$3,$4)',[p.paper_id,f.id,f.sha256,after.media.get(f.sha256)]);
  }
  const updated=(await client.query('INSERT INTO library_release_state(singleton,active_revision,activated_at) VALUES(true,$1,clock_timestamp()) ON CONFLICT(singleton) DO UPDATE SET active_revision=EXCLUDED.active_revision,activated_at=EXCLUDED.activated_at RETURNING activated_at',[after.revision])).rows[0];
  await client.query('INSERT INTO library_activation_history(revision,previous_revision,operator,reason,activated_at) VALUES($1,$2,$3,$4,$5)',[after.revision,before.input.revision,options.operator,options.reason,updated.activated_at]);
  return {status:'activated',revision:after.revision,previous_revision:before.input.revision,activated_at:updated.activated_at};
 });
}
