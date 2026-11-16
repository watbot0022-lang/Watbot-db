// กิจกรรมพัฒนาผู้เรียน (ปพ.5.1) — หน้าเดียวสำหรับครูประจำชั้นและฝ่ายวิชาการ บันทึกครบ 4 กิจกรรม
// ค่าเริ่มต้นผ่าน: เก็บเฉพาะ "มผ" ในช่อง act_xxx_t1/t2 (เวลาเรียน ภาค 1/2) / act_xxx_o1/o2 (จุดประสงค์) ของ gr_assessments
// บันทึกรายภาค (?term=1|2) · ผลทั้งปีสรุปที่ภาคเรียนที่ 2 = ต้องผ่านทั้ง 2 ภาค · ปพ.6 / ปพ.1 อ่านจากตารางเดียวกันนี้
import { json, readJson, fail, requireUser, text, audit, batchAll } from "../lib/http.js";
import { assertHomeroomWritable, homeroomEditState, reopenApprovedForRoom } from "../lib/edit-requests.js";
import { resolveYear, roomRoster, listRooms, getSettings, assessmentsFor, studentName, isPrimaryGrade, compareRoom, writableIds, activitiesFor, ensureActivities } from "../lib/data.js";
import { ACTIVITY_PARTS, ACTIVITY_TERMS, activityKey, activityIndicatorKey } from "../../public/js/grading.js";

// คีย์ที่บันทึกได้ของภาค t: เวลาเรียน (_t) ทุกกิจกรรม + ตัวชี้วัด (_i<id>t) หรือ "จุดประสงค์" (_o) ถ้ากิจกรรมยังไม่มีตัวชี้วัด
const termKeys = (acts, t) => acts.flatMap((a) => [activityKey(a.key, "t", t),
  ...(a.indicators.length ? a.indicators.map((i) => activityIndicatorKey(a.key, i.id, t)) : [activityKey(a.key, "o", t)])]);
const allKeys = (acts) => ACTIVITY_TERMS.flatMap((t) => termKeys(acts, t)); // GET ส่งทั้ง 2 ภาค (ภาค 2 แสดงผลภาค 1 และผลทั้งปี)
const termOf = (v) => { const t = Number(v); if (!ACTIVITY_TERMS.includes(t)) fail(400, "ระบุภาคเรียน (1 หรือ 2)"); return t; };

// ห้องที่ผู้ใช้บันทึกได้: ฝ่ายวิชาการ/ทีมวัดผล (เปิดในบทบาทวัดผล) = ทุกห้อง (เฉพาะห้องนำร่องถ้าตั้งไว้)
// ครูประจำชั้น หรือบัญชีวัดผลที่เปิดในบทบาทครู (scope=teacher) = เฉพาะห้องที่ตนเป็นครูประจำชั้น
async function editableRooms(env, user, year, teacherScope) {
  if (user.can_import && !teacherScope) {
    const settings = await getSettings(env, year.id);
    return (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level))
      .map((r) => ({ grade_level: r.grade_level, classroom: r.classroom, students: r.students }))
      .filter((r) => !settings.pilot_rooms || settings.pilot_rooms.includes(`${r.grade_level}/${r.classroom}`));
  }
  const { results } = await env.DB.prepare(
    "SELECT grade_level, classroom FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ?"
  ).bind(year.id, user.id).all();
  // กิจกรรมพัฒนาผู้เรียนเป็นของ ป.1–6 (อนุบาลไม่มี ปพ.5.1) — ครูประจำชั้นอนุบาลไม่ต้องเห็นห้องที่บันทึกไม่ได้
  return results.filter((r) => isPrimaryGrade(r.grade_level)).sort(compareRoom);
}

export async function handleActivities(request, env, user, parts, method, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  if (parts[2] === "setup") return handleSetup(request, env, user, parts, method, year);
  const rooms = await editableRooms(env, user, year, url.searchParams.get("scope") === "teacher");
  const pick = async (grade, room) => {
    grade = text(grade, 10); room = text(room, 10);
    if (!isPrimaryGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
    if (!rooms.some((r) => r.grade_level === grade && r.classroom === room)) fail(403, "บันทึกได้เฉพาะห้องที่เป็นครูประจำชั้น หรือฝ่ายวิชาการ");
    return { grade, room, roster: await roomRoster(env, year.id, grade, room) };
  };

  if (method === "GET") {
    const out = { year, rooms, terms: ACTIVITY_TERMS, parts: ACTIVITY_PARTS.map(([key, label]) => ({ key, label })), can_setup: !!user.can_import };
    if (!url.searchParams.get("grade")) return json(out);
    const { grade, room, roster } = await pick(url.searchParams.get("grade"), url.searchParams.get("room"));
    const [ass, activities] = await Promise.all([assessmentsFor(env, year.id, roster.map((s) => s.id)), activitiesFor(env, year.id, grade)]);
    const KEYS = allKeys(activities);
    return json({ ...out, activities, grade, room, edit: await homeroomEditState(env, user, year.id, grade, room), students: roster.map((s) => ({
      id: s.id, number: s.number, name: studentName(s), enrollment_status: s.enrollment_status,
      values: Object.fromEntries(KEYS.filter((k) => ass[s.id]?.[k]).map((k) => [k, ass[s.id][k]])),
    })) });
  }

  if (method === "PUT") {
    const b = await readJson(request);
    const { grade, room, roster } = await pick(b.grade, b.room);
    const activities = await activitiesFor(env, year.id, grade);
    const KEYS = allKeys(activities);
    const term = termOf(b.term), allowed = new Set(termKeys(activities, term)); // บันทึกได้เฉพาะคีย์ของภาคที่เลือก
    await assertHomeroomWritable(env, user, year.id, grade, room);
    const ids = new Set(roster.map((s) => s.id)), writable = writableIds(roster);
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 3000) : [];
    const stmts = [];
    for (const c of changes) {
      const sid = Number(c.student_id);
      if (!ids.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
      if (!writable.has(sid)) continue; // ย้ายออก/ออกกลางคัน: อ่านอย่างเดียว
      if (!allowed.has(c.item_key)) fail(400, KEYS.includes(c.item_key) ? `หัวข้อนี้ไม่ใช่ของภาคเรียนที่ ${term}` : "หัวข้อกิจกรรมไม่ถูกต้อง");
      if (c.value && c.value !== "มผ") fail(400, "บันทึกได้เฉพาะ มผ (ค่าเริ่มต้นคือผ่าน)");
      stmts.push(c.value
        ? env.DB.prepare(`INSERT INTO gr_assessments (academic_year_id, student_id, item_key, value, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
            ON CONFLICT(academic_year_id, student_id, item_key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(year.id, sid, c.item_key, "มผ", user.id)
        : env.DB.prepare("DELETE FROM gr_assessments WHERE academic_year_id = ? AND student_id = ? AND item_key = ?").bind(year.id, sid, c.item_key));
    }
    await batchAll(env, stmts);
    await audit(env, user, "activity.update", { grade, room, term, changes: changes.length });
    // ผลกิจกรรมพิมพ์ลง ปพ.5/ปพ.6 — แก้หลังอนุมัติให้กลับไปรอผู้บริหารอนุมัติใหม่ เหมือนคุณลักษณะฯ / อ่าน คิด เขียน
    if (stmts.length) await reopenApprovedForRoom(env, user, year.id, grade, room, `แก้กิจกรรมพัฒนาผู้เรียน ภาค ${term}`);
    return json({ ok: true, saved: stmts.length });
  }
  fail(405, "ไม่รองรับ");
}

// ---------- ฝ่ายวัดผล: ตั้งกิจกรรมและตัวชี้วัด (รายปี + ระดับชั้น) ----------
// GET    /api/activities/setup?year=           → { activities: { "ป.1": [...] } }
// POST   /api/activities/setup                  { grade, name } เพิ่มกิจกรรม
// PUT    /api/activities/setup/:id              { name, sort_order? } แก้ชื่อ/ลำดับ
// DELETE /api/activities/setup/:id              ลบกิจกรรม (ผลที่บันทึกไว้ไม่นำมาคิดอีก)
// POST   /api/activities/setup/:id/indicators   { label } เพิ่มตัวชี้วัด
// PUT    /api/activities/setup/indicators/:iid  { label, sort_order? } · DELETE ลบตัวชี้วัด
// POST   /api/activities/setup/copy             { from, to: [ชั้น] } คัดลอกรายการ (พร้อมตัวชี้วัด) ไปชั้นอื่น แทนที่ของเดิม
const ACT_GRADES = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
async function handleSetup(request, env, user, parts, method, year) {
  if (method === "GET") {
    if (!user.can_import && !user.can_view_all) fail(403, "เฉพาะฝ่ายวัดผล/วิชาการ");
    return json({ year, grades: ACT_GRADES, activities: await activitiesFor(env, year.id), can_edit: !!user.can_import });
  }
  if (!user.can_import) fail(403, "ตั้งกิจกรรมพัฒนาผู้เรียนได้เฉพาะฝ่ายวัดผล");
  await ensureActivities(env, year.id);
  const name = (v, what) => { const t = text(v, 200); if (!t) fail(400, `กรอก${what}`); return t; };
  const sort = (v) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fail(400, "ลำดับต้องเป็นตัวเลข"));
  const getAct = async (id) => {
    const a = await env.DB.prepare("SELECT * FROM gr_activities WHERE id = ? AND academic_year_id = ?").bind(Number(id), year.id).first();
    if (!a) fail(404, "ไม่พบกิจกรรม"); return a;
  };
  const getInd = async (id) => {
    const i = await env.DB.prepare(`SELECT i.*, a.grade_level, a.name AS activity_name FROM gr_activity_indicators i JOIN gr_activities a ON a.id = i.activity_id
      WHERE i.id = ? AND a.academic_year_id = ?`).bind(Number(id), year.id).first();
    if (!i) fail(404, "ไม่พบตัวชี้วัด"); return i;
  };
  const done = async () => json({ ok: true, activities: await activitiesFor(env, year.id) });
  const [, , , a1, a2] = parts;

  if (a1 === "copy" && method === "POST") {
    const b = await readJson(request);
    const from = text(b.from, 10), to = (Array.isArray(b.to) ? b.to : []).map((g) => text(g, 10)).filter((g) => ACT_GRADES.includes(g) && g !== from);
    if (!ACT_GRADES.includes(from) || !to.length) fail(400, "เลือกชั้นต้นทางและชั้นปลายทาง");
    const src = await activitiesFor(env, year.id, from);
    for (const g of to) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_activity_indicators WHERE activity_id IN (SELECT id FROM gr_activities WHERE academic_year_id = ? AND grade_level = ?)").bind(year.id, g),
        env.DB.prepare("DELETE FROM gr_activities WHERE academic_year_id = ? AND grade_level = ?").bind(year.id, g),
        ...src.map((a) => env.DB.prepare("INSERT INTO gr_activities (academic_year_id, grade_level, activity_key, name, sort_order) VALUES (?,?,?,?,?)").bind(year.id, g, a.key, a.label, a.sort_order)),
      ]);
      // ตัวชี้วัดได้ id ใหม่ — ผลรายตัวชี้วัดเดิมของชั้นปลายทางจึงไม่นำมาคิด
      const stmts = src.flatMap((a) => a.indicators.map((i) => env.DB.prepare(`INSERT INTO gr_activity_indicators (activity_id, label, sort_order)
        VALUES ((SELECT id FROM gr_activities WHERE academic_year_id = ? AND grade_level = ? AND activity_key = ?), ?, ?)`).bind(year.id, g, a.key, i.label, i.sort_order)));
      if (stmts.length) await batchAll(env, stmts);
    }
    await audit(env, user, "activity.setup.copy", { year: year.id, from, to });
    return done();
  }
  if (a1 === "indicators" && a2) {
    const ind = await getInd(a2);
    if (method === "PUT") {
      const b = await readJson(request), s = sort(b.sort_order);
      await env.DB.prepare("UPDATE gr_activity_indicators SET label = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?").bind(name(b.label, "ตัวชี้วัด"), s, ind.id).run();
      await audit(env, user, "activity.indicator.update", { id: ind.id });
      return done();
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM gr_activity_indicators WHERE id = ?").bind(ind.id).run();
      await audit(env, user, "activity.indicator.delete", { id: ind.id, label: ind.label, grade: ind.grade_level, activity: ind.activity_name });
      return done();
    }
  }
  if (!a1 && method === "POST") {
    const b = await readJson(request), grade = text(b.grade, 10);
    if (!ACT_GRADES.includes(grade)) fail(400, "เลือกระดับชั้น ป.1–6");
    const nm = name(b.name, "ชื่อกิจกรรม");
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM gr_activities WHERE academic_year_id = ? AND grade_level = ?").bind(year.id, grade).first();
    const tmp = `act_new_${crypto.randomUUID().slice(0, 8)}`;
    const r = await env.DB.prepare("INSERT INTO gr_activities (academic_year_id, grade_level, activity_key, name, sort_order) VALUES (?,?,?,?,?)")
      .bind(year.id, grade, tmp, nm, sort(b.sort_order) ?? max.m + 10).run();
    const id = r.meta.last_row_id;
    await env.DB.prepare("UPDATE gr_activities SET activity_key = ? WHERE id = ?").bind(`act_c${id}`, id).run(); // คีย์ไม่ซ้ำกับผลที่เคยบันทึก
    await audit(env, user, "activity.create", { id, grade, name: nm });
    return done();
  }
  if (a1 && a2 === "indicators" && method === "POST") {
    const act = await getAct(a1), b = await readJson(request);
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM gr_activity_indicators WHERE activity_id = ?").bind(act.id).first();
    await env.DB.prepare("INSERT INTO gr_activity_indicators (activity_id, label, sort_order) VALUES (?,?,?)").bind(act.id, name(b.label, "ตัวชี้วัด"), sort(b.sort_order) ?? max.m + 10).run();
    await audit(env, user, "activity.indicator.create", { activity: act.id });
    return done();
  }
  if (a1 && !a2) {
    const act = await getAct(a1);
    if (method === "PUT") {
      const b = await readJson(request);
      await env.DB.prepare("UPDATE gr_activities SET name = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?").bind(name(b.name, "ชื่อกิจกรรม"), sort(b.sort_order), act.id).run();
      await audit(env, user, "activity.update.setup", { id: act.id });
      return done();
    }
    if (method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_activity_indicators WHERE activity_id = ?").bind(act.id),
        env.DB.prepare("DELETE FROM gr_activities WHERE id = ?").bind(act.id),
      ]);
      await audit(env, user, "activity.delete", { id: act.id, grade: act.grade_level, name: act.name });
      return done();
    }
  }
  fail(405, "ไม่รองรับ");
}
