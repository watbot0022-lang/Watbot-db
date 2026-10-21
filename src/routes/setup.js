// ส่วนที่ระบบป่าเด็งได้มาจากระบบทะเบียน: ปีการศึกษา/ภาคเรียน เลื่อนชั้นนักเรียน ตราโรงเรียน ข้อมูลฐานข้อมูล
import { json, readJson, fail, requireImporter, requireSuperadmin, intParam, text, audit } from "../lib/http.js";
import { listYears, getSettings, isSchoolGrade, compareRoom, LEFT_STATUSES, DEFAULT_SETTINGS } from "../lib/data.js";
import { upsertSettings } from "./admin.js";
import { CORE_SQL, SCHEMA_SQL } from "../lib/schema.js";

const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
export const NEXT_GRADE = { "อ.1": "อ.2", "อ.2": "อ.3", "อ.3": "ป.1", "ป.1": "ป.2", "ป.2": "ป.3", "ป.3": "ป.4", "ป.4": "ป.5", "ป.5": "ป.6", "ป.6": null };

function cleanTerms(terms) {
  const out = [];
  for (const t of Array.isArray(terms) ? terms : []) {
    const n = Number(t.term_number);
    if (![1, 2].includes(n)) fail(400, "ภาคเรียนต้องเป็น 1 หรือ 2");
    if (!validDate(t.start_date) || !validDate(t.end_date) || t.end_date < t.start_date) fail(400, `วันเปิด–ปิดภาคเรียนที่ ${n} ไม่ถูกต้อง`);
    out.push({ term_number: n, start_date: t.start_date, end_date: t.end_date });
  }
  if (!out.length) fail(400, "กรุณากำหนดภาคเรียนอย่างน้อย 1 ภาค");
  if (new Set(out.map((t) => t.term_number)).size !== out.length) fail(400, "ภาคเรียนซ้ำ");
  out.sort((a, b) => a.term_number - b.term_number);
  if (out.length === 2 && out[1].start_date <= out[0].end_date) fail(400, "ภาคเรียนที่ 2 ต้องเริ่มหลังภาคเรียนที่ 1 สิ้นสุด");
  return out;
}

const termsOf = async (env, yearId) => (await env.DB.prepare("SELECT id, term_number, start_date, end_date FROM academic_terms WHERE academic_year_id = ? ORDER BY term_number").bind(yearId).all()).results;

// ตราโรงเรียนที่อัปโหลด (data URL ใน system_settings) → ส่งเป็นไฟล์ภาพแทน /logo.png
export async function serveLogo(env) {
  const row = await env.DB.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'school_logo'").first();
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(row?.setting_value || "");
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=300" } });
}

export async function handleSetup(request, env, user, parts, method) {
  const sub = parts[2];

  if (sub === "branding") {
    requireSuperadmin(user);
    if (method === "GET") return json({ logo: (await env.DB.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'school_logo'").first())?.setting_value || null });
    if (method === "PUT") {
      const b = await readJson(request);
      const logo = b.logo ? String(b.logo) : null;
      if (logo && (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 300000)) fail(400, "รูปตราโรงเรียนต้องเป็นไฟล์ภาพขนาดไม่เกินประมาณ 200 KB (ระบบย่อให้อัตโนมัติ)");
      if (logo) await env.DB.prepare(`INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES ('school_logo', ?, ?, datetime('now'))
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(logo, user.id).run();
      else await env.DB.prepare("DELETE FROM system_settings WHERE setting_key = 'school_logo'").run();
      await audit(env, user, "system.branding", { logo: !!logo });
      return json({ ok: true });
    }
  }

  // จำนวนแถวรายตาราง (ดูขนาดฐานข้อมูล)
  if (sub === "system" && method === "GET") {
    requireSuperadmin(user);
    const names = [...CORE_SQL, ...SCHEMA_SQL].map((s) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(s)?.[1]).filter(Boolean);
    const tables = [];
    for (let i = 0; i < names.length; i += 40) {
      const part = names.slice(i, i + 40);
      const r = await env.DB.prepare(`SELECT ${part.map((n) => `(SELECT COUNT(*) FROM ${n}) AS ${n}`).join(", ")}`).first();
      for (const n of part) tables.push({ name: n, rows: Number(r?.[n] || 0) });
    }
    return json({ tables });
  }

  requireImporter(user);

  if (sub === "years" && !parts[3] && method === "GET") {
    const years = await listYears(env);
    const { results: counts } = await env.DB.prepare(`SELECT y.id,
        (SELECT COUNT(DISTINCT e.student_id) FROM student_enrollments e WHERE e.academic_year_id = y.id AND e.status = 'enrolled') AS students,
        (SELECT COUNT(*) FROM gr_subjects s WHERE s.academic_year_id = y.id) AS subjects
      FROM academic_years y`).all();
    const { results: terms } = await env.DB.prepare("SELECT id, academic_year_id, term_number, start_date, end_date FROM academic_terms ORDER BY term_number").all();
    return json({ years: years.map((y) => ({ ...y, terms: terms.filter((t) => t.academic_year_id === y.id), students: counts.find((c) => c.id === y.id)?.students || 0, subjects: counts.find((c) => c.id === y.id)?.subjects || 0 })) });
  }

  if (sub === "years" && !parts[3] && method === "POST") {
    const b = await readJson(request);
    const be = Number(b.year_be);
    if (!Number.isInteger(be) || be < 2500 || be > 2700) fail(400, "ปีการศึกษาต้องเป็น พ.ศ. เช่น 2569");
    if (await env.DB.prepare("SELECT 1 FROM academic_years WHERE year_be = ?").bind(be).first()) fail(409, `มีปีการศึกษา ${be} อยู่แล้ว`);
    const terms = cleanTerms(b.terms);
    const first = !(await env.DB.prepare("SELECT 1 FROM academic_years LIMIT 1").first());
    const activate = first || !!b.activate;
    if (activate) await env.DB.prepare("UPDATE academic_years SET status = 'closed' WHERE status = 'active'").run();
    const r = await env.DB.prepare("INSERT INTO academic_years (year_be, label, start_date, end_date, status, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(be, `ปีการศึกษา ${be}`, terms[0].start_date, terms[terms.length - 1].end_date, activate ? "active" : "draft", user.id).run();
    const id = r.meta.last_row_id;
    await env.DB.batch(terms.map((t) => env.DB.prepare("INSERT INTO academic_terms (academic_year_id, term_number, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)")
      .bind(id, t.term_number, `ภาคเรียนที่ ${t.term_number}/${be}`, t.start_date, t.end_date)));
    // ค่าตั้งของปีใหม่: ยกจากปีล่าสุดก่อนหน้า (ชื่อโรงเรียน ผู้ลงนาม เกณฑ์) ไม่ต้องกรอกใหม่ทุกปี
    const prev = (await listYears(env)).find((y) => y.year_be < be);
    if (prev) {
      const s = await getSettings(env, prev.id);
      const keep = ["collect_ratio", "indicator_pass_pct", "indicator_pass_pct_t2", "attendance_pass_pct", "school_name", "school_area", "affiliation", "school_address",
        "director_name", "deputy_director_name", "academic_head_name", "measurement_head_name", "roster_order"];
      const vals = Object.fromEntries(keep.filter((k) => s[k] != null && s[k] !== DEFAULT_SETTINGS[k]).map((k) => [k, s[k]]));
      if (Object.keys(vals).length) await upsertSettings(env, id, vals, user);
    }
    await audit(env, user, "year.create", { year_be: be, terms });
    return json({ ok: true, id });
  }

  if (sub === "years" && parts[3] && !parts[4] && method === "PUT") {
    const yid = intParam(parts[3]);
    const y = await env.DB.prepare("SELECT id, year_be FROM academic_years WHERE id = ?").bind(yid).first();
    if (!y) fail(404, "ไม่พบปีการศึกษา");
    const terms = cleanTerms((await readJson(request)).terms);
    const have = await termsOf(env, yid);
    const stmts = [];
    for (const t of terms) {
      const cur = have.find((x) => x.term_number === t.term_number);
      stmts.push(cur
        ? env.DB.prepare("UPDATE academic_terms SET start_date = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?").bind(t.start_date, t.end_date, cur.id)
        : env.DB.prepare("INSERT INTO academic_terms (academic_year_id, term_number, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)").bind(yid, t.term_number, `ภาคเรียนที่ ${t.term_number}/${y.year_be}`, t.start_date, t.end_date));
    }
    for (const cur of have) if (!terms.some((t) => t.term_number === cur.term_number)) {
      if (await env.DB.prepare("SELECT 1 FROM student_enrollments WHERE academic_term_id = ? LIMIT 1").bind(cur.id).first()) fail(409, `ลบภาคเรียนที่ ${cur.term_number} ไม่ได้ เพราะมีรายชื่อนักเรียนแล้ว`);
      stmts.push(env.DB.prepare("DELETE FROM academic_terms WHERE id = ?").bind(cur.id));
    }
    stmts.push(env.DB.prepare("UPDATE academic_years SET start_date = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?").bind(terms[0].start_date, terms[terms.length - 1].end_date, yid));
    await env.DB.batch(stmts);
    await audit(env, user, "year.update", { id: yid, terms });
    return json({ ok: true });
  }

  if (sub === "years" && parts[3] && parts[4] === "activate" && method === "POST") {
    const yid = intParam(parts[3]);
    if (!(await env.DB.prepare("SELECT 1 FROM academic_years WHERE id = ?").bind(yid).first())) fail(404, "ไม่พบปีการศึกษา");
    await env.DB.batch([
      env.DB.prepare("UPDATE academic_years SET status = 'closed', updated_at = datetime('now') WHERE status = 'active' AND id <> ?").bind(yid),
      env.DB.prepare("UPDATE academic_years SET status = 'active', updated_at = datetime('now') WHERE id = ?").bind(yid),
    ]);
    await audit(env, user, "year.activate", { id: yid });
    return json({ ok: true });
  }

  if (sub === "years" && parts[3] && !parts[4] && method === "DELETE") {
    const yid = intParam(parts[3]);
    const y = await env.DB.prepare("SELECT year_be FROM academic_years WHERE id = ?").bind(yid).first();
    if (!y) fail(404, "ไม่พบปีการศึกษา");
    if (await env.DB.prepare("SELECT 1 FROM student_enrollments WHERE academic_year_id = ? LIMIT 1").bind(yid).first()) fail(409, "ลบไม่ได้ — ปีนี้มีรายชื่อนักเรียนแล้ว");
    if (await env.DB.prepare("SELECT 1 FROM gr_subjects WHERE academic_year_id = ? LIMIT 1").bind(yid).first()) fail(409, "ลบไม่ได้ — ปีนี้มีรายวิชาแล้ว");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM academic_terms WHERE academic_year_id = ?").bind(yid),
      env.DB.prepare("DELETE FROM gr_settings WHERE academic_year_id = ?").bind(yid),
      env.DB.prepare("DELETE FROM academic_years WHERE id = ?").bind(yid),
    ]);
    await audit(env, user, "year.delete", { year_be: y.year_be });
    return json({ ok: true });
  }

  // เลื่อนชั้นจากปีก่อน: นักเรียนที่เรียนอยู่ → ชั้นถัดไป ห้องเดิม (ป.6 = จบการศึกษา) ลงทะเบียนภาคเรียนแรกของปีปลายทาง
  if (sub === "promote" && method === "POST") {
    const b = await readJson(request);
    const from = await env.DB.prepare("SELECT id, year_be FROM academic_years WHERE id = ?").bind(intParam(b.from_year, "ปีต้นทาง")).first();
    const to = await env.DB.prepare("SELECT id, year_be FROM academic_years WHERE id = ?").bind(intParam(b.to_year, "ปีปลายทาง")).first();
    if (!from || !to) fail(404, "ไม่พบปีการศึกษา");
    if (to.year_be <= from.year_be) fail(400, "ปีปลายทางต้องเป็นปีหลังปีต้นทาง");
    const term = (await termsOf(env, to.id))[0];
    if (!term) fail(409, "ปีปลายทางยังไม่ได้ตั้งภาคเรียน");
    // สถานะล่าสุดของนักเรียนแต่ละคนในปีต้นทาง
    const { results: latest } = await env.DB.prepare(`SELECT student_id, grade_level, classroom, status FROM (
        SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.student_id ORDER BY t.term_number DESC, e.id DESC) rn
          FROM student_enrollments e JOIN academic_terms t ON t.id = e.academic_term_id WHERE e.academic_year_id = ?) WHERE rn = 1`).bind(from.id).all();
    const { results: already } = await env.DB.prepare("SELECT DISTINCT student_id FROM student_enrollments WHERE academic_year_id = ?").bind(to.id).all();
    const skip = new Set(already.map((r) => r.student_id));
    const plan = [];
    let graduate = 0, skipped = 0;
    for (const e of latest) {
      if (e.status !== "enrolled" || !isSchoolGrade(e.grade_level)) continue;
      if (skip.has(e.student_id)) { skipped++; continue; }
      const next = NEXT_GRADE[e.grade_level];
      if (next === null) { graduate++; plan.push({ sid: e.student_id, grade: null }); continue; }
      plan.push({ sid: e.student_id, grade: next, room: e.classroom });
    }
    const rooms = {};
    for (const p of plan) if (p.grade) rooms[`${p.grade}/${p.room}`] = (rooms[`${p.grade}/${p.room}`] || 0) + 1;
    const preview = Object.entries(rooms).map(([k, n]) => ({ room: k, students: n }))
      .sort((a, c) => compareRoom({ grade_level: a.room.split("/")[0], classroom: a.room.split("/")[1] }, { grade_level: c.room.split("/")[0], classroom: c.room.split("/")[1] }));
    if (b.dry_run) return json({ ok: true, dry_run: true, promote: plan.length - graduate, graduate, skipped, rooms: preview });
    const stmts = plan.flatMap((p) => p.grade
      ? [env.DB.prepare("INSERT OR IGNORE INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom, status) VALUES (?, ?, ?, ?, ?, 'enrolled')").bind(p.sid, to.id, term.id, p.grade, p.room),
        env.DB.prepare("UPDATE students SET grade_level = ?, classroom = ?, status = 'enrolled' WHERE id = ?").bind(p.grade, p.room, p.sid)]
      : [env.DB.prepare("UPDATE students SET status = 'graduated' WHERE id = ?").bind(p.sid)]);
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    await audit(env, user, "students.promote", { from: from.year_be, to: to.year_be, promote: plan.length - graduate, graduate });
    return json({ ok: true, promote: plan.length - graduate, graduate, skipped });
  }

  // ยกรายชื่อจากภาค 1 ไปภาค 2 (ห้องเดิม) — ถ้าต้องการแยกรายชื่อรายภาค
  if (sub === "carry-term" && method === "POST") {
    const b = await readJson(request);
    const yid = intParam(b.year, "ปีการศึกษา");
    const terms = await termsOf(env, yid);
    const t1 = terms.find((t) => t.term_number === 1), t2 = terms.find((t) => t.term_number === 2);
    if (!t1 || !t2) fail(409, "ปีนี้ยังไม่มีภาคเรียนที่ 2");
    if (await env.DB.prepare("SELECT 1 FROM student_enrollments WHERE academic_term_id = ? LIMIT 1").bind(t2.id).first()) fail(409, "ภาคเรียนที่ 2 มีรายชื่อแล้ว");
    const r = await env.DB.prepare(`INSERT INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom, status)
      SELECT student_id, academic_year_id, ?, grade_level, classroom, status FROM student_enrollments
       WHERE academic_term_id = ? AND status NOT IN (${LEFT_STATUSES.map(() => "?").join(",")})`).bind(t2.id, t1.id, ...LEFT_STATUSES).run();
    await audit(env, user, "students.carry_term", { year: yid, n: r.meta.changes });
    return json({ ok: true, carried: r.meta.changes });
  }

  fail(404, "ไม่พบเส้นทาง API");
}
