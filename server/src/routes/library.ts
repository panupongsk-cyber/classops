import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { withTransaction, type DatabasePool, type DatabaseClient } from "../db.js";
import { requireCurrentUser } from "../current-user.js";
import type { PracticeQuestion } from "../practice/package.js";
import type { LibraryQuestion } from "../library/package.js";

import {searchQuery, searchLibrary, searchNeighbors} from "../library/search.js";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const itemParams = z.object({ exam: id, item: id });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });
const PAGE_SIZE = 20;
// Key provenance notes can themselves spell out the correct values. Keep them behind reveal.
function publicExam(row: {metadata: Record<string,unknown>; [key:string]:unknown}) {
  const {answer_key_note: _keyNote,...metadata}=row.metadata;
  return {...row,metadata};
}

export async function registerLibraryRoutes(app: FastifyInstance, { pool, config }: { pool: DatabasePool; config: AppConfig }) {
  // Each response sees one active projection even if an operator activates concurrently.
  const snapshot=(handler:(db:DatabaseClient,request:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(request:FastifyRequest,reply:FastifyReply)=>withTransaction(pool,async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const publication=(await db.query('SELECT active_revision AS revision,activated_at FROM library_release_state WHERE singleton')).rows[0]??null;
    const result=await handler(db,request,reply);
    return result&&typeof result==='object'&&!Buffer.isBuffer(result)&&!reply.sent?{...result,publication}:result;
  });
  // Encapsulation keeps authorization and no-store on every library endpoint, including errors.
  await app.register(async (library) => {
    library.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const user = await requireCurrentUser(request, reply, pool, config);
      if (!user) return;
      if (!config.libraryUserIds?.includes(user.id)) return reply.code(403).send({ error: "LIBRARY_FORBIDDEN" });
    });
    library.get("/api/library", snapshot(async (db) => ({ exams: (await db.query(
      "SELECT source_id AS id, revision, source_commit, source_path, metadata, imported_at FROM library_exams ORDER BY source_id",
    )).rows.map(publicExam) })));
    library.get("/api/library/search",snapshot(async(db,request,reply)=>{
      const query=searchQuery.safeParse(request.query);
      if(!query.success)return reply.code(400).send({error:"INVALID_REQUEST"});
      try{return await searchLibrary(db,query.data)}catch(error){if(error instanceof Error&&error.message==='Invalid category')return reply.code(400).send({error:"INVALID_REQUEST"});throw error}
    }));
    library.get("/api/library/:exam/questions", snapshot(async (db,request,reply) => {
      const params = z.object({ exam: id }).safeParse(request.params);
      const query = pageQuery.safeParse(request.query);
      if (!params.success || !query.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
      const exam = (await db.query("SELECT source_id AS id, metadata, revision, source_commit, source_path FROM library_exams WHERE source_id=$1", [params.data.exam])).rows[0];
      if (!exam) return reply.code(404).send({ error: "NOT_FOUND" });
      const total = Number((await db.query("SELECT count(*) FROM library_questions WHERE exam_id=$1", [params.data.exam])).rows[0].count);
      const rows = (await db.query<{ source_id: string; seq: number; stem: unknown }>(
        "SELECT source_id,seq,content->'stem' AS stem, content->>'source_number' AS source_number, content->>'representation' AS representation, content->>'source_label' AS source_label FROM library_questions WHERE exam_id=$1 ORDER BY seq LIMIT $2 OFFSET $3",
        [params.data.exam, PAGE_SIZE, (query.data.page - 1) * PAGE_SIZE],
      )).rows;
      return { exam: publicExam(exam), total, page: query.data.page, pageSize: PAGE_SIZE, questions: rows };
    }));
    library.get("/api/library/:exam/questions/:item", snapshot(async (db,request,reply) => {
      const parsed = itemParams.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
      const { exam, item } = parsed.data;
      const rawQuery=request.query as Record<string,unknown>;
      const context=rawQuery.scope==='search'?searchQuery.safeParse(rawQuery):null;
      if(context&&!context.success)return reply.code(400).send({error:"INVALID_REQUEST"});

      const row = (await db.query<{ content: PracticeQuestion | LibraryQuestion }>("SELECT content FROM library_questions WHERE exam_id=$1 AND source_id=$2", [exam, item])).rows[0];
      if (!row) {
        const archived=(await db.query("SELECT r.revision FROM library_paper_revisions r JOIN library_release_papers p ON p.paper_revision=r.revision JOIN library_activation_history h ON h.revision=p.release_revision WHERE r.paper_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.questions) q WHERE q->>'source_id'=$2) ORDER BY h.id DESC LIMIT 1",[exam,item])).rows[0];
        return archived?reply.code(410).send({error:"LIBRARY_ITEM_UNAVAILABLE",last_available_revision:archived.revision}):reply.code(404).send({error:"NOT_FOUND"});
      }
      const { answer: _answer, explanation: _explanation, ...question } = row.content;
      // Alternative acceptable answers are keys too.
      if ("answer_alternatives" in question) delete (question as Partial<LibraryQuestion>).answer_alternatives;
      const metadata = (await db.query("SELECT source_id AS id, metadata, revision, source_commit, source_path FROM library_exams WHERE source_id=$1", [exam])).rows[0];
      const previous = (await db.query("SELECT source_id FROM library_questions WHERE exam_id=$1 AND seq<$2 ORDER BY seq DESC LIMIT 1", [exam, question.seq])).rows[0]?.source_id ?? null;
      const next = (await db.query("SELECT source_id FROM library_questions WHERE exam_id=$1 AND seq>$2 ORDER BY seq LIMIT 1", [exam, question.seq])).rows[0]?.source_id ?? null;
      const figures = (refs: Record<string, string | undefined> | null | undefined) => refs ? Object.fromEntries(Object.entries(refs).filter(([, fid]) => typeof fid === "string").map(([lang, fid]) => [lang, `/api/library/${exam}/figures/${fid}?revision=${metadata.revision}`])) : null;
      let resultContext=null;
      if(context?.success){try{resultContext=await searchNeighbors(db,context.data,exam,item)}catch(error){if(error instanceof Error&&error.message==='Invalid category')return reply.code(400).send({error:"INVALID_REQUEST"});throw error}}
      return { exam: publicExam(metadata), previous, next, resultContext, question: { ...question, figure: figures(question.figure), options: question.options.map((o) => ({ ...o, figure: figures(o.figure) })) } };
    }));
    library.get("/api/library/:exam/questions/:item/answer", snapshot(async (db,request,reply) => {
      const parsed = itemParams.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
      const expected=z.object({revision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().safeParse(request.query);
      if(!expected.success)return reply.code(400).send({error:"INVALID_REQUEST"});
      const { exam, item } = parsed.data;
      const row = (await db.query("SELECT q.content->>'answer' AS answer,q.content->'explanation' AS explanation,q.content->'answer_alternatives' AS answer_alternatives,q.content->'voided' AS voided,q.content->>'voided_note' AS voided_note,e.metadata->>'answer_key_note' AS answer_key_note,e.revision AS revision FROM library_questions q JOIN library_exams e ON e.source_id=q.exam_id WHERE q.exam_id=$1 AND q.source_id=$2", [exam, item])).rows[0];
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      if(expected.data.revision&&expected.data.revision!==row.revision)return reply.code(409).send({error:"LIBRARY_REVISION_CHANGED"});
      return row;
    }));
    library.get("/api/library/:exam/figures/:item", snapshot(async (db,request,reply) => {
      const parsed = itemParams.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
      const expected=z.object({revision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().safeParse(request.query);
      if(!expected.success)return reply.code(400).send({error:"INVALID_REQUEST"});
      if(expected.data.revision){const head=(await db.query('SELECT revision FROM library_exams WHERE source_id=$1',[parsed.data.exam])).rows[0];if(head&&head.revision!==expected.data.revision)return reply.code(409).send({error:"LIBRARY_REVISION_CHANGED"})}
      const row = (await db.query<{ data: Buffer }>("SELECT data FROM library_figures WHERE exam_id=$1 AND source_id=$2", [parsed.data.exam, parsed.data.item])).rows[0];
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.type("image/png").send(row.data);
    }));
  });
}
