import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool } from "../src/db.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";
import { importLibraryPackage } from "../src/scripts/import-library.js";
import { validateLibraryPackage, type LibraryPackage } from "../src/library/package.js";
import { syntheticPracticePackage, TINY_PNG } from "./fixtures/synthetic-practice.js";
import { syntheticLibraryPackage } from "./fixtures/synthetic-library.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
function fixture(): LibraryPackage {
  const paper = syntheticPracticePackage();
  paper.questions[0]!.explanation = { en: "Synthetic explanation", th: "คำอธิบายสังเคราะห์" };
  paper.questions[0]!.options[0]!.figure = { en: paper.figures[0]!.id };
  return { format: "ps-library-package/v1", source: { commit: "a".repeat(40), path: "work/projects/teaching/item-bank/synthetic/questions.json" }, paper };
}
test("library package requires traceable source and complete validated media", () => {
  assert.deepEqual(validateLibraryPackage(fixture()), []);
  const broken = fixture(); broken.source.commit = "HEAD";
  assert.ok(validateLibraryPackage(broken).length);
  const media = fixture(); media.paper.figures[0]!.sha256 = "f".repeat(64);
  assert.match(validateLibraryPackage(media).join("\n"), /sha256/);
  const dangling = fixture(); dangling.paper.figures = [];
  assert.match(validateLibraryPackage(dangling).join("\n"), /packaged figure/);
});

test("generic library validates image-only, numeric, table, Unicode labels and absent keys", () => {
  assert.deepEqual(validateLibraryPackage(syntheticLibraryPackage()), []);
  const bad=syntheticLibraryPackage();bad.paper.exam.answer_key_provenance="pending";
  assert.match(validateLibraryPackage(bad).join(";"),/pending key/);
  const duplicate=syntheticLibraryPackage();duplicate.paper.questions[1]!.source_number="19";
  assert.match(validateLibraryPackage(duplicate).join(";"),/duplicate source/);
  const missing=syntheticLibraryPackage();missing.paper.figures=[];
  assert.match(validateLibraryPackage(missing).join(";"),/missing packaged figure/);
});

test("private global library: isolated import, no implicit admin access, hidden keys, paging and media", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query("TRUNCATE users, library_exams, exam_sessions CASCADE");
  const makeUser = async (email: string, admin: boolean) => {
    const id = (await pool.query("INSERT INTO users (email,display_name,status,is_platform_admin) VALUES ($1,$2,'active',$3) RETURNING id", [email, email, admin])).rows[0].id as string;
    const token = generateOpaqueToken();
    await pool.query("INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 day')", [id, hashToken(token)]);
    return { id, cookie: `classops_session=${token}` };
  };
  const owner = await makeUser("owner@example.com", false);
  const admin = await makeUser("other-admin@example.com", true);
  const config: AppConfig = { nodeEnv: "test", host: "127.0.0.1", port: 3000, databaseUrl,
    appBaseUrl: "http://localhost:5173", trustedOrigins: ["http://localhost:5173"], trustProxy: false,
    sessionCookieName: "classops_session", sessionTtlDays: 14, sealedPayloadEncryptionKey: Buffer.alloc(32,7).toString("base64"),
    adminGoogleEmail: "admin@example.com", googleOAuth: null, microsoftOAuth: null, libraryUserIds: [owner.id] };
  const app = await buildApp({ pool, config });
  const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  try {
    assert.deepEqual((await get("/api/library", owner.cookie)).json().exams, []);
    const first = await importLibraryPackage(pool, fixture());
    assert.equal(first.status, "imported");
    assert.equal((await importLibraryPackage(pool, fixture())).status, "unchanged");
    const sameContentLaterSnapshot=fixture();sameContentLaterSnapshot.source.commit="c".repeat(40);
    assert.equal((await importLibraryPackage(pool,sameContentLaterSnapshot)).status,"unchanged","identical content at a later snapshot keeps first publication");
    const changed = fixture(); changed.paper.questions[0]!.answer = "a";
    await assert.rejects(importLibraryPackage(pool, changed), /Changed library content refused/);
    assert.equal((await pool.query("SELECT count(*) FROM exam_sessions")).rows[0].count, "0", "does not import or modify Practice");
    assert.equal((await pool.query("SELECT count(*) FROM library_questions")).rows[0].count, "4");
    const base = "/api/library/2099S_XX";
    const item = `${base}/questions/2099S_XX_Q001`;
    const fig = `${base}/figures/2099S_XX_Q002_en`;
    for (const url of ["/api/library", `${base}/questions`, item, `${item}/answer`, fig]) {
      assert.equal((await get(url)).statusCode, 401, url);
      const denied = await get(url, admin.cookie);
      assert.equal(denied.statusCode, 403, "a different platform admin is refused: " + url);
      assert.equal(denied.headers["cache-control"], "private, no-store");
    }
    assert.equal((await get("/api/auth/me",owner.cookie)).json().user.canBrowseLibrary, true);
    assert.equal((await get("/api/auth/me",admin.cookie)).json().user.canBrowseLibrary, false);
    const list = (await get(`${base}/questions`, owner.cookie)).json();
    assert.deepEqual([list.total,list.page,list.pageSize,list.questions.length], [4,1,20,4]);
    assert.ok(!JSON.stringify(list).includes('"answer"'));
    assert.equal((await get(`${base}/questions?page=0`,owner.cookie)).statusCode,400);
    assert.deepEqual((await get(`${base}/questions?page=2`,owner.cookie)).json().questions,[]);
    const detail = (await get(item,owner.cookie)).json();
    assert.ok(!('answer' in detail.question) && !('explanation' in detail.question));
    assert.deepEqual([detail.previous,detail.next], [null,"2099S_XX_Q002"]);
    assert.equal(detail.question.options[0].figure.en,fig);
    const key = (await get(`${item}/answer`,owner.cookie)).json();
    assert.equal(key.answer,"b"); assert.equal(key.explanation.en,"Synthetic explanation");
    assert.ok((await get(fig,owner.cookie)).rawPayload.equals(TINY_PNG));
    assert.equal((await get(`${base}/questions/missing`,owner.cookie)).statusCode,404);
    assert.equal((await get(`${base}/figures/missing`,owner.cookie)).statusCode,404);
    // Enrich a v1 paper with v2 source metadata while preserving all original content and rows.
    const legacy=fixture().paper as ReturnType<typeof syntheticPracticePackage>;
    const enriched=syntheticLibraryPackage();
    enriched.paper.family=legacy.family;
    enriched.paper.exam={...enriched.paper.exam,...legacy.exam,subtitle:legacy.exam.subtitle??null,session:legacy.exam.session??null,answer_key_provenance:"official",category_note:"Source taxonomy note",source_notes:["Source caveat"]};
    enriched.paper.questions=legacy.questions.map(q=>({...enriched.paper.questions[0]!,...q,
      source_number:String(q.seq),question_type:"multiple_choice",answer_alternatives:[],voided:false,
      explanation:q.explanation??null,options:q.options.map(o=>({figure:null,...o}))}));
    enriched.paper.figures=legacy.figures;
    const changedCore=structuredClone(enriched);changedCore.paper.questions[0]!.answer="a";
    await assert.rejects(importLibraryPackage(pool,changedCore),/Changed library content refused/);
    assert.equal((await importLibraryPackage(pool,enriched)).status,"upgraded");
    assert.equal((await importLibraryPackage(pool,enriched)).status,"unchanged");
    assert.deepEqual((await pool.query("SELECT source_id FROM library_questions WHERE exam_id='2099S_XX' ORDER BY seq")).rows.map(r=>r.source_id),legacy.questions.map(q=>q.content_id));
    assert.equal((await get(item,owner.cookie)).json().question.notes[0],"Provisional OCR synthetic fixture");
    await importLibraryPackage(pool,syntheticLibraryPackage());
    const generic="/api/library/GEN/questions/GEN_Q001";
    const numeric=(await get(generic,owner.cookie)).json();
    assert.equal(numeric.question.source_number,"19");
    assert.ok(!("answer" in numeric.question)&&!("answer_alternatives" in numeric.question)&&!("explanation" in numeric.question));
    assert.deepEqual((await get(generic+"/answer",owner.cookie)).json().answer_alternatives,["43"]);
    const image=(await get("/api/library/GEN/questions/GEN_Q002",owner.cookie)).json().question;
    assert.equal(image.options.length,8);assert.equal(image.representation,"full_item_image");
    assert.match(image.figure.en,/^\/api\/library\/GEN\/figures\//);
    const table=(await get("/api/library/GEN/questions/GEN_Q003",owner.cookie)).json().question;
    assert.deepEqual(table.table.rows,[["x","y"],["α","β"]]);assert.equal(table.options[0].label,"ก");
    const voided=(await get("/api/library/GEN/questions/GEN_Q004/answer",owner.cookie)).json();
    assert.equal(voided.voided,true);assert.equal(voided.answer,null);
    // Missing configuration must fail closed, never fall back to admin/email/Section roles.
    config.libraryUserIds = [];
    assert.equal((await get(item,owner.cookie)).statusCode,403);
  } finally { await app.close(); }
});
