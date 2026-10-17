import { createHash } from "node:crypto";
import { z } from "zod";
import { validatePracticePackage, type PracticePackage } from "../practice/package.js";
export const LIBRARY_FORMAT = "ps-library-package/v1";
const id=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text=z.object({en:z.string().min(1).optional(),th:z.string().min(1).optional()}).strict();
const refs=z.object({en:id.optional(),th:id.optional()}).strict().nullable();
const question=z.object({
 content_id:id,seq:z.number().int().positive(),source_number:z.string().min(1),source_label:z.string().nullable().optional(),
 question_type:z.enum(["multiple_choice","numeric_response"]),representation:z.enum(["text","image_only","full_item_image"]),
 stem:text,options:z.array(z.object({label:z.string().min(1).max(16),text,figure:refs}).strict()),answer:z.string().nullable(),
 answer_alternatives:z.array(z.string()),voided:z.boolean(),voided_note:z.string().nullable(),category:z.string().nullable(),figure:refs,
 table:z.object({rows:z.array(z.array(z.string()).min(1)).min(1),header_rows:z.number().int().min(0)}).nullable(),
 explanation:text.nullable(),image_description:z.string().nullable(),notes:z.array(z.string()),
 source_page:z.union([z.number(),z.string()]).nullable(),subskill:z.string().nullable(),difficulty:z.string().nullable(),field:z.string().optional(),
}).strict();
const paper=z.object({
 format:z.literal("ps-library-paper/v2"),family:z.string().min(1),
 exam:z.object({content_id:id,title:z.string().min(1),provider:z.string().min(1),subtitle:z.string().nullable(),session:z.string().nullable(),
 item_count:z.number().int().positive(),languages:z.array(z.enum(["en","th"])).min(1),category_provenance:z.string().min(1),category_note:z.string().nullable(),
 answer_key_provenance:z.enum(["official","pending","unverified-analyst-inference"]),answer_key_note:z.string().nullable(),attribution:z.string().min(1),source_notes:z.array(z.string()),translation_note:z.string().nullable().optional(),categories:z.array(z.object({name:z.string(),field:z.string()})).optional(),time_limit_minutes:z.number().nullable().optional()}).strict(),
 questions:z.array(question).min(1),figures:z.array(z.object({id,mime:z.literal("image/png"),sha256:z.string().regex(/^[a-f0-9]{64}$/),data_base64:z.string().min(1)}).strict()),
}).strict();
export type LibraryQuestion=z.infer<typeof question>;
export type LibraryPaper=z.infer<typeof paper>;
export interface LibraryPackage {format:"ps-library-package/v1"|"ps-library-package/v2";source:{commit:string;path:string};paper:PracticePackage|LibraryPaper}
const header=z.object({format:z.enum([LIBRARY_FORMAT,"ps-library-package/v2"]),source:z.object({commit:z.string().regex(/^[a-f0-9]{40}$/),path:z.string().regex(/^work\/projects\/teaching\/item-bank\/[a-z0-9-]+\/questions\.json$/)}).strict(),paper:z.unknown()}).strict();
export function validateLibraryPackage(raw:unknown):string[]{
 const h=header.safeParse(raw);if(!h.success)return h.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`);
 if(h.data.format===LIBRARY_FORMAT)return validatePracticePackage(h.data.paper);
 const result=paper.safeParse(h.data.paper);if(!result.success)return result.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`);
 const p=result.data,errors:string[]=[];
 const unique=(v:unknown[],n:string)=>{if(new Set(v).size!==v.length)errors.push(`duplicate ${n}`)};
 unique(p.questions.map(q=>q.content_id),"question IDs");unique(p.questions.map(q=>q.seq),"sequence");unique(p.questions.map(q=>q.source_number),"source numbers");unique(p.figures.map(f=>f.id),"figures");
 if(p.exam.item_count!==p.questions.length)errors.push("item_count mismatch");
 const ids=new Set(p.figures.map(f=>f.id));
 for(const f of p.figures){const b=Buffer.from(f.data_base64,"base64");if(b.length>8*1024*1024||!b.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"))||b.toString("base64")!==f.data_base64)errors.push(`invalid PNG ${f.id}`);if(createHash("sha256").update(b).digest("hex")!==f.sha256)errors.push(`sha256 mismatch ${f.id}`)}
 for(const q of p.questions){
  unique(q.options.map(o=>o.label),"option labels");
  for(const o of q.options)if(!Object.keys(o.text).length&&!o.figure&&!(q.figure&&q.representation!=="text"))errors.push(`unreadable option ${q.content_id}/${o.label}`);
  if(!Object.keys(q.stem).length&&!q.figure&&!q.table)errors.push(`unreadable item ${q.content_id}`);
  if(q.question_type==="multiple_choice"&&q.answer!==null&&q.options.length&&!q.options.some(o=>o.label===q.answer))errors.push(`answer label missing ${q.content_id}`);
  if(p.exam.answer_key_provenance==="pending"&&(q.answer!==null||q.answer_alternatives.length))errors.push(`pending key must stay absent ${q.content_id}`);
  if(q.voided&&q.answer!==null)errors.push(`voided item cannot have key ${q.content_id}`);
  if(q.table&&q.table.header_rows>q.table.rows.length)errors.push(`invalid table header ${q.content_id}`);
  for(const r of [q.figure,...q.options.map(o=>o.figure)])for(const fid of Object.values(r??{}))if(fid!==undefined&&!ids.has(fid))errors.push(`missing packaged figure ${fid}`);
 }
 return errors;
}
