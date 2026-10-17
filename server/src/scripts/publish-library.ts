import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadAppConfig} from '../config.js';
import {createDatabasePool} from '../db.js';
import {loadInventory,previewRelease,activateRelease} from '../library/publication.js';

export async function main(args:string[]){
 const {positionals,values}=parseArgs({args,allowPositionals:true,options:{approval:{type:'string'},expect:{type:'string'},revision:{type:'string'},operator:{type:'string'},reason:{type:'string'}}});
 const [command,target]=positionals;
 if(positionals.length>2||!['preview','activate','preview-restore','restore','history'].includes(command??''))throw Error('usage: publish-library preview|activate <inventory.json> | preview-restore|restore <revision> | history; activation requires --expect --revision --approval --operator --reason');
 if(command!=='history'&&!target)throw Error('Inventory file or revision required');
 // File/package/media checks happen before opening a database connection.
 const input=command==='preview'||command==='activate'?await loadInventory(target!):target!;
 const pool=createDatabasePool(loadAppConfig().databaseUrl);
 try{
  if(command==='history')return (await pool.query('SELECT id,revision,previous_revision,operator,reason,activated_at FROM library_activation_history ORDER BY id DESC')).rows;
  if(command==='preview'||command==='preview-restore')return await previewRelease(pool,input);
  if(!values.expect||!values.operator||!values.reason||!values.revision||!values.approval)throw Error('Explicit --expect, --revision, --approval, --operator and --reason required; run preview first');
  return await activateRelease(pool,input,{expectedActive:values.expect,targetRevision:values.revision,approvalDigest:values.approval,operator:values.operator,reason:values.reason});
 }finally{await pool.end()}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))console.info(JSON.stringify(await main(process.argv.slice(2)),null,2));
