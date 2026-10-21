// สำรองข้อมูล / กู้คืนข้อมูลของระบบรายงานผลการเรียนเป็นไฟล์ JSON — เฉพาะผู้ดูแลระบบ (superadmin)
// ครอบคลุมตาราง gr_* ทั้งหมด (ทุกปีการศึกษา) + ตารางพื้นฐานของโรงเรียน (บัญชีผู้ใช้ นักเรียน ปี/ภาคเรียน ค่าตั้งระบบ)
// ไม่รวมประวัติการเข้าสู่ระบบ (auth_sessions ฯลฯ) — กู้คืนแล้วบัญชีที่ไม่ตรงกับไฟล์ต้องเข้าสู่ระบบใหม่
//
// สำรอง:  GET  /api/backup/tables                     → รายชื่อตาราง + จำนวนแถว
//         GET  /api/backup/rows?table=&after=          → แถวทีละหน้า (เรียงตาม rowid) — หน้าเว็บรวมเป็นไฟล์เดียว
// กู้คืน: POST /api/backup/restore/start  {schema, tables:{name:{columns,count}}}   → ตรวจไฟล์ เตรียมตารางพัก
//         POST /api/backup/restore/rows   {table, columns, rows}                     → ใส่ข้อมูลลงตารางพัก (ทีละชุด)
//         POST /api/backup/restore/finish                                            → ตรวจครบแล้วสลับข้อมูลทั้งหมดในครั้งเดียว (atomic)
//         POST /api/backup/restore/cancel                                            → ทิ้งตารางพัก
// ถ้าอัปโหลดล้มกลางทาง ข้อมูลจริงไม่ถูกแตะ เพราะเปลี่ยนเฉพาะตอน finish ซึ่งเป็น transaction เดียว
import { json, readJson, fail, requireUser, audit } from "../lib/http.js";
import { SCHEMA_VERSION } from "../lib/schema.js";

export const BACKUP_FORMAT = "watbot-students-report-backup";
const CORE = ["users", "academic_years", "academic_terms", "students", "student_details", "student_enrollments", "viewer_accounts", "system_settings"];
const STAGE = "gr__restore_";          // ตารางพักระหว่างกู้คืน
const SKIP_RESTORE = new Set(["gr_audit"]); // ประวัติการใช้งานคงของเดิมไว้ (ไฟล์สำรองยังเก็บไว้ให้ดู)
const PAGE = 2000;
const IDENT = /^[a-z][a-z0-9_]+$/;
const stage = (n) => `${STAGE}${n}`;

function requireSuper(user) {
  requireUser(user);
  if (user.role !== "superadmin") fail(403, "สำรองและกู้คืนข้อมูลได้เฉพาะผู้ดูแลระบบ (superadmin)");
}

// ตาราง gr_* ที่มีอยู่จริง เรียงให้ตารางแม่มาก่อนตารางลูก (ตาม foreign key)
export async function gradeTables(env) {
  const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'gr\\_%' ESCAPE '\\' OR name IN (" + CORE.map(() => "?").join(",") + ")) ORDER BY name").bind(...CORE).all();
  const names = results.map((r) => r.name).filter((n) => IDENT.test(n) && !n.startsWith("gr__"));
  const deps = {};
  for (const n of names) {
    const { results: fks } = await env.DB.prepare(`PRAGMA foreign_key_list(${n})`).all();
    deps[n] = fks.map((f) => f.table).filter((t) => names.includes(t) && t !== n);
  }
  const out = [], seen = new Set();
  const visit = (n) => { if (seen.has(n)) return; seen.add(n); deps[n].forEach(visit); out.push(n); };
  names.forEach(visit);
  return out;
}
async function columnsOf(env, table) {
  if (!IDENT.test(table) || (!table.startsWith("gr_") && !CORE.includes(table))) fail(400, "ชื่อตารางไม่ถูกต้อง");
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return results.map((r) => r.name);
}

export async function handleBackup(request, env, user, parts, method, url) {
  requireSuper(user);
  const sub = parts[2], step = parts[3];

  if (sub === "tables" && method === "GET") {
    const tables = [];
    for (const name of await gradeTables(env)) {
      const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n;
      tables.push({ name, count: n, columns: await columnsOf(env, name), restorable: !SKIP_RESTORE.has(name) });
    }
    return json({ format: BACKUP_FORMAT, schema: SCHEMA_VERSION, tables });
  }

  if (sub === "rows" && method === "GET") {
    const table = url.searchParams.get("table") || "";
    if (!(await gradeTables(env)).includes(table)) fail(400, "ไม่พบตาราง");
    const after = Number(url.searchParams.get("after") || 0);
    const columns = await columnsOf(env, table);
    const { results } = await env.DB.prepare(`SELECT rowid AS __rid, ${columns.map((c) => `"${c}"`).join(", ")} FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`).bind(after).all();
    return json({ table, columns, rows: results.map((r) => columns.map((c) => r[c])), next: results.length === PAGE ? results.at(-1).__rid : null });
  }

  if (sub === "restore") {
    if (method !== "POST") fail(405, "ไม่รองรับ");
    const live = await gradeTables(env);
    const staged = async () => (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '${STAGE}%'`).all()).results.map((r) => r.name);
    const dropStaged = async () => { const s = await staged(); if (s.length) await env.DB.batch(s.map((n) => env.DB.prepare(`DROP TABLE IF EXISTS ${n}`))); };

    if (step === "cancel") { await dropStaged(); return json({ ok: true }); }

    if (step === "start") {
      const b = await readJson(request);
      if (b.format !== BACKUP_FORMAT) fail(400, "ไม่ใช่ไฟล์สำรองของระบบรายงานผลการเรียน");
      if (!b.tables || typeof b.tables !== "object") fail(400, "ไฟล์สำรองไม่มีข้อมูลตาราง");
      const plan = [], warnings = [];
      for (const [name, t] of Object.entries(b.tables)) {
        if (SKIP_RESTORE.has(name)) continue;
        if (!live.includes(name)) { warnings.push(`ข้ามตาราง ${name} (ระบบปัจจุบันไม่มีตารางนี้)`); continue; }
        const cols = await columnsOf(env, name);
        const extra = (t.columns || []).filter((c) => !cols.includes(c));
        if (extra.length) fail(400, `ตาราง ${name} มีคอลัมน์ที่ระบบนี้ไม่รู้จัก (${extra.join(", ")}) — ไฟล์มาจากระบบเวอร์ชันใหม่กว่า`);
        if (!Array.isArray(t.columns) || !t.columns.length || !Number.isInteger(t.count) || t.count < 0) fail(400, `ข้อมูลตาราง ${name} ไม่ถูกต้อง`);
        plan.push({ name, columns: t.columns, count: t.count });
      }
      if (!plan.length) fail(400, "ไฟล์สำรองไม่มีตารางที่กู้คืนได้");
      for (const name of live) if (!SKIP_RESTORE.has(name) && !plan.some((p) => p.name === name)) warnings.push(`ไฟล์ไม่มีตาราง ${name} — ตารางนี้จะว่างหลังกู้คืน`);
      await dropStaged();
      // ตารางพักทุกตารางของระบบ (แม้ไฟล์ไม่มี) เพื่อให้ผลหลังกู้คืน = ไฟล์สำรองพอดี
      await env.DB.batch(live.filter((n) => !SKIP_RESTORE.has(n)).map((n) => env.DB.prepare(`CREATE TABLE ${stage(n)} AS SELECT * FROM ${n} WHERE 0`)));
      await env.DB.prepare(`CREATE TABLE ${STAGE}_plan (name TEXT PRIMARY KEY, expected INTEGER NOT NULL, columns TEXT NOT NULL)`).run();
      await env.DB.batch(plan.map((p) => env.DB.prepare(`INSERT INTO ${STAGE}_plan (name, expected, columns) VALUES (?, ?, ?)`).bind(p.name, p.count, JSON.stringify(p.columns))));
      return json({ ok: true, tables: plan.map(({ name, count }) => ({ name, count })), warnings, file_schema: b.schema || null, schema: SCHEMA_VERSION });
    }

    if (step === "rows") {
      const b = await readJson(request);
      const name = String(b.table || "");
      if (!live.includes(name) || SKIP_RESTORE.has(name) || !(await staged()).includes(stage(name))) fail(400, "ยังไม่ได้เริ่มกู้คืน หรือไม่พบตาราง");
      const cols = await columnsOf(env, name);
      const columns = Array.isArray(b.columns) ? b.columns.map(String) : [];
      if (!columns.length || columns.some((c) => !cols.includes(c))) fail(400, `คอลัมน์ของตาราง ${name} ไม่ถูกต้อง`);
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (rows.length > 1000) fail(400, "ส่งได้ครั้งละไม่เกิน 1000 แถว");
      if (rows.some((r) => !Array.isArray(r) || r.length !== columns.length || r.some((v) => v !== null && !["string", "number"].includes(typeof v)))) fail(400, `ข้อมูลแถวของตาราง ${name} ไม่ถูกต้อง`);
      const per = Math.max(1, Math.floor(90 / columns.length)); // D1 จำกัดตัวแปรต่อคำสั่ง
      const stmts = [];
      for (let i = 0; i < rows.length; i += per) {
        const chunk = rows.slice(i, i + per);
        stmts.push(env.DB.prepare(`INSERT INTO ${stage(name)} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ")}`).bind(...chunk.flat()));
      }
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      return json({ ok: true, added: rows.length });
    }

    if (step === "finish") {
      const s = await staged();
      if (!s.includes(`${STAGE}_plan`)) fail(400, "ยังไม่ได้เริ่มกู้คืน");
      const { results: plan } = await env.DB.prepare(`SELECT name, expected, columns FROM ${STAGE}_plan`).all();
      for (const p of plan) {
        const got = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${stage(p.name)}`).first()).n;
        if (got !== p.expected) fail(409, `ตาราง ${p.name} ได้ข้อมูล ${got} จาก ${p.expected} แถว — อัปโหลดไม่ครบ ข้อมูลเดิมยังไม่ถูกเปลี่ยน`);
      }
      const order = live.filter((n) => !SKIP_RESTORE.has(n));
      const stmts = [env.DB.prepare("PRAGMA defer_foreign_keys = ON")];
      // กู้คืนบัญชีผู้ใช้: การเข้าสู่ระบบที่ค้างอยู่ใช้ต่อได้เฉพาะบัญชีที่รหัสและอีเมลตรงกับในไฟล์ · ที่เหลือยกเลิก/ลบ (ไม่ให้ติด foreign key)
      if (plan.some((p) => p.name === "users")) {
        const keep = `SELECT u.id FROM users u JOIN ${stage("users")} x ON x.id = u.id AND x.email = u.email`;
        for (const t of ["auth_sessions", "security_notifications"]) {
          if (await env.DB.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").bind(t).first()) stmts.push(env.DB.prepare(`DELETE FROM ${t} WHERE user_id NOT IN (${keep})`));
        }
      }
      for (const n of [...order].reverse()) stmts.push(env.DB.prepare(`DELETE FROM ${n}`));
      // ไฟล์สำรองก่อน gr-18 ใช้ "มส" เป็นรหัสมาสาย → แปลงเป็น "ส"
      if (plan.some((p) => p.name === "gr_attendance")) stmts.push(env.DB.prepare(`UPDATE ${stage("gr_attendance")} SET code = 'ส' WHERE code = 'มส'`));
      for (const n of order) {
        const p = plan.find((x) => x.name === n);
        if (!p) continue; // ไฟล์ไม่มีตารางนี้ → ว่าง
        // เฉพาะคอลัมน์ที่มีในไฟล์ — คอลัมน์ที่เพิ่มในเวอร์ชันหลังใช้ค่าเริ่มต้นของตาราง
        const cols = JSON.parse(p.columns).map((c) => `"${c}"`).join(", ");
        stmts.push(env.DB.prepare(`INSERT INTO ${n} (${cols}) SELECT ${cols} FROM ${stage(n)}`));
      }
      try { await env.DB.batch(stmts); } // ทั้งหมดใน transaction เดียว — ผิดพลาดข้อมูลเดิมยังอยู่ครบ
      catch (err) { fail(409, `กู้คืนไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ (${String(err.message || err).slice(0, 200)})`); }
      await dropStaged();
      const summary = Object.fromEntries(plan.map((p) => [p.name, p.expected]));
      await audit(env, user, "backup.restore", { tables: plan.length, rows: plan.reduce((a, p) => a + p.expected, 0) });
      return json({ ok: true, restored: summary });
    }
  }
  fail(404, "ไม่พบเส้นทาง");
}
