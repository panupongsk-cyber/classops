import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { upsertOAuthUser } from "../src/oauth-flow.js";
import { importActivityPackage } from "../src/scripts/import-activity.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";
import { syntheticPackage } from "./fixtures/synthetic-activity.js";
import { registrarCsv, STUDENTS, tis620 } from "./fixtures/synthetic-roster.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function createUserWithSession(pool: DatabasePool, email: string, displayName: string, isPlatformAdmin = false) {
  const userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, status, email_verified_at, is_platform_admin) VALUES ($1, $2, 'active', now(), $3) RETURNING id`,
      [email, displayName, isPlatformAdmin],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', $2)`, [userId, `sub-${userId}`]);
  const token = generateOpaqueToken();
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [userId, hashToken(token)]);
  return { userId, cookie: `classops_session=${token}` };
}

function testConfig(url: string): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 3000,
    databaseUrl: url,
    appBaseUrl: "http://localhost:5173",
    trustedOrigins: ["http://localhost:5173"],
    trustProxy: false,
    sessionCookieName: "classops_session",
    sessionTtlDays: 14,
    sealedPayloadEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
    adminGoogleEmail: "admin@example.com",
    googleOAuth: null,
    microsoftOAuth: null,
  };
}

const TRUNCATE = `TRUNCATE section_roster_entries, activity_responses, activity_attempts, section_activities,
  activity_packages, audit_log, likes, comments, posts, scores, assignments, categories, session_picks,
  exit_ticket_responses, exit_tickets, session_checkins, class_sessions, session_schedule_patterns,
  memberships, sections, courses, oauth_transactions, sessions, auth_identities, users RESTART IDENTITY CASCADE`;

type Row = { studentId: string; status: string; studentIdConflict: string | null; reason: string | null };

// Synthetic people only (test/fixtures/synthetic-roster.ts); a real roster never enters the repo.
test("Roster import: TIS-620 registrar file, preview statuses, apply, pending claims at sign-in and by student ID", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query(TRUNCATE);
  const app = await buildApp({ config: testConfig(databaseUrl), pool });
  const origin = { origin: "http://localhost:5173" };
  try {
    const admin = await createUserWithSession(pool, "admin@example.com", "Admin", true);
    const teacher = await createUserWithSession(pool, "teacher@example.com", "Teacher");
    const ta = await createUserWithSession(pool, "ta@example.com", "TA");
    const somchai = await createUserWithSession(pool, "somchai.j@example.edu", "Somchai G"); // has an account, not a member
    const somying = await createUserWithSession(pool, "somying.r@example.edu", "Somying G"); // member, own student ID differs
    const extra = await createUserWithSession(pool, "extra@example.edu", "Extra"); // member missing from the file
    const post = (who: { cookie: string }, url: string, payload: unknown) =>
      app.inject({ method: "POST", url, headers: { cookie: who.cookie, ...origin }, payload: payload as object });
    const get = (who: { cookie: string }, url: string) => app.inject({ method: "GET", url, headers: { cookie: who.cookie } });

    const sectionId = (await post(admin, "/api/courses", { code: "305331", title: "Security", type: "semester", term: "2569/1", ownerUserId: teacher.userId })).json().sectionId as string;
    const joinCode = (await pool.query<{ join_code: string }>("SELECT join_code FROM sections WHERE id = $1", [sectionId])).rows[0]!.join_code;
    assert.equal((await post(teacher, `/api/sections/${sectionId}/memberships`, { email: "ta@example.com", roles: ["ta"] })).statusCode, 201);
    assert.equal((await post(somying, "/api/sections/join", { code: joinCode, studentId: "11111111" })).statusCode, 200);
    assert.equal((await post(extra, "/api/sections/join", { code: joinCode })).statusCode, 200);

    // Registrar file in TIS-620: the four synthetic students (sections 1 and 2), a bad ID, a duplicate.
    const csv = registrarCsv(STUDENTS) + "BAD ID,นาย,ผิด,รูปแบบ,Mr.,X,Y,999001,Synthetic Course,1,x@example.edu\r\n" + registrarCsv([STUDENTS[0]!]).split("\r\n")[1] + "\r\n";
    const file = tis620(csv).toString("base64");
    const previewUrl = `/api/sections/${sectionId}/roster-import/preview`;
    const importUrl = `/api/sections/${sectionId}/roster-import`;

    assert.equal((await post(ta, previewUrl, { fileBase64: file })).statusCode, 403, "ta may not import");
    assert.equal((await post(extra, previewUrl, { fileBase64: file })).statusCode, 403, "a student may not import");
    assert.deepEqual((await post(teacher, previewUrl, { fileBase64: file, encoding: "utf-8" })).json(), { error: "NOT_UTF8" });

    const unchosen = (await post(teacher, previewUrl, { fileBase64: file })).json();
    assert.deepEqual([unchosen.encoding, unchosen.format, unchosen.fileSections, unchosen.needsSectionChoice, unchosen.courseCodeMismatch], ["tis-620", "registrar", ["1", "2"], true, true]);
    assert.deepEqual((await post(teacher, importUrl, { fileBase64: file })).json(), { error: "SECTION_CHOICE_REQUIRED" });

    const preview = (await post(teacher, previewUrl, { fileBase64: file, section: "1" })).json();
    // First occurrence per student ID (the file repeats 69000001 as its duplicate row).
    const byId: Record<string, Row> = {};
    for (const r of preview.rows as Row[]) byId[r.studentId] ??= r;
    assert.deepEqual(
      [byId["69000001"]!.status, byId["69000002"]!.status, byId["69000002"]!.studentIdConflict, byId["69000003"]!.status, byId["69000004"]!.status, byId["BAD ID"]!.status],
      ["enroll", "update", "11111111", "pending", "other_section", "invalid"],
    );
    assert.deepEqual([preview.counts.duplicate, preview.counts.enroll, preview.counts.pending], [1, 1, 1]);
    assert.deepEqual(preview.missing.map((m: { email: string }) => m.email), ["extra@example.edu"]);
    assert.equal((await pool.query("SELECT 1 FROM section_roster_entries")).rowCount, 0, "a preview writes nothing");

    const applied = await post(teacher, importUrl, { fileBase64: file, section: "1" });
    assert.equal(applied.statusCode, 200);
    const member = async (userId: string) =>
      (await pool.query<{ roles: string[]; student_id: string; roster_name_th: string; roster_name_en: string; roster_email: string }>(
        "SELECT roles, student_id, roster_name_th, roster_name_en, roster_email::text FROM memberships WHERE user_id = $1 AND section_id = $2",
        [userId, sectionId],
      )).rows[0];
    assert.deepEqual(await member(somchai.userId), { roles: ["student"], student_id: "69000001", roster_name_th: "นายสมชาย ทดสอบศรี", roster_name_en: "Mr. SOMCHAI THOTSOBSI", roster_email: "somchai.j@example.edu" });
    assert.equal((await member(somying.userId))!.student_id, "69000002", "the roster wins a student-ID conflict");
    const pending = (await get(teacher, `/api/sections/${sectionId}/roster-pending`)).json().pending;
    assert.deepEqual(pending.map((p: { student_id: string; email: string }) => [p.student_id, p.email]), [["69000003", "mana.k@example.edu"]]);
    const audit = await pool.query<{ metadata: { counts: Record<string, number>; encoding: string } }>("SELECT metadata FROM audit_log WHERE event_type = 'roster.imported'");
    assert.deepEqual([audit.rowCount, audit.rows[0]!.metadata.encoding, audit.rows[0]!.metadata.counts.pending], [1, "tis-620", 1]);

    // Mana's first Google sign-in claims the pending row.
    const signedIn = await upsertOAuthUser(pool, { provider: "google", providerSubject: "google-mana", email: "mana.k@example.edu", displayName: "Mana G", isAdmin: false, auditEventType: "auth.google_registered" });
    assert.equal(signedIn.emailCollision, false);
    assert.deepEqual(await member(signedIn.userId), { roles: ["student"], student_id: "69000003", roster_name_th: "นายมานะ ขยัน", roster_name_en: "Mr. MANA KHAYAN", roster_email: "mana.k@example.edu" });
    assert.equal((await get(teacher, `/api/sections/${sectionId}/roster-pending`)).json().pending.length, 0);
    assert.equal((await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'roster.claimed'")).rowCount, 1);

    // Personal-Gmail fallback: a simple-template UTF-8 file adds a pending row; someone signed in
    // with another address joins with the code and that student ID, and claims it -- flagged.
    const simple = Buffer.from("student_id,name,email\r\n69000005,นางสาวสมใจ ดีงาม,somjai.d@example.edu\r\n69000006,นายรอ ต่อไป,waiting@example.edu\r\n", "utf8").toString("base64");
    assert.equal((await post(teacher, importUrl, { fileBase64: simple })).statusCode, 200);
    const gmail = await createUserWithSession(pool, "somjai.personal@gmail.example", "Somjai Personal");
    assert.equal((await post(gmail, "/api/sections/join", { code: joinCode, studentId: "69000005" })).statusCode, 200);
    assert.deepEqual(await member(gmail.userId), { roles: ["student"], student_id: "69000005", roster_name_th: "นางสาวสมใจ ดีงาม", roster_name_en: null, roster_email: "somjai.d@example.edu" });

    type RosterRow = { user_id: string; student_id: string | null; roster_name_th: string | null; roster_email_mismatch: boolean | null; email: string | null };
    const staffView = (await get(teacher, `/api/sections/${sectionId}/memberships`)).json().memberships as RosterRow[];
    const flagged = staffView.find((m) => m.user_id === gmail.userId)!;
    assert.deepEqual([flagged.student_id, flagged.roster_name_th, flagged.roster_email_mismatch], ["69000005", "นางสาวสมใจ ดีงาม", true]);
    assert.equal(staffView.find((m) => m.user_id === somchai.userId)!.roster_email_mismatch, false);
    // Evidence (the product ClassOps exists for) carries the official name AND the mismatch flag,
    // so a student-ID claim from another account can't pass as the listed student unnoticed.
    const packageId = (await importActivityPackage(pool, syntheticPackage())).id;
    const activityId = (await post(teacher, `/api/sections/${sectionId}/activities`, { packageId, status: "open" })).json().activity.id as string;
    const evidence = (await get(teacher, `/api/section-activities/${activityId}/evidence`)).json().students as {
      userId: string;
      displayName: string;
      accountName: string;
      rosterEmailMismatch: boolean;
    }[];
    const gmailEvidence = evidence.find((s) => s.userId === gmail.userId)!;
    assert.deepEqual([gmailEvidence.displayName, gmailEvidence.accountName, gmailEvidence.rosterEmailMismatch], ["นางสาวสมใจ ดีงาม", "Somjai Personal", true]);
    assert.equal(evidence.find((s) => s.userId === somchai.userId)!.rosterEmailMismatch, false);
    const csvLines = (await get(teacher, `/api/section-activities/${activityId}/evidence/export`)).body.split("\n");
    assert.ok(csvLines[0]!.endsWith("Roster Email Mismatch"));
    assert.ok(csvLines.find((l) => l.includes("somjai.personal@gmail.example"))!.endsWith(",yes"));

    const studentView = (await get(extra, `/api/sections/${sectionId}/memberships`)).json().memberships as RosterRow[];
    assert.ok(studentView.every((m) => m.student_id === null && m.roster_name_th === null && m.roster_email_mismatch === null), "the roster record is staff-only");

    // Cancelling a pending row.
    const waiting = (await get(teacher, `/api/sections/${sectionId}/roster-pending`)).json().pending as { id: string; student_id: string }[];
    assert.deepEqual(waiting.map((p) => p.student_id), ["69000006"]);
    const del = (id: string) => app.inject({ method: "DELETE", url: `/api/sections/${sectionId}/roster-pending/${id}`, headers: { cookie: teacher.cookie, ...origin } });
    assert.equal((await del(waiting[0]!.id)).statusCode, 200);
    assert.equal((await del(waiting[0]!.id)).statusCode, 404);

    // Another institution's list (PS-TASK-20260925-747): Thai headers the synonyms cover.
    const other = Buffer.from("ลำดับ,รหัสนิสิต,คำนำหน้า,ชื่อ,นามสกุล,อีเมล์\r\n1,B6500001,นาย,ต่างถิ่น,มาเรียน,other.inst@uni.example\r\n", "utf8").toString("base64");
    const otherPreview = (await post(teacher, previewUrl, { fileBase64: other })).json();
    assert.deepEqual([otherPreview.needsMapping, otherPreview.format, otherPreview.mapping.studentId, otherPreview.rows[0].nameTh, otherPreview.rows[0].status], [false, "custom", "รหัสนิสิต", "นายต่างถิ่น มาเรียน", "pending"]);

    // A header nothing recognises: the teacher chooses the columns.
    const opaque = Buffer.from("A,B,C\r\nX-9,นางสาวเลือก คอลัมน์,pick.cols@school.example\r\n", "utf8").toString("base64");
    const needs = (await post(teacher, previewUrl, { fileBase64: opaque })).json();
    assert.deepEqual([needs.needsMapping, needs.headers, needs.sample], [true, ["A", "B", "C"], [["X-9", "นางสาวเลือก คอลัมน์", "pick.cols@school.example"]]]);
    assert.deepEqual((await post(teacher, importUrl, { fileBase64: opaque })).json(), { error: "MAPPING_REQUIRED" });
    const mapping = { studentId: "A", email: "C", nameTh: ["B"], nameEn: [], section: null, courseCode: null };
    assert.deepEqual((await post(teacher, previewUrl, { fileBase64: opaque, mapping: { ...mapping, studentId: "Z" } })).json(), { error: "INVALID_MAPPING" });
    const mapped = (await post(teacher, previewUrl, { fileBase64: opaque, mapping })).json();
    assert.deepEqual([mapped.needsMapping, mapped.rows[0].studentId, mapped.rows[0].nameTh, mapped.rows[0].status], [false, "X-9", "นางสาวเลือก คอลัมน์", "pending"]);
    assert.equal((await post(teacher, importUrl, { fileBase64: opaque, mapping })).statusCode, 200);
    const mappedPending = (await get(teacher, `/api/sections/${sectionId}/roster-pending`)).json().pending as { student_id: string }[];
    assert.ok(mappedPending.some((p) => p.student_id === "X-9"));
  } finally {
    await app.close();
  }
});
