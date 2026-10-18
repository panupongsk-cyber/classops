import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {packageHash} from '../src/activities/engine.js';
import {createDatabasePool} from '../src/db.js';
import {buildApp} from '../src/app.js';
import type {AppConfig} from '../src/config.js';
import {generateOpaqueToken,hashToken} from '../src/security.js';
import {importLibraryPackage} from '../src/scripts/import-library.js';
import {manifest,preparePackages,loadInventory,previewRelease,activateRelease} from '../src/library/publication.js';
import {syntheticLibraryPackage} from './fixtures/synthetic-library.js';
const databaseUrl=process.env.TEST_DATABASE_URL;
const clean='TRUNCATE library_release_state,library_activation_history,library_release_papers,library_releases,library_paper_revisions,library_media_blobs,library_exams CASCADE';

test('publication inventory validates file bytes, versions, counts, stable IDs and media declarations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'classops-release-'));
 try{
  const pkg=syntheticLibraryPackage(),bytes=JSON.stringify(pkg),p=pkg.paper;
  await writeFile(join(dir,'paper.json'),bytes);
  const entry={slug:'synthetic',paper_id:p.exam.content_id,file:'paper.json',source_ids:p.questions.map(q=>q.source_number),content_ids:p.questions.map(q=>q.content_id),count:p.questions.length,figures:p.figures.length,sha256:createHash('sha256').update(bytes).digest('hex'),package_format:pkg.format,media:p.figures.map(f=>({id:f.id,sha256:f.sha256}))};
  const inventory={format:'ps-library-inventory/v1',source_commit:pkg.source.commit,total_sets:1,total_items:p.questions.length,sets:[entry]};
  const path=join(dir,'inventory.json');await writeFile(path,JSON.stringify(inventory));
  assert.equal((await loadInventory(path)).revision,preparePackages([pkg]).revision);
  for(const broken of [{...inventory,total_items:999},{...inventory,sets:[{...entry,source_ids:['bad']}]},{...inventory,sets:[{...entry,media:[]}]},{...inventory,sets:[{...entry,file:'../escape.json'}]}]){
   await writeFile(path,JSON.stringify(broken));await assert.rejects(loadInventory(path));
  }
  await writeFile(path,JSON.stringify(inventory));await writeFile(join(dir,'paper.json'),bytes+' ');await assert.rejects(loadInventory(path),/checksum/);
  const bad=syntheticLibraryPackage();bad.paper.figures[0]!.sha256='f'.repeat(64);assert.throws(()=>preparePackages([bad]),/sha256/);
  assert.throws(()=>preparePackages([pkg,pkg]),/Duplicate paper/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('audited releases preserve legacy baseline, activate/no-op/fail atomically, restore removed links and serialize operators',{skip:!databaseUrl},async()=>{
 if(!databaseUrl)return;const pool=createDatabasePool(databaseUrl);await pool.query(clean);
 const pkg=syntheticLibraryPackage();await importLibraryPackage(pool,pkg);
 const user=(await pool.query("INSERT INTO users(email,display_name,status) VALUES('release-owner@example.com','Synthetic release operator','active') ON CONFLICT(email) DO UPDATE SET status='active' RETURNING id")).rows[0];
 const token=generateOpaqueToken();await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[user.id,hashToken(token)]);
 const config:AppConfig={nodeEnv:'test',host:'127.0.0.1',port:3000,databaseUrl,appBaseUrl:'http://localhost:5173',trustedOrigins:['http://localhost:5173'],trustProxy:false,sessionCookieName:'classops_session',sessionTtlDays:14,sealedPayloadEncryptionKey:Buffer.alloc(32,7).toString('base64'),adminGoogleEmail:'admin@example.com',googleOAuth:null,microsoftOAuth:null,libraryUserIds:[user.id]};
 const app=await buildApp({pool,config});const get=(url:string)=>app.inject({method:'GET',url,headers:{cookie:`classops_session=${token}`}});
 const approvals=new Map<string,string>();
 const options=(expectedActive:string,targetRevision:string)=>({expectedActive,targetRevision,approvalDigest:approvals.get(targetRevision)??'',operator:'synthetic-test',reason:'Synthetic lifecycle test'});
 try{
  const a=preparePackages([pkg]),firstPreview=await previewRelease(pool,a);approvals.set(a.revision,packageHash(manifest(a)));
  assert.match(firstPreview.expected_active,/^legacy:/);assert.equal((await pool.query('SELECT count(*) FROM library_releases')).rows[0].count,'0','preview is read-only');
  const first=await activateRelease(pool,a,options(firstPreview.expected_active,a.revision));assert.equal(first.status,'activated');
  const history=await pool.query('SELECT * FROM library_activation_history ORDER BY id');assert.equal(history.rows.length,2);
  const initial=(await get('/api/library/GEN/questions/GEN_Q001')).json();assert.equal(initial.publication.revision,a.revision);assert.ok(initial.publication.activated_at);
  const qurl='/api/library/GEN/questions/GEN_Q001';const oldPaperRevision=initial.exam.revision;
  const changed=syntheticLibraryPackage();changed.paper.questions[0]!.stem={th:'Synthetic corrected question'};changed.paper.questions[0]!.answer='99';changed.paper.questions=changed.paper.questions.filter(q=>q.content_id!=='GEN_Q004');changed.paper.exam.item_count=3;
  changed.paper.exam.title='Synthetic revised paper metadata';
  const b=preparePackages([changed]),preview=await previewRelease(pool,b);approvals.set(b.revision,packageHash(manifest(b)));
  assert.deepEqual(preview.papers[0]!.metadata_changed,['item_count','title']);
  const mediaOnly=syntheticLibraryPackage();const imageBytes=Buffer.concat([Buffer.from(mediaOnly.paper.figures[0]!.data_base64,'base64'),Buffer.from([0])]);mediaOnly.paper.figures[0]!.data_base64=imageBytes.toString('base64');mediaOnly.paper.figures[0]!.sha256=createHash('sha256').update(imageBytes).digest('hex');const imagePreview=await previewRelease(pool,preparePackages([mediaOnly]));assert.deepEqual(imagePreview.papers[0]!.media_changed,[mediaOnly.paper.figures[0]!.id]);
  assert.deepEqual(preview.papers[0]!.removed,['GEN_Q004']);assert.deepEqual(preview.papers[0]!.changed,['GEN_Q001']);
  const renumbered=syntheticLibraryPackage();renumbered.paper.questions[0]!.source_number='99';const renamed=preparePackages([renumbered]);approvals.set(renamed.revision,packageHash(manifest(renamed)));await assert.rejects(activateRelease(pool,renamed,options(a.revision,renamed.revision)),/Stable item ID/);
  const before=(await pool.query('SELECT activated_at FROM library_release_state')).rows[0].activated_at;
  assert.equal((await activateRelease(pool,a,options(a.revision,a.revision))).status,'unchanged');assert.deepEqual((await pool.query('SELECT activated_at FROM library_release_state')).rows[0].activated_at,before);
  const altered=preparePackages([changed]);altered.papers[0]!.source_commit='c'.repeat(40);await assert.rejects(activateRelease(pool,altered,options(a.revision,b.revision)),/Target changed/);
  await assert.rejects(activateRelease(pool,b,options('wrong',b.revision)),/preview again/);
  await assert.rejects(activateRelease(pool,b,options(a.revision,'f'.repeat(64))),/Target changed/);
  // A SQL failure after archive writes must roll back archive, active projection and audit.
  await pool.query("CREATE FUNCTION synthetic_fail_library() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic projection failure'; END; $$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON library_exams FOR EACH ROW EXECUTE FUNCTION synthetic_fail_library()");
  try{await assert.rejects(activateRelease(pool,b,options(a.revision,b.revision)),/synthetic projection failure/)}finally{await pool.query('DROP TRIGGER synthetic_fail ON library_exams; DROP FUNCTION synthetic_fail_library()')}
  assert.equal((await pool.query('SELECT count(*) FROM library_releases WHERE revision=$1',[b.revision])).rows[0].count,'0');assert.equal((await get(qurl)).json().publication.revision,a.revision);
  const reader=await pool.connect();await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await reader.query('SELECT * FROM library_release_state');
  await activateRelease(pool,b,options(a.revision,b.revision));
  assert.equal((await reader.query("SELECT content->'stem'->>'th' AS stem FROM library_questions WHERE source_id='GEN_Q001'")).rows[0].stem,pkg.paper.questions[0]!.stem.th,'in-flight reader retains one snapshot');await reader.query('COMMIT');reader.release();
  const edited=(await get(qurl)).json();assert.equal(edited.question.stem.th,'Synthetic corrected question');assert.equal(edited.publication.revision,b.revision);
  assert.equal((await get(qurl+'/answer?revision='+oldPaperRevision)).statusCode,409,'old stems cannot reveal new keys');
  assert.equal((await get('/api/library/GEN/figures/'+pkg.paper.figures[0]!.id+'?revision='+oldPaperRevision)).statusCode,409);
  assert.equal((await get(qurl+'/answer?revision='+edited.exam.revision)).json().answer,'99');
  const gone=await get('/api/library/GEN/questions/GEN_Q004');assert.equal(gone.statusCode,410);assert.equal(gone.json().error,'LIBRARY_ITEM_UNAVAILABLE');assert.ok(gone.json().last_available_revision);
  await assert.rejects(importLibraryPackage(pool,pkg),/Managed releases active/);
  await assert.rejects(pool.query("UPDATE library_releases SET manifest='{}' WHERE revision=$1",[a.revision]),/immutable/);
  const restore=await previewRelease(pool,a.revision);await activateRelease(pool,a.revision,options(restore.expected_active,a.revision));
  assert.equal((await get('/api/library/GEN/questions/GEN_Q004')).statusCode,200);assert.equal((await get(qurl)).json().question.stem.th,pkg.paper.questions[0]!.stem.th);
  const other=syntheticLibraryPackage();other.paper.questions[0]!.stem={th:'Another synthetic correction'};const c=preparePackages([other]);approvals.set(c.revision,packageHash(manifest(c)));
  const race=await Promise.allSettled([activateRelease(pool,b,options(a.revision,b.revision)),activateRelease(pool,c,options(a.revision,c.revision))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);

  // Bootstrap baseline and first correction share transaction timestamps. Latest availability
  // follows activation order, including when the same archived version is restored later.
  await pool.query(clean);await importLibraryPackage(pool,pkg);
  const bootstrap=await previewRelease(pool,b);await activateRelease(pool,b,{...options(bootstrap.expected_active,b.revision),approvalDigest:bootstrap.approval_digest});
  const removed=structuredClone(changed);removed.paper.questions=removed.paper.questions.filter(q=>q.content_id!=='GEN_Q001');removed.paper.exam.item_count=2;const removal=preparePackages([removed]);const removalPreview=await previewRelease(pool,removal);
  await activateRelease(pool,removal,{...options(b.revision,removal.revision),approvalDigest:removalPreview.approval_digest});
  assert.equal((await get(qurl)).json().last_available_revision,b.papers[0]!.revision,'last availability follows activation, not tied archive timestamps');
  assert.equal((await app.inject({method:'GET',url:'/api/library'})).statusCode,401);
 }finally{await pool.query(clean);await app.close()}
});
