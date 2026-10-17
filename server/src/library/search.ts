import { z } from 'zod';
import type { DatabasePool } from '../db.js';
const optionalText=z.string().max(200).default('');
export const searchQuery=z.object({
 q:optionalText,family:optionalText,exam:z.string().regex(/^[A-Za-z0-9_-]{0,80}$/).default(''),
 year:z.string().regex(/^(?:20\d{2}|unknown)?$/).default(''),category:z.string().max(400).default(''),
 language:z.enum(['','en','th']).default(''),answer:z.enum(['','available','missing','voided']).default(''),
 page:z.coerce.number().int().min(1).max(100000).default(1),
 // Reader state is carried in the same shareable URL, independent of search language.
 lang:z.enum(['en','th']).optional(),scope:z.literal('search').optional(),
}).strict();
export type SearchQuery=z.infer<typeof searchQuery>;
export const SEARCH_PAGE_SIZE=20;
// NFKC, whitespace collapse, case-folded literal substring within an individual stem/choice.
// No regex, wildcard, OCR, answer/explanation matching or tokenization.
const normalized=(value:string)=>`lower(regexp_replace(normalize(coalesce(${value},''),NFKC),'[[:space:]]+',' ','g')) COLLATE "C"`;
const family=`coalesce(e.metadata->>'family','')`;
// Only established calendar-coded IDs; never interpret TCAS intake years as sitting dates.
const year=`coalesce(substring(e.source_id from '^((?:20)[0-9]{2})[SA]_'),substring(e.source_id from '(?:physics-camp1-|alevel-physics-|tpat3-)((?:20)[0-9]{2})[0-9]{2}$'),'unknown')`;
const category=`jsonb_build_array(${family},nullif(q.content->>'category',''))::text`;
const answer=`CASE WHEN coalesce((q.content->>'voided')::boolean,false) THEN 'voided' WHEN nullif(q.content->>'answer','') IS NULL THEN 'missing' ELSE 'available' END`;
const available=(lang:string)=>`(q.content->'stem' ? '${lang}' OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.content->'options') o WHERE o->'text' ? '${lang}') OR (q.content->'stem'='{}'::jsonb AND e.metadata->'languages' ? '${lang}'))`;
export const searchBase=`SELECT q.exam_id,q.source_id,q.seq,q.content->'stem' AS stem,q.content->>'source_number' AS source_number,q.content->>'source_label' AS source_label,e.metadata->>'title' AS title,${family} AS family,${year} AS year,${category} AS category_key,q.content->>'category' AS category,${answer} AS answer_status,${available('en')} AS has_en,${available('th')} AS has_th FROM library_questions q JOIN library_exams e ON e.source_id=q.exam_id`;
export function searchSql(query:SearchQuery){
 const values:unknown[]=[],where:string[]=[];
 const bind=(v:unknown)=>{values.push(v);return '$'+values.length};
 if(query.q.trim()){
  const needle=bind(query.q.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase());
  where.push(`(strpos(${normalized("q.content->'stem'->>'en'")},${needle})>0 OR strpos(${normalized("q.content->'stem'->>'th'")},${needle})>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.content->'options') o WHERE strpos(${normalized("o->'text'->>'en'")},${needle})>0 OR strpos(${normalized("o->'text'->>'th'")},${needle})>0))`);
 }
 if(query.family)where.push(`${family}=${bind(query.family)}`);
 if(query.exam)where.push(`q.exam_id=${bind(query.exam)}`);
 if(query.year)where.push(`${year}=${bind(query.year)}`);
 if(query.category){let key:unknown;try{key=JSON.parse(query.category)}catch{throw new Error('Invalid category')};if(!Array.isArray(key)||key.length!==2||typeof key[0]!=='string'||!(key[1]===null||typeof key[1]==='string'))throw new Error('Invalid category');where.push(`jsonb_build_array(${family},nullif(q.content->>'category',''))=${bind(JSON.stringify(key))}::jsonb`)}
 if(query.language)where.push(available(query.language));
 if(query.answer)where.push(`${answer}=${bind(query.answer)}`);
 return {sql:searchBase+(where.length?' WHERE '+where.join(' AND '):''),values};
}
export async function searchLibrary(pool:DatabasePool,query:SearchQuery){
 const {sql,values}=searchSql(query);
 const total=Number((await pool.query(`SELECT count(*) FROM (${sql}) matches`,values)).rows[0].count);
 const questions=(await pool.query(`${sql} ORDER BY q.exam_id COLLATE "C",q.seq,q.source_id COLLATE "C" LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,SEARCH_PAGE_SIZE,(query.page-1)*SEARCH_PAGE_SIZE])).rows;
 // Facets describe the complete published snapshot, so empty combinations remain editable.
 const facets=(await pool.query(`SELECT DISTINCT exam_id,title,family,year,category_key,category,has_en,has_th,answer_status FROM (${searchBase}) all_items ORDER BY exam_id`)).rows;
 return {questions,total,page:query.page,pageSize:SEARCH_PAGE_SIZE,facets};
}
export async function searchNeighbors(pool:DatabasePool,query:SearchQuery,exam:string,item:string){
 const {sql,values}=searchSql(query);
 const rows=(await pool.query(`SELECT exam_id,source_id FROM (${sql}) matches ORDER BY exam_id COLLATE "C",seq,source_id COLLATE "C"`,values)).rows;
 const index=rows.findIndex(r=>r.exam_id===exam&&r.source_id===item);
 const neighbor=(n:number)=>n>=0&&n<rows.length?{exam:rows[n].exam_id,item:rows[n].source_id}:null;
 return {previous:index<0?null:neighbor(index-1),next:index<0?null:neighbor(index+1),position:index<0?null:index+1,total:rows.length};
}
