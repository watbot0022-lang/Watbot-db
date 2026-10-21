import { shell, api, esc, toast, showError, dialog, confirmBox, hashTab, thaiTime } from "/js/app.js";
import { parseIndicatorLines } from "/js/indicators.js";
import { IMPORT_KINDS, parseGrid, gridToRows } from "/js/paste.js";
import { STARTER_SETS, STARTER_BASE, starterRows, parseStarter } from "/js/bank-starter.js";
import { loadXlsx } from "/js/export.js";
import { renderHolidayCalendar } from "/js/holiday-calendar.js";
import { renderBackup } from "/js/backup.js";

const me = await shell("admin");
const view = document.getElementById("view");
const main = document.getElementById("main");
if (!me.user.can_view_all) {
  main.hidden = false;
  view.innerHTML = `<div class="panel empty"><strong>หน้านี้สำหรับฝ่ายวิชาการ/วัดผล</strong>ติดต่อผู้บริหารเพื่อขอสิทธิ์</div>`;
  throw new Error("not admin");
}
const Y = me.year.id;
const CAN_IMPORT = !!me.user.can_import; // นำเข้าข้อมูล: เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล
if (!CAN_IMPORT) for (const t of ["import", "bank"]) document.querySelector(`#tabs [data-tab="${t}"]`)?.remove();
const yq = `year=${Y}`;
main.hidden = false;
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be}`;
const GRADES = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
// ส่วนของหน้า เลือกจากเมนูซ้ายผ่าน #hash
const SECTIONS = {
  start: "เริ่มต้นปีการศึกษา", years: "ปีการศึกษาและภาคเรียน", subjects: "รายวิชา", import: "นำเข้า / ส่งออกข้อมูล", courses: "ครูผู้สอน", homerooms: "ครูประจำชั้น",
  students: "นักเรียน", calendar: "ปฏิทินวันหยุด", moves: "นักเรียน", review: "ตรวจผลการเรียน", requests: "คำขอแก้ไข", bank: "คลังตัวชี้วัด", settings: "เกณฑ์และผู้ลงนาม", people: "บัญชีผู้ใช้และสิทธิ์", approve: "อนุมัติผลการเรียน", audit: "ประวัติการใช้งาน", backup: "สำรองและกู้คืนข้อมูล", system: "ตั้งค่าระบบ",
};
const allowed = Object.keys(SECTIONS).filter((k) => !(["import", "bank", "moves", "students", "calendar", "requests", "years", "people"].includes(k) && !CAN_IMPORT) && !(["approve", "audit"].includes(k) && !me.user.is_super)
  && !(["backup", "system"].includes(k) && me.user.role !== "superadmin")
  // ผู้บริหาร: ดูและตรวจสอบเท่านั้น — อนุมัติ/ส่งคืน และดูประวัติ
  && (me.user.is_admin || ["approve", "audit"].includes(k)));
let tab = hashTab(allowed, (me.role === "exec" || !allowed.includes("start")) && allowed.includes("approve") ? "approve" : "start");
document.getElementById("tabs")?.classList.add("by-menu");
if (location.hash === "#activity") location.replace("/activities.html"); // ลิงก์เก่า
window.addEventListener("hashchange", () => { tab = hashTab(allowed, allowed.includes("start") ? "start" : allowed[0]); renderTabs(); render(); });
let teachersCache;
const teachers = async () => (teachersCache ||= (await api("/api/admin/teachers")).teachers);
// ชื่อครูในตัวเลือก: ถ้ามีหลายบัญชีชื่อเดียวกัน แสดงอีเมลกำกับ จะได้ไม่มอบหมายผิดบัญชี
const sameName = (list, t) => list.filter((x) => x.full_name.trim() === t.full_name.trim()).length > 1;
const teacherLabel = (list, t) => `${esc(t.full_name)}${sameName(list, t) ? ` <span class="tag warn" data-tip="มีหลายบัญชีชื่อนี้">${esc(t.email || `บัญชี #${t.id}`)}</span>` : ""}`;
const teacherText = (list, t) => `${t.full_name}${sameName(list, t) ? ` (${t.email || `บัญชี #${t.id}`})` : ""}`;

function renderTabs() {
  document.getElementById("pageTitle").textContent = SECTIONS[tab];
  document.title = `${SECTIONS[tab]} — รายงานผลการเรียน`;
}

async function render() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  try {
    await ({ start: renderStart, subjects: renderSubjects, import: renderImport, courses: renderCourses, homerooms: renderHomerooms, moves: renderMoves, students: renderStudents, calendar: renderCalendar, review: () => renderApprove("review"), requests: renderRequests, years: renderYears, system: renderSystem, bank: renderBank, settings: renderSettings, people: renderPeople, approve: () => renderApprove("approve"), audit: renderAudit, backup: () => renderBackup(view) })[tab]();
  } catch (err) { view.innerHTML = `<div class="panel empty"><strong>โหลดข้อมูลไม่สำเร็จ</strong>${esc(err.message)}</div>`; }
}

// ---------- เริ่มต้นปี: ขั้นตอนตามลำดับ ----------
async function renderStart() {
  const [{ rooms }, { subjects }, { courses }, hr, { settings }] = await Promise.all([
    api(`/api/admin/rooms?${yq}`), api(`/api/admin/subjects?${yq}`), api(`/api/admin/courses?${yq}`), api(`/api/admin/homerooms?${yq}`),
    api(`/api/admin/settings?${yq}`),
  ]);
  const primaryRooms = rooms.filter((r) => GRADES.includes(r.grade_level));
  const pilot = settings.pilot_rooms;
  const inScope = (g, r) => !pilot || pilot.includes(`${g}/${r}`);
  const scopedCourses = courses.filter((c) => inScope(c.grade_level, c.classroom));
  const noTeacher = scopedCourses.filter((c) => !c.teachers.length).length;
  const scopedHr = hr.rooms.filter((r) => inScope(r.grade_level, r.classroom));
  const noHomeroom = scopedHr.filter((r) => !r.teachers.length).length;
  const pilotGrades = pilot ? [...new Set(pilot.map((p) => p.split("/")[0]))] : GRADES;
  const steps = [
    { done: me.setup.terms > 0, title: "ปีการศึกษาและภาคเรียน", text: me.setup.terms ? `ปีการศึกษา ${me.year.year_be} มี ${me.setup.terms} ภาคเรียน${me.year.status === "active" ? " (ปีปัจจุบัน)" : ""}` : "ยังไม่ได้ตั้งวันเปิด–ปิดภาคเรียน",
      action: `<button class="btn ${me.setup.terms ? "" : "primary"}" data-go="years">ตั้งค่าปี/ภาคเรียน</button>` },
    { done: primaryRooms.length > 0, title: "ห้องเรียนและรายชื่อนักเรียน", text: primaryRooms.length || rooms.length ? `พบ ${rooms.length} ห้อง นักเรียน ${rooms.reduce((a, r) => a + r.students, 0)} คน` : "ยังไม่มีนักเรียนในปีนี้ — นำเข้ารายชื่อจากแม่แบบ Excel หรือเลื่อนชั้นจากปีก่อน (เมนูปีการศึกษา)",
      action: `<span class="actions">${CAN_IMPORT ? `<button class="btn ${rooms.length ? "" : "primary"}" data-go="import" data-kind="students">นำเข้ารายชื่อนักเรียน</button>` : ""}</span>` },
    { done: true, title: "บัญชีครู", text: "เพิ่มบัญชีครูทีละคน หรือนำเข้าจากแม่แบบ Excel (ระบบสร้างรหัสผ่านเริ่มต้นให้)", action: `<span class="actions">${CAN_IMPORT ? '<button class="btn" data-go="import" data-kind="users">นำเข้าข้อมูลครู</button><button class="btn" data-go="people">บัญชีผู้ใช้</button>' : ""}</span>` },
    { done: true, title: "ห้องที่เปิดใช้ระบบ", text: pilot ? `นำร่องเฉพาะ <b>${pilot.map(esc).join(", ")}</b> — ห้องอื่นยังไม่ใช้ระบบ` : "เปิดใช้ทุกห้อง", action: `<button class="btn" id="pilotBtn">เลือกห้อง</button>` },
    { done: subjects.some((s) => pilotGrades.includes(s.grade_level)), title: "รายวิชาของแต่ละชั้น", text: subjects.length ? `มี ${subjects.length} รายวิชา (${[...new Set(subjects.map((s) => s.grade_level))].join(", ")})` : (CAN_IMPORT ? "นำเข้าจาก Excel, คัดลอกจากปีก่อน หรือ" : "ทีมวัดผลนำเข้าจาก Excel ได้ หรือ") + "สร้างวิชาพื้นฐานตามหลักสูตรแกนกลางฯ 2551 (เหมาะกับ ป.4–6) แล้วแก้ภายหลังได้",
      action: `<span class="actions">${CAN_IMPORT ? `<button class="btn ${subjects.length ? "" : "primary"}" data-go="import">นำเข้าจาก Excel</button>${me.years.length > 1 ? '<button class="btn" id="copyBtn">คัดลอกจากปีก่อน</button>' : ""}` : ""}<button class="btn" id="tplBtn">วิชาพื้นฐาน</button></span>` },
    { done: scopedCourses.length > 0, title: "รายวิชาของแต่ละห้อง", text: scopedCourses.length ? `มี ${scopedCourses.length} รายวิชา-ห้อง${pilot ? " ในห้องที่เปิดใช้" : ""}` : `จับคู่รายวิชากับ${pilot ? "ห้องที่เปิดใช้" : "ทุกห้องเรียนของชั้นนั้น"}`, action: `<button class="btn ${subjects.length && !scopedCourses.length ? "primary" : ""}" id="genBtn" ${subjects.length ? "" : "disabled"}>สร้าง/เติมรายวิชา${pilot ? "ห้องที่เปิดใช้" : "ทุกห้อง"}</button>` },
    { done: scopedCourses.length > 0 && noTeacher === 0, title: "มอบหมายครูผู้สอน", text: scopedCourses.length ? (noTeacher ? `ยังไม่มีครูผู้สอน ${noTeacher} รายวิชา` : "ครบทุกรายวิชา") : (CAN_IMPORT ? "ทำหลังขั้นตอนสร้างรายวิชาของแต่ละห้อง หรือนำเข้าจาก Excel ได้เลย" : "ทำหลังขั้นตอนสร้างรายวิชาของแต่ละห้อง"), action: `<span class="actions">${CAN_IMPORT ? '<button class="btn" data-go="import" data-kind="teachers">นำเข้าจาก Excel</button>' : ""}<button class="btn" data-go="courses">ไปมอบหมาย</button></span>` },
    { done: scopedHr.length > 0 && noHomeroom === 0, title: "ครูประจำชั้น", text: noHomeroom ? `ยังไม่กำหนด ${noHomeroom} ห้อง` : "ครบทุกห้อง", action: `<button class="btn" data-go="homerooms">ไปกำหนด</button>` },
    { done: true, title: "เกณฑ์การวัดผลและผู้ลงนาม", text: `เกณฑ์ผ่านตัวชี้วัด ภาค 1 ${settings.indicator_pass_pct}% · ภาค 2 ${settings.indicator_pass_pct_t2 ?? settings.indicator_pass_pct}%`, action: `<button class="btn" data-go="settings">ตรวจ/แก้</button>` },
  ];
  view.innerHTML = `<div class="panel"><ol style="margin:0;padding:0;list-style:none;display:grid;gap:4px">${steps.map((s, i) => `
    <li class="step-row">
      <span class="grade ${s.done ? "g4" : ""}" style="min-width:30px">${s.done ? "✓" : i + 1}</span>
      <span><b>${s.title}</b><br><span class="muted small">${s.text}</span></span>${s.action}</li>`).join("")}</ol></div>
    <p class="muted small" style="margin-top:12px">ทำซ้ำได้ปลอดภัย: ปุ่มสร้างจะเพิ่มเฉพาะส่วนที่ยังไม่มี ไม่ลบหรือเขียนทับของเดิม</p>`;
  document.getElementById("pilotBtn").onclick = async () => {
    const r = await dialog({
      title: "ห้องที่เปิดใช้ระบบ",
      body: `<p class="muted small" style="margin-top:0">เลือกห้องนำร่อง ปุ่มสร้างรายวิชาจะสร้างเฉพาะห้องเหล่านี้ ไม่เลือกเลย = เปิดใช้ทุกห้อง (รายวิชาที่สร้างไว้แล้วไม่ถูกลบ)</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px">${primaryRooms.map((r) => { const k = `${r.grade_level}/${r.classroom}`; return `<label class="check"><input type="checkbox" name="${esc(k)}" ${pilot?.includes(k) ? "checked" : ""}> ${esc(k)}</label>`; }).join("")}</div>`,
    });
    if (!r.ok) return;
    const chosen = primaryRooms.map((x) => `${x.grade_level}/${x.classroom}`).filter((k) => r.data[k]);
    try { await api("/api/admin/pilot", { method: "PUT", body: { year: Y, rooms: chosen } }); toast(chosen.length ? `เปิดใช้ ${chosen.join(", ")}` : "เปิดใช้ทุกห้อง"); render(); } catch (err) { showError(err); }
  };
  document.getElementById("tplBtn").onclick = async () => {
    const r = await dialog({
      title: "สร้างรายวิชาพื้นฐาน",
      body: `<p class="muted small" style="margin-top:0">สร้าง 9 รายวิชาพื้นฐานตามโครงสร้างเวลาเรียนหลักสูตรแกนกลางฯ 2551 (รหัสที่มีอยู่แล้วจะข้าม) ป.1–3 ใช้หลักสูตรใหม่ที่ชื่อวิชาต่างกัน แนะนำให้นำเข้าจาก Excel แทน</p>
        <div class="actions">${GRADES.map((g) => `<label class="check"><input type="checkbox" name="${g}" ${pilotGrades.includes(g) && Number(g.slice(-1)) >= 4 ? "checked" : ""}> ${g}</label>`).join("")}</div>`,
      okText: "สร้าง",
    });
    if (!r.ok) return;
    const grades = GRADES.filter((g) => r.data[g]);
    if (!grades.length) return;
    try { await api("/api/admin/subjects/template", { method: "POST", body: { year: Y, grades } }); toast(`สร้างรายวิชาของ ${grades.join(", ")} แล้ว — ตรวจเวลาเรียนให้ตรงหลักสูตรสถานศึกษา`); render(); } catch (err) { showError(err); }
  };
  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) copyBtn.onclick = async () => {
    const others = me.years.filter((y) => y.id !== Y);
    const r = await dialog({ title: "คัดลอกรายวิชาจากปีก่อน", body: `<label class="field">จากปีการศึกษา<select name="from">${others.map((y) => `<option value="${y.id}">${y.year_be}</option>`).join("")}</select></label><p class="muted small">เพิ่มเฉพาะรหัสวิชาที่ปีนี้ยังไม่มี ไม่คัดลอกคะแนน</p>`, okText: "คัดลอก" });
    if (!r.ok) return;
    try { const x = await api("/api/admin/subjects/copy", { method: "POST", body: { year: Y, from_year: Number(r.data.from) } }); toast(`เพิ่ม ${x.added} รายวิชา`); render(); } catch (err) { showError(err); }
  };
  document.getElementById("genBtn").onclick = async () => {
    try { const r = await api("/api/admin/courses/generate", { method: "POST", body: { year: Y } }); toast(`เพิ่ม ${r.created} รายวิชา-ห้อง`); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-go]")) b.onclick = () => {
    if (b.dataset.kind) importKind = b.dataset.kind;
    location.hash = b.dataset.go;
  };
}

// ---------- นำเข้า / ส่งออกข้อมูล (การ์ดกลาง ใช้แม่แบบเดียวกันทั้งระบบ) ----------
// ลำดับการ์ด: ข้อมูลครู → นักเรียน → รายวิชา → ครูผู้สอน → ครูประจำชั้น (ตัวชี้วัดอยู่ที่เมนูคลังตัวชี้วัด)
const IMPORT_ORDER = ["users", "students", "subjects", "teachers", "homerooms"];
let importKind = sessionStorage.getItem("sr-import-kind") || "users";
document.addEventListener("click", (e) => { const a = e.target.closest?.("[data-kind-link]"); if (a) { importKind = a.dataset.kindLink; sessionStorage.setItem("sr-import-kind", importKind); } });

async function renderImport() {
  if (!IMPORT_ORDER.includes(importKind)) importKind = "users";
  const DESC = {
    users: "บัญชีเข้าใช้ระบบของครูและบุคลากร", students: "รายชื่อ ห้อง และข้อมูลนักเรียน", subjects: "รายวิชาของแต่ละชั้น",
    teachers: "จับคู่ครูกับรายวิชาในแต่ละห้อง", homerooms: "ครูประจำชั้นของแต่ละห้อง",
  };
  view.innerHTML = `<div class="actions" style="margin-bottom:6px;flex-wrap:wrap">${IMPORT_ORDER.map((k) => `<button type="button" class="btn small ${k === importKind ? "primary" : ""}" data-kind="${k}">${esc(IMPORT_KINDS[k].title)}</button>`).join("")}</div>
    <p class="muted small" style="margin:0 0 12px">${DESC[importKind]} — ดาวน์โหลดแม่แบบกลาง กรอกใน Excel/Google Sheets แล้วนำเข้า หรือส่งออกข้อมูลปัจจุบันไปแก้แล้วนำเข้ากลับ · ตัวชี้วัดนำเข้าที่เมนู <a href="/admin.html#bank">คลังตัวชี้วัด</a></p>
    <div id="importCard"></div>`;
  for (const b of view.querySelectorAll("[data-kind]")) b.onclick = () => { importKind = b.dataset.kind; sessionStorage.setItem("sr-import-kind", importKind); render(); };
  importCard(document.getElementById("importCard"), importKind);
}

// การ์ดนำเข้า/ส่งออกของข้อมูลชนิดหนึ่ง: แม่แบบกลาง · ส่งออกข้อมูลปัจจุบัน · วาง/เลือกไฟล์ → ตรวจ → บันทึก
function importCard(host, kind, { onDone } = {}) {
  const spec = IMPORT_KINDS[kind];
  const main = spec.columns.filter((c) => !c.extra), extra = spec.columns.filter((c) => c.extra);
  host.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>${esc(spec.title)}</h2>
      <div class="actions"><button class="btn" data-dl="template">ดาวน์โหลดแม่แบบ</button><button class="btn" data-dl="export">ส่งออกข้อมูลปัจจุบัน</button></div></div>
    <p class="small" style="margin:0 0 6px"><b>คอลัมน์:</b> ${main.map((c) => `<span class="tag">${c.label}${c.optional ? " (ไม่บังคับ)" : ""}</span>`).join(" ")}
      ${extra.length ? `<br><span class="muted">คอลัมน์เพิ่มเติม (ไม่บังคับ): ${extra.map((c) => esc(c.label)).join(" · ")}</span>` : ""}</p>
    <p class="muted small" style="margin-top:0">${spec.note}</p>
    <label class="field">คัดลอกตารางจาก Excel / Google Sheets มาวางที่นี่ (มีแถวหัวตารางตามแม่แบบ หรือเรียงคอลัมน์ตามแม่แบบ)
      <textarea data-paste rows="8" style="font-family:ui-monospace,monospace;font-size:13px" placeholder="${main.map((c) => c.label).join("\t")}"></textarea></label>
    <div class="actions" style="margin-top:10px"><label class="btn">เลือกไฟล์ Excel / CSV<input type="file" data-file accept=".xlsx,.xls,.csv" hidden></label>
      <button class="btn primary" data-check>ตรวจข้อมูล</button><span class="muted small" data-info></span></div>
    <div data-result style="margin-top:14px"></div></div>`;
  const $ = (sel) => host.querySelector(sel);
  const box = $("[data-paste]"), info = $("[data-info]"), out = $("[data-result]");
  const current = () => gridToRows(kind, parseGrid(box.value));
  box.oninput = () => { const { rows, header } = current(); info.textContent = rows.length ? `${rows.length} แถว${header ? " (พบแถวหัวตาราง)" : ""}` : ""; out.innerHTML = ""; };
  $("[data-file]").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      if (/\.csv$/i.test(f.name)) box.value = await f.text();
      else {
        const XLSX = await loadXlsx();
        // วันที่ในเซลล์ Excel → ปปปป-ดด-วว · ตัวเลขยาว (เลขบัตรประชาชน) ไม่กลายเป็น 1.23E+12
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true, dateNF: "yyyy-mm-dd" });
        box.value = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t", blankrows: false, rawNumbers: true, dateNF: "yyyy-mm-dd" });
      }
      box.oninput();
    } catch (err) { showError(err); }
    e.target.value = "";
  };
  for (const b of host.querySelectorAll("[data-dl]")) b.onclick = async () => {
    b.disabled = true;
    try { await downloadKind(kind, b.dataset.dl === "export"); } catch (err) { showError(err); } finally { b.disabled = false; }
  };
  const url = spec.endpoint ? `${spec.endpoint}?${yq}` : `/api/admin/import/${kind}`;
  // ส่งเป็นชุด (คลังตัวชี้วัดรับครั้งละไม่เกิน 3000 แถว)
  const send = async (rows, dry) => {
    const size = spec.chunk || rows.length || 1;
    const merged = { errors: [], summary: { add: 0, update: 0, skip: 0 }, created: [], appended: 0 };
    for (let i = 0; i < rows.length; i += size) {
      const r = await api(url, { method: "POST", body: { year: Y, rows: rows.slice(i, i + size), dry_run: dry } });
      for (const e of r.errors || []) merged.errors.push({ ...e, row: e.row + i });
      const sm = r.summary || { add: r.add ?? r.added ?? 0, update: 0, skip: r.skip ?? r.skipped ?? 0 };
      merged.summary.add += sm.add || 0; merged.summary.update += sm.update || 0; merged.summary.skip += sm.skip || 0;
      merged.created.push(...(r.created || []));
      merged.appended += r.appended || 0;
    }
    return merged;
  };
  $("[data-check]").onclick = async () => {
    const { rows } = current();
    if (!rows.length) { toast("ยังไม่มีข้อมูล — วางตารางจาก Excel หรือเลือกไฟล์ก่อน", "bad"); return; }
    let r;
    out.innerHTML = `<p class="muted small">กำลังตรวจ…</p>`;
    try { r = await send(rows, true); } catch (err) { out.innerHTML = ""; showError(err); return; }
    const cols = spec.columns.filter((c) => !c.optional || rows.some((x) => x[c.key]));
    const errAt = Object.fromEntries(r.errors.map((e) => [e.row, e.error]));
    const sm = r.summary;
    const shown = rows.length > 500 && !r.errors.length ? rows.slice(0, 200) : rows;
    out.innerHTML = `${r.errors.length ? `<p class="note bad">พบข้อผิดพลาด ${r.errors.length} แถว — แก้ในไฟล์แล้ววางใหม่ (ยังไม่บันทึกอะไร)</p>`
        : `<p class="note">ข้อมูลถูกต้อง ${rows.length} แถว · เพิ่มใหม่ ${sm.add}${sm.update ? ` · แก้ของเดิม ${sm.update}` : ""}${sm.skip ? ` · มีอยู่แล้ว (ข้าม) ${sm.skip}` : ""}</p>`}
      <div class="table-wrap" style="max-height:420px;margin-top:10px"><table class="list"><thead><tr><th>แถว</th>${cols.map((c) => `<th>${c.label}</th>`).join("")}<th>ผลตรวจ</th></tr></thead>
      <tbody>${shown.map((x, i) => `<tr${errAt[i + 1] ? ' style="background:var(--bad-bg)"' : ""}><td class="num">${i + 1}</td>${cols.map((c) => `<td>${esc(c.key === "password" && x[c.key] ? "••••••" : x[c.key])}</td>`).join("")}
        <td class="small">${errAt[i + 1] ? `<span style="color:var(--bad)">${esc(errAt[i + 1])}</span>` : '<span class="tag ok">ถูกต้อง</span>'}</td></tr>`).join("")}</tbody></table></div>
      ${shown.length < rows.length ? `<p class="muted small">แสดง ${shown.length} แถวแรกจาก ${rows.length} แถว</p>` : ""}
      ${r.errors.length ? "" : `<div class="actions" style="margin-top:12px"><button class="btn primary" data-save>บันทึก ${rows.length} แถว</button></div>`}`;
    const save = out.querySelector("[data-save]");
    if (save) save.onclick = async () => {
      save.disabled = true; save.textContent = "กำลังบันทึก…";
      try {
        const res = await send(rows, false); toast(`นำเข้า${spec.title}แล้ว`); teachersCache = null; box.value = ""; info.textContent = "";
        out.innerHTML = `<p class="note">บันทึกแล้ว ${rows.length} แถว${res.summary.skip ? ` (ข้ามที่มีอยู่แล้ว ${res.summary.skip})` : ""}${res.appended ? ` · เปิดภาคเรียนแล้ว นักเรียนที่เพิ่ม/ย้ายเข้าห้อง ${res.appended} คนได้เลขที่ต่อท้ายห้อง (เลขที่ของคนเดิมไม่เลื่อน — แก้เลขที่ได้ที่เมนูนักเรียน)` : ""}</p>`;
        if (res.created.length) showCreated(out, res.created);
        onDone?.();
      } catch (err) { save.disabled = false; save.textContent = `บันทึก ${rows.length} แถว`; showError(err); }
    };
  };
}

// บัญชีที่สร้างใหม่: แสดงรหัสผ่านเริ่มต้นครั้งเดียว + ดาวน์โหลดเป็นไฟล์แจกครู
function showCreated(out, created) {
  out.insertAdjacentHTML("beforeend", `<div class="panel" style="margin-top:12px;border-color:var(--warn, #d97706)">
    <div class="panel-head"><h3 style="margin:0">บัญชีใหม่ ${created.length} บัญชี — รหัสผ่านเริ่มต้น (แสดงครั้งเดียว)</h3><button class="btn small primary" data-cred>ดาวน์โหลดรายชื่อและรหัสผ่าน</button></div>
    <p class="muted small">แจ้งครูแต่ละคน เมื่อเข้าสู่ระบบครั้งแรกระบบจะให้เปลี่ยนรหัสผ่าน · ปิดหน้านี้แล้วจะดูรหัสอีกไม่ได้ (ตั้งใหม่ได้ที่เมนูบัญชีผู้ใช้)</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>ชื่อ-สกุล</th><th>อีเมล/ชื่อผู้ใช้</th><th>รหัสผ่านเริ่มต้น</th></tr></thead>
    <tbody>${created.map((c) => `<tr><td>${esc(c.full_name)}</td><td>${esc(c.email)}</td><td><code>${esc(c.password)}</code></td></tr>`).join("")}</tbody></table></div></div>`);
  out.querySelector("[data-cred]").onclick = () => writeXlsx(`บัญชีครู-รหัสผ่านเริ่มต้น`, "บัญชีใหม่", ["ชื่อ-สกุล", "อีเมล/ชื่อผู้ใช้", "รหัสผ่านเริ่มต้น"], created.map((c) => [c.full_name, c.email, c.password])).catch(showError);
}

async function writeXlsx(fileName, sheetTitle, head, rows) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows.map((r) => r.map((v) => (v == null ? "" : typeof v === "number" ? v : String(v))))]);
  ws["!cols"] = head.map((h, i) => ({ wch: Math.min(60, Math.max(10, h.length + 4, ...rows.slice(0, 300).map((r) => String(r[i] ?? "").length + 2))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle.slice(0, 31));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

// แม่แบบกลาง (หัวคอลัมน์ + แถวตัวอย่าง) หรือส่งออกข้อมูลปัจจุบันในรูปแบบเดียวกับแม่แบบ — นำกลับเข้าได้ทันที
async function downloadKind(kind, withData) {
  const spec = IMPORT_KINDS[kind];
  const cols = spec.columns;
  const head = cols.map((c) => c.label);
  const pick = (objs) => objs.map((o) => cols.map((c) => o[c.key] ?? ""));
  let rows = [], extraHead = [], extraOf = () => [];
  const SAMPLE = {
    users: [{ email: "somchai", full_name: "นายสมชาย ใจดี", position: "ครู", role: "ครู", team: "", password: "" },
      { email: "somsri@gmail.com", full_name: "นางสมศรี รักเรียน", position: "ครูชำนาญการ", role: "ครู", team: "ใช่", password: "" }],
    students: [{ student_code: "10101", name_prefix: "เด็กหญิง", first_name: "ตัวอย่าง", last_name: "นามสกุลตัวอย่าง", gender: "ญ", national_id: "1234567890123", birth_date: "31/05/2562", room: "ป.1/1",
      nationality: "ไทย", religion: "พุทธ", guardian_prefix: "นาง", guardian_first_name: "ผู้ปกครอง", guardian_last_name: "นามสกุลตัวอย่าง", guardian_relationship: "มารดา", guardian_phone: "0812345678", province: "ราชบุรี" }],
    subjects: [{ grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: 160, collect_ratio: 70 }],
    teachers: [{ room: "ป.4/1", code: "ท14101", name: "ภาษาไทย", teachers: "นายสมชาย ใจดี" }],
    homerooms: [{ room: "ป.4/1", teachers: "นายสมชาย ใจดี, นางสมศรี รักเรียน" }],
    bank: [{ grade_level: "ป.4", learning_area: "ภาษาไทย", subject_code: "", kind: "ระหว่างทาง", code: "ท 1.1 ป.4/1", title: "อ่านออกเสียงบทร้อยแก้วและบทร้อยกรองได้ถูกต้อง" }],
  };
  if (!withData) rows = pick(SAMPLE[kind]);
  else if (kind === "users") {
    const r = await api("/api/users/export");
    rows = pick(r.rows); extraHead = ["สถานะ"]; extraOf = (i) => [r.rows[i].status];
  } else if (kind === "students") {
    const r = await api(`/api/roster/export?${yq}`);
    rows = pick(r.students); extraHead = ["เลขที่", "สถานะ"]; extraOf = (i) => [r.students[i].number, r.students[i].status];
  } else if (kind === "bank") {
    rows = pick((await api("/api/admin/indicator-bank/export")).rows);
  } else if (kind === "subjects") {
    const { subjects } = await api(`/api/admin/subjects?${yq}`);
    rows = subjects.map((s) => [s.grade_level, s.code, s.name, s.learning_area, s.subject_type === "additional" ? "เพิ่มเติม" : "พื้นฐาน", s.hours_per_year, s.collect_ratio]);
  } else if (kind === "teachers") {
    const [{ courses }, { settings }] = await Promise.all([api(`/api/admin/courses?${yq}`), api(`/api/admin/settings?${yq}`)]);
    rows = courses.filter((c) => !settings.pilot_rooms || settings.pilot_rooms.includes(`${c.grade_level}/${c.classroom}`))
      .map((c) => [`${c.grade_level}/${c.classroom}`, c.code, c.name, c.teachers.map((t) => t.full_name).join(", ")]);
  } else {
    const [{ rooms }, { settings }] = await Promise.all([api(`/api/admin/homerooms?${yq}`), api(`/api/admin/settings?${yq}`)]);
    rows = rooms.filter((r) => !settings.pilot_rooms || settings.pilot_rooms.includes(`${r.grade_level}/${r.classroom}`))
      .map((r) => [`${r.grade_level}/${r.classroom}`, r.teachers.map((t) => t.full_name).join(", ")]);
  }
  if (withData && !rows.length) { toast("ยังไม่มีข้อมูลให้ส่งออก — ดาวน์โหลดแม่แบบแทน", "bad"); return; }
  if (extraHead.length) rows = rows.map((r, i) => [...r, ...extraOf(i)]);
  const tag = ["users", "bank"].includes(kind) ? "" : `-${me.year.year_be}`;
  await writeXlsx(`${withData ? "ข้อมูล" : "แม่แบบ"}-${spec.title}${tag}`, spec.title, [...head, ...extraHead], rows);
}

// ---------- รายวิชา ----------
// สัดส่วนคะแนนระหว่างภาค:ปลายภาค ตั้งแยกรายวิชา (เช่น วิชาปฏิบัติ 80:20) — แต่ละภาคเต็ม 50
const RATIOS = [50, 60, 70, 75, 80, 90, 100];
const perTerm = (r) => `ภาคละ ${String(r / 2).replace(/\.0$/, "")} + ${String(50 - r / 2).replace(/\.0$/, "")}`;
const ratioOptions = (cur) => [...new Set([...RATIOS, Number(cur)])].sort((a, b) => a - b)
  .map((r) => `<option value="${r}" ${r === Number(cur) ? "selected" : ""}>${r}:${100 - r}${r === 100 ? " (ไม่มีสอบปลายภาค)" : ""}</option>`).join("");
async function renderSubjects() {
  const [{ subjects, learning_areas }, { settings: st }] = await Promise.all([api(`/api/admin/subjects?${yq}`), api(`/api/admin/settings?${yq}`)]);
  const defaultRatio = st.collect_ratio;
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>รายวิชาปีการศึกษา ${me.year.year_be}</h2><button class="btn primary" id="addSub">เพิ่มรายวิชา</button></div>
    <p class="muted small" style="margin-top:0">สัดส่วนคะแนนตั้งแยกรายวิชาได้ เช่น วิชาภาคปฏิบัติ 80:20 = แต่ละภาค ระหว่างภาค 40 + ปลายภาค 10 · เปลี่ยนแล้วครูต้องปรับคะแนนเต็มในโครงสร้างให้ตรงสัดส่วนใหม่ก่อนส่งผล</p>
    ${GRADES.map((g) => { const list = subjects.filter((s) => s.grade_level === g); return list.length ? `
      <h3 style="margin-top:18px">${g}</h3>
      <div class="table-wrap"><table class="list"><thead><tr><th>รหัส</th><th>ชื่อวิชา</th><th>กลุ่มสาระ</th><th>ประเภท</th><th class="num">ชม./ปี</th><th>ระหว่างภาค : ปลายภาค</th><th class="num">ห้อง</th><th></th></tr></thead>
      <tbody>${list.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td class="small">${esc(s.learning_area)}</td><td>${s.subject_type === "basic" ? "พื้นฐาน" : "เพิ่มเติม"}</td>
        <td class="num">${s.hours_per_year}</td>
        <td><select class="ratio-sel" data-ratio="${s.id}" aria-label="สัดส่วนคะแนน ${esc(s.code)}" ${s.locked_count ? 'disabled title="มีห้องที่ส่งผลแล้ว ส่งคืนก่อนจึงเปลี่ยนได้"' : ""}>${ratioOptions(s.collect_ratio)}</select>
          <span class="small muted">${perTerm(s.collect_ratio)}</span></td><td class="num">${s.course_count}</td>
        <td class="actions"><button class="btn small" data-edit="${s.id}">แก้ไข</button><button class="btn small danger" data-del="${s.id}">ลบ</button></td></tr>`).join("")}</tbody></table></div>` : ""; }).join("") || `<div class="empty"><strong>ยังไม่มีรายวิชา</strong>เริ่มจากเมนู "เริ่มต้นปีการศึกษา" หรือกดเพิ่มรายวิชา</div>`}
  </div>`;
  const form = (s = {}) => `<div class="form-grid">
    <label class="field">ระดับชั้น<select name="grade_level">${GRADES.map((g) => `<option ${s.grade_level === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
    <label class="field">รหัสวิชา<input name="code" required maxlength="20" value="${esc(s.code || "")}" placeholder="ท11101"></label>
    <label class="field">ประเภท<select name="subject_type"><option value="basic" ${s.subject_type !== "additional" ? "selected" : ""}>พื้นฐาน</option><option value="additional" ${s.subject_type === "additional" ? "selected" : ""}>เพิ่มเติม</option></select></label>
  </div>
  <label class="field" style="margin-top:12px">ชื่อวิชา<input name="name" required maxlength="120" value="${esc(s.name || "")}"></label>
  <div class="form-grid" style="margin-top:12px">
    <label class="field">กลุ่มสาระ<select name="learning_area">${[...learning_areas, "อื่น ๆ"].map((a) => `<option ${s.learning_area === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    <label class="field">เวลาเรียน (ชม./ปี)<input name="hours_per_year" inputmode="numeric" required value="${s.hours_per_year ?? 40}"></label>
    <label class="field">ระหว่างภาค : ปลายภาค<select name="collect_ratio">${ratioOptions(s.collect_ratio ?? defaultRatio)}</select></label>
    <label class="field">ลำดับในรายงาน<input name="sort_order" inputmode="numeric" value="${s.sort_order ?? ""}" placeholder="ว่าง = ต่อท้ายวิชาของชั้นนี้"></label>
  </div>
  ${s.id && s.course_count ? '<p class="note warn" style="margin-top:12px">แก้สัดส่วนหรือเวลาเรียนแล้ว ผลการเรียนของทุกห้องจะคำนวณใหม่ตามค่าใหม่ทันที</p>' : ""}`;
  document.getElementById("addSub").onclick = async () => {
    const r = await dialog({ title: "เพิ่มรายวิชา", body: form(), okText: "เพิ่ม" });
    if (!r.ok) return;
    try { await api("/api/admin/subjects", { method: "POST", body: { ...r.data, year: Y } }); toast("เพิ่มรายวิชาแล้ว — ทุกห้องของชั้นนี้มีวิชานี้แล้ว มอบหมายครูได้ที่เมนูครูผู้สอน"); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-edit]")) b.onclick = async () => {
    const s = subjects.find((x) => x.id === Number(b.dataset.edit));
    const r = await dialog({ title: `แก้ไข ${s.code}`, body: form(s) });
    if (!r.ok) return;
    try { await api(`/api/admin/subjects/${s.id}`, { method: "PUT", body: r.data }); toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
  for (const sel of view.querySelectorAll("[data-ratio]")) sel.onchange = async () => {
    const s = subjects.find((x) => x.id === Number(sel.dataset.ratio));
    const r = Number(sel.value);
    const warn = s.structured_count ? `<br><br><b>${s.structured_count} ห้องตั้งโครงสร้างคะแนนไว้แล้ว</b> ครูต้องปรับคะแนนเต็มให้เป็น${perTerm(r)}ก่อนจึงส่งผลได้ (ระบบไม่ย่อขยายคะแนนให้)` : "";
    if (!(await confirmBox("เปลี่ยนสัดส่วนคะแนน", `${esc(s.code)} ${esc(s.name)} ${esc(s.grade_level)}: ${s.collect_ratio}:${100 - s.collect_ratio} → <b>${r}:${100 - r}</b> (${perTerm(r)})${warn}`, "เปลี่ยน"))) { sel.value = s.collect_ratio; return; }
    try {
      await api(`/api/admin/subjects/${s.id}`, { method: "PUT", body: { grade_level: s.grade_level, code: s.code, name: s.name, learning_area: s.learning_area, subject_type: s.subject_type, hours_per_year: s.hours_per_year, collect_ratio: r, sort_order: s.sort_order } });
      toast(`ตั้ง ${s.code} เป็น ${r}:${100 - r} แล้ว`); render();
    } catch (err) { sel.value = s.collect_ratio; showError(err); }
  };
  for (const b of view.querySelectorAll("[data-del]")) b.onclick = async () => {
    const s = subjects.find((x) => x.id === Number(b.dataset.del));
    if (!(await confirmBox("ลบรายวิชา", `ลบ ${esc(s.code)} ${esc(s.name)} ของ ${esc(s.grade_level)} และรายวิชาของทุกห้อง (ลบได้เฉพาะเมื่อยังไม่มีคะแนน)`, "ลบ", true))) return;
    try { await api(`/api/admin/subjects/${s.id}`, { method: "DELETE" }); toast("ลบแล้ว"); render(); } catch (err) { showError(err); }
  };
}

const statusTag = (c) => (c.status === "approved" ? '<span class="tag ok">อนุมัติแล้ว</span>'
  : c.status === "reviewed" ? '<span class="tag">ตรวจแล้ว รอผู้บริหาร</span>'
  : c.status === "submitted" ? '<span class="tag">ส่งแล้ว รอตรวจ</span>'
  : c.return_note ? `<span class="tag warn" title="${esc(c.return_note)}">ส่งคืนให้แก้</span>`
  : c.item_count ? '<span class="tag">กำลังกรอก</span>' : '<span class="tag warn">ยังไม่ตั้งโครงสร้าง</span>')
  + (c.edit_count ? ` <span class="tag warn" title="ฝ่ายวัดผลแก้ไขหลังส่ง ${c.edit_count} ครั้ง">แก้ ${c.edit_count}</span>` : "");

// ---------- ครูผู้สอน ----------
let selRoom = sessionStorage.getItem("sr-admin-room") || "";
let teachView = sessionStorage.getItem("sr-admin-teachview") || "room"; // room = รายห้อง · teacher = รายครู
const perWeek = (hours) => Number((Math.trunc(Number(((Number(hours) || 0) / 40 * 10).toPrecision(12))) / 10).toPrecision(12)); // ไม่ปัด // ชั่วโมง/ปี ÷ 40 สัปดาห์ = คาบ/สัปดาห์
const pendingTag = (t) => (t.pending ? ' <span class="tag warn" data-tip="เพิ่งสมัคร — มอบหมายวิชาแล้วจะได้สิทธิ์ครูอัตโนมัติ">สมัครใหม่</span>' : "");
async function renderCourses() {
  const [{ courses }, list] = await Promise.all([api(`/api/admin/courses?${yq}`), teachers()]);
  const rooms = [...new Set(courses.map((c) => `${c.grade_level}/${c.classroom}`))];
  if (!rooms.length) { view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีรายวิชาของห้องเรียน</strong>ทำขั้นตอนในเมนู "เริ่มต้นปีการศึกษา" ก่อน</div>`; return; }
  if (!rooms.includes(selRoom)) selRoom = rooms[0];
  const viewSwitch = `<div class="log-forms" role="tablist" aria-label="มุมมอง" style="margin-bottom:14px">
    <button role="tab" data-view="room" aria-selected="${teachView === "room"}">รายห้อง</button>
    <button role="tab" data-view="teacher" aria-selected="${teachView === "teacher"}">รายครู</button></div>
    <p class="muted small" style="margin:-4px 0 12px">ข้อมูลวิชาที่ครูแต่ละคนสอน (กำหนดที่หน้านี้ที่เดียว) เป็นข้อมูลกลาง</p>`;
  if (teachView === "teacher") return renderTeacherLoad(courses, list, viewSwitch);
  const inRoom = courses.filter((c) => `${c.grade_level}/${c.classroom}` === selRoom);
  const missing = (r) => courses.filter((c) => `${c.grade_level}/${c.classroom}` === r && !c.teachers.length).length;
  view.innerHTML = `${viewSwitch}<div class="panel">
    <div class="panel-head"><div class="actions">${rooms.map((r) => `<button class="btn small ${r === selRoom ? "primary" : ""}" data-room="${r}">${r}${missing(r) ? ` <span class="tag warn">${missing(r)}</span>` : ""}</button>`).join("")}</div></div>
    <div class="actions" style="margin-bottom:12px"><button class="btn" id="assignAll">ให้ครู 1 คนสอนหลายวิชาในห้อง ${selRoom}</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>รหัส</th><th>วิชา</th><th>ครูผู้สอน</th><th>ความคืบหน้า</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${inRoom.map((c) => `<tr><td>${esc(c.code)}</td><td><a href="/course.html?id=${c.id}&year=${Y}">${esc(c.name)}</a></td>
      <td>${c.teachers.length ? c.teachers.map((t) => teacherLabel(list, list.find((x) => x.id === t.id) || t)).join(", ") : '<span class="tag warn">ยังไม่กำหนด</span>'}</td>
      <td style="min-width:120px"><span class="small muted">${c.progress}%</span><div class="meter ${c.progress >= 100 ? "done" : ""}"><i style="width:${c.progress}%"></i></div></td>
      <td>${statusTag(c)}</td>
      <td class="actions"><button class="btn small" data-teach="${c.id}">ครูผู้สอน</button></td></tr>`).join("")}</tbody></table></div>
    <p class="muted small" style="margin-top:10px">ตรวจผล ส่งคืนให้ครูแก้ และส่งต่อผู้บริหาร ทำที่เมนู <a href="/admin.html#review">ตรวจผลการเรียน</a></p></div>`;
  for (const b of view.querySelectorAll("[data-room]")) b.onclick = () => { selRoom = b.dataset.room; sessionStorage.setItem("sr-admin-room", selRoom); render(); };
  bindViewSwitch();
  const teacherChecks = (chosen) => `<input type="search" placeholder="ค้นหาชื่อครู" data-filter style="margin-bottom:10px">
    <div style="display:grid;gap:4px;max-height:340px;overflow:auto">${list.map((t) => `<label class="check" data-name="${esc(teacherText(list, t))}"><input type="checkbox" name="t${t.id}" ${chosen.includes(t.id) ? "checked" : ""}> ${teacherLabel(list, t)}${pendingTag(t)}</label>`).join("")}</div>`;
  const bindFilter = (d) => { const f = d.querySelector("[data-filter]"); f.oninput = () => { for (const l of d.querySelectorAll("[data-name]")) l.hidden = !l.dataset.name.includes(f.value.trim()); }; };
  for (const b of view.querySelectorAll("[data-teach]")) b.onclick = async () => {
    const c = inRoom.find((x) => x.id === Number(b.dataset.teach));
    const r = await dialog({ title: `ครูผู้สอน ${c.code} ${c.grade_level}/${c.classroom}`, body: teacherChecks(c.teachers.map((t) => t.id)), onOpen: bindFilter });
    if (!r.ok) return;
    const ids = list.filter((t) => r.data[`t${t.id}`]).map((t) => t.id);
    try { await api(`/api/admin/courses/${c.id}/teachers`, { method: "PUT", body: { user_ids: ids } }); teachersCache = null; toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
  document.getElementById("assignAll").onclick = async () => {
    const r = await dialog({
      title: `มอบหมายหลายวิชาในห้อง ${selRoom}`,
      body: `<label class="field">ครูผู้สอน<select name="user_id" required><option value="">เลือกครู</option>${list.map((t) => `<option value="${t.id}">${esc(teacherText(list, t))}${t.pending ? " (สมัครใหม่)" : ""}</option>`).join("")}</select></label>
        <p class="muted small" style="margin:12px 0 6px">วิชาที่ให้สอน (เพิ่มเป็นครูผู้สอนร่วม ไม่ลบครูเดิม)</p>
        <div style="display:grid;gap:4px">${inRoom.map((c) => `<label class="check"><input type="checkbox" name="c${c.id}" ${c.teachers.length ? "" : "checked"}> ${esc(c.code)} ${esc(c.name)}</label>`).join("")}</div>`,
    });
    if (!r.ok || !r.data.user_id) return;
    const ids = inRoom.filter((c) => r.data[`c${c.id}`]).map((c) => c.id);
    try { await api("/api/admin/courses/assign-room", { method: "POST", body: { user_id: Number(r.data.user_id), course_ids: ids } }); toast(`มอบหมาย ${ids.length} วิชาแล้ว`); render(); } catch (err) { showError(err); }
  };
}

// ---------- ครูประจำชั้น ----------
function bindViewSwitch() {
  for (const b of view.querySelectorAll("[data-view]")) b.onclick = () => { teachView = b.dataset.view; sessionStorage.setItem("sr-admin-teachview", teachView); render(); };
}

// มุมมองรายครู: ครู → วิชาที่สอน (ห้อง, คาบ/สัปดาห์) · ครูที่ยังไม่มีวิชา (รวมครูที่เพิ่งสมัคร) อยู่บนสุด
function renderTeacherLoad(courses, list, viewSwitch) {
  const byTeacher = new Map();
  for (const c of courses) for (const t of c.teachers) (byTeacher.get(t.id) || byTeacher.set(t.id, []).get(t.id)).push(c);
  const people = list.filter((t) => byTeacher.has(t.id) || t.pending || t.role === "teacher");
  const none = people.filter((t) => !byTeacher.has(t.id));
  const some = people.filter((t) => byTeacher.has(t.id));
  const unassigned = courses.filter((c) => !c.teachers.length).length;
  const load = (t) => (byTeacher.get(t.id) || []).reduce((a, c) => a + perWeek(c.hours_per_year), 0);
  const row = (t) => {
    const cs = byTeacher.get(t.id) || []; // ตามลำดับรายวิชาจากเซิร์ฟเวอร์: ชั้น → ห้อง (1, 2, …, 10) → พื้นฐาน/เพิ่มเติม → ลำดับในรายงาน
    return `<tr><td><b>${esc(t.full_name)}</b>${pendingTag(t)}<br><span class="muted small">${esc(t.email || "")}</span></td>
      <td>${cs.length ? cs.map((c) => `<span class="chip-use" style="display:inline-block;border:1px solid var(--line);border-radius:999px;margin:2px">${esc(c.grade_level)}/${esc(c.classroom)} ${esc(c.code)} ${esc(c.name)}</span>`).join("") : '<span class="tag warn">ยังไม่มีวิชาสอน</span>'}</td>
      <td class="num">${cs.length || ""}</td><td class="num">${cs.length ? fmtNum(load(t)) : ""}</td>
      <td class="actions"><button class="btn small" data-tload="${t.id}">กำหนดวิชา</button></td></tr>`;
  };
  view.innerHTML = `${viewSwitch}<div class="panel">
    <div class="panel-head"><h2>ภาระสอนรายครู</h2><span class="muted small">${some.length} คนมีวิชาสอน · ยังไม่มีวิชา ${none.length} คน${unassigned ? ` · รายวิชาที่ยังไม่มีครู ${unassigned} วิชา` : ""}</span></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ครู</th><th>วิชาที่สอน (ชั้น/ห้อง รหัส ชื่อวิชา)</th><th class="num">วิชา</th><th class="num" data-tip="ชั่วโมงต่อปี ÷ 40 สัปดาห์">คาบ/สัปดาห์</th><th></th></tr></thead>
    <tbody>${[...none, ...some].map(row).join("") || '<tr><td colspan="5" class="empty">ยังไม่มีบัญชีครู</td></tr>'}</tbody></table></div>
    <p class="muted small" style="margin-top:10px">ครูสมัครเข้าใช้ระบบเอง หรือฝ่ายวัดผลนำเข้าบัญชีครูจากแม่แบบ → กำหนดวิชาที่สอนที่นี่ (ครูที่เพิ่งสมัครได้สิทธิ์ครูอัตโนมัติเมื่อได้รับวิชา)</p></div>`;
  bindViewSwitch();
  for (const b of view.querySelectorAll("[data-tload]")) b.onclick = async () => {
    const t = list.find((x) => x.id === Number(b.dataset.tload));
    const mine = new Set((byTeacher.get(t.id) || []).map((c) => c.id));
    const rooms = [...new Set(courses.map((c) => `${c.grade_level}/${c.classroom}`))];
    const r = await dialog({
      title: `วิชาที่ ${t.full_name} สอน`, wide: true,
      body: `<input type="search" placeholder="ค้นหา ชั้น/ห้อง รหัส หรือชื่อวิชา" data-filter style="margin-bottom:10px">
        <div style="display:grid;gap:10px;max-height:420px;overflow:auto">${rooms.map((room) => `<div data-group><b class="small">${esc(room)}</b>
          <div style="display:grid;gap:2px;margin-top:4px">${courses.filter((c) => `${c.grade_level}/${c.classroom}` === room).map((c) => `<label class="check" data-name="${esc(`${room} ${c.code} ${c.name}`)}">
            <input type="checkbox" name="c${c.id}" ${mine.has(c.id) ? "checked" : ""}> ${esc(c.code)} ${esc(c.name)}
            <span class="muted small">${c.teachers.filter((x) => x.id !== t.id).map((x) => esc(x.full_name)).join(", ") || ""}</span></label>`).join("")}</div></div>`).join("")}</div>
        <p class="muted small">ติ๊ก = ครูคนนี้สอนวิชานั้น (สอนร่วมกับครูคนอื่นได้) · เอาติ๊กออก = ไม่ได้สอนแล้ว</p>`,
      onOpen: (d) => { const f = d.querySelector("[data-filter]"); f.oninput = () => { for (const l of d.querySelectorAll("[data-name]")) l.hidden = !l.dataset.name.includes(f.value.trim()); for (const g of d.querySelectorAll("[data-group]")) g.hidden = ![...g.querySelectorAll("[data-name]")].some((l) => !l.hidden); }; },
    });
    if (!r.ok) return;
    const want = new Set(courses.filter((c) => r.data[`c${c.id}`]).map((c) => c.id));
    const changed = courses.filter((c) => want.has(c.id) !== mine.has(c.id));
    try {
      for (const c of changed) {
        const ids = c.teachers.map((x) => x.id).filter((id) => id !== t.id);
        if (want.has(c.id)) ids.push(t.id);
        await api(`/api/admin/courses/${c.id}/teachers`, { method: "PUT", body: { user_ids: ids } });
      }
      teachersCache = null;
      toast(changed.length ? `บันทึก ${changed.length} วิชาแล้ว` : "ไม่มีการเปลี่ยนแปลง"); render();
    } catch (err) { showError(err); render(); }
  };
}
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Number((Math.trunc(Number((n * 10).toPrecision(12))) / 10).toPrecision(12)))); // ไม่ปัด

async function renderHomerooms() {
  const [{ rooms }, list] = await Promise.all([api(`/api/admin/homerooms?${yq}`), teachers()]);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>ครูประจำชั้น</h2></div>
    <p class="muted small">กำหนดที่นี่ (หรือนำเข้าจาก Excel) ห้องละ 1–4 คน</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>ห้อง</th><th class="num">นักเรียน</th><th>ครูประจำชั้น</th><th></th></tr></thead>
    <tbody>${rooms.map((r, i) => `<tr><td><a href="/homeroom.html?grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}&year=${Y}">${esc(r.grade_level)}/${esc(r.classroom)}</a></td><td class="num">${r.students}</td>
      <td>${r.teachers.length ? r.teachers.map((t) => teacherLabel(list, list.find((x) => x.id === t.id) || t)).join(", ") : '<span class="tag warn">ยังไม่กำหนด</span>'}</td>
      <td><button class="btn small" data-i="${i}">กำหนด</button></td></tr>`).join("")}</tbody></table></div></div>`;
  // เลือกครูทีละช่อง: แสดงอย่างน้อย 2 ช่อง (ครูประจำชั้นคนที่ 1, 2) เพิ่มได้ถึง 4 คน — ช่องที่เว้นว่างไม่นับ
  const MAX_HR = 4, MIN_SLOTS = 2;
  const opts = (sel) => `<option value="">— ไม่ระบุ —</option>${list.map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(teacherText(list, t))}</option>`).join("")}`;
  const slot = (n, sel) => `<label class="hr-slot">ครูประจำชั้นคนที่ ${n}<select data-hr>${opts(sel)}</select></label>`;
  for (const b of view.querySelectorAll("[data-i]")) b.onclick = async () => {
    const r0 = rooms[Number(b.dataset.i)];
    const chosen = r0.teachers.map((t) => t.id);
    const slots = Array.from({ length: Math.max(MIN_SLOTS, chosen.length) }, (_, i) => chosen[i] ?? null);
    let picked = chosen;
    const r = await dialog({
      title: `ครูประจำชั้น ${r0.grade_level}/${r0.classroom}`,
      body: `<div style="display:grid;gap:10px" data-slots>${slots.map((id, i) => slot(i + 1, id)).join("")}</div>
        <button type="button" class="btn small" data-more style="margin-top:10px" ${slots.length >= MAX_HR ? "hidden" : ""}>+ เพิ่มครูประจำชั้น</button>
        <p class="muted small" style="margin:10px 0 0">กำหนดได้ห้องละไม่เกิน ${MAX_HR} คน · ทุกคนบันทึกการมาเรียน ผลการประเมิน และบันทึกประจำวันของห้องนี้ได้เท่ากัน · เว้นว่างได้</p>`,
      onOpen: (d) => {
        const box = d.querySelector("[data-slots]"), more = d.querySelector("[data-more]");
        const sync = () => { picked = [...box.querySelectorAll("[data-hr]")].map((x) => Number(x.value)).filter(Boolean); };
        box.addEventListener("change", (e) => {
          const sels = [...box.querySelectorAll("[data-hr]")], v = e.target.value;
          if (v && sels.some((x) => x !== e.target && x.value === v)) { e.target.value = ""; toast("เลือกครูคนนี้ไว้แล้ว", "bad"); }
          sync();
        });
        more.onclick = () => {
          const n = box.querySelectorAll("[data-hr]").length;
          if (n >= MAX_HR) return;
          box.insertAdjacentHTML("beforeend", slot(n + 1, null));
          more.hidden = n + 1 >= MAX_HR;
          box.lastElementChild.querySelector("select").focus();
        };
      },
    });
    if (!r.ok) return;
    try { await api("/api/admin/homerooms", { method: "PUT", body: { year: Y, grade_level: r0.grade_level, classroom: r0.classroom, user_ids: picked } }); toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
}

// ---------- ปฏิทินวันหยุด (ส่วนกลางอยู่ที่ /js/holiday-calendar.js — ครูประจำชั้นเปิดดูแบบอ่านอย่างเดียวที่ /calendar.html) ----------
const renderCalendar = () => renderHolidayCalendar(view, yq, render);

// ---------- รายชื่อนักเรียน: แก้ชื่อ เพศ ห้อง เลขที่  ----------
let rosterRoom = sessionStorage.getItem("sr-admin-roster") || "";
// เมนู "นักเรียน" มี 2 ส่วน: รายชื่อตามห้อง (แก้ข้อมูล) และ ย้ายเข้า/ย้ายออก
const studentTabs = (cur) => `<div class="tabs" role="tablist" style="margin-bottom:14px">
  <a role="tab" class="tab-link" href="#students" aria-selected="${cur === "students"}">รายชื่อตามห้อง</a>
  <a role="tab" class="tab-link" href="#moves" aria-selected="${cur === "moves"}">ย้ายเข้า / ย้ายออก / ออกกลางคัน</a>
  <a role="tab" class="tab-link" href="/admin.html#import" data-kind-link="students">นำเข้า / ส่งออก Excel</a></div>`;
async function renderStudents() {
  const base = await api(`/api/roster?${yq}`);
  if (!base.rooms.length) { view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีห้องเรียน</strong>นำเข้ารายชื่อนักเรียนจากแม่แบบ Excel ที่เมนู "นำเข้า / ส่งออกข้อมูล" หรือเลื่อนชั้นจากปีก่อนที่เมนูปีการศึกษา<br><a class="btn primary" style="margin-top:10px" href="/admin.html#import" data-kind-link="students">นำเข้ารายชื่อนักเรียน</a></div>`; return; }
  const key = (r) => `${r.grade_level}/${r.classroom}`;
  if (!base.rooms.some((r) => key(r) === rosterRoom)) rosterRoom = key(base.rooms.find((r) => r.grade_level.startsWith("ป.")) || base.rooms[0]);
  const [g, rm] = rosterRoom.split("/");
  const d = await api(`/api/roster?${yq}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(rm)}`);
  const roomOpts = (cur) => d.rooms.map((r) => `<option value="${esc(key(r))}" ${key(r) === cur ? "selected" : ""}>${esc(key(r))}</option>`).join("");
  view.innerHTML = `${studentTabs("students")}<div class="panel">
    <div class="panel-head"><div class="actions">${d.rooms.map((r) => `<button class="btn small ${key(r) === rosterRoom ? "primary" : ""}" data-rr="${esc(key(r))}">${esc(key(r))}</button>`).join("")}</div></div>
    <div class="actions" style="margin-bottom:8px"><button class="btn small" id="renumber">เรียงเลขที่ใหม่ทั้งห้อง ${esc(rosterRoom)}</button></div>
    <p class="muted small">หลังเปิดภาค นักเรียนที่ย้ายออก/ย้ายห้องจะถูกเว้นเลขที่ไว้ เลขที่ของคนอื่นไม่เลื่อน และคนที่เข้าใหม่ได้เลขที่ต่อท้าย — ขึ้นภาคหรือปีใหม่กด "เรียงเลขที่ใหม่ทั้งห้อง" เพื่อเรียงใหม่ไม่ให้มีเลขที่เว้น</p>
    <p class="muted small">แก้แล้วบันทึกทันที · ข้อมูลผู้ปกครอง/ที่อยู่แก้ผ่านการนำเข้าแม่แบบ (ส่งออก → แก้ใน Excel → นำเข้า) · เลขที่ว่าง = เรียงอัตโนมัติ (${"ชายก่อนหญิง แล้วตามเลขประจำตัว"} — เปลี่ยนวิธีเรียงได้ที่ "เกณฑ์และผู้ลงนาม") ใส่เลขที่เองเพื่อตรึงไว้
      · ย้ายห้องภายในโรงเรียน: เลือกห้องใหม่ · นักเรียนย้ายออก/ย้ายเข้าใช้แท็บ "ย้ายเข้า / ย้ายออก"</p>
    <div class="table-wrap"><table class="list roster-edit"><thead><tr><th class="num">เลขที่</th><th>เลขประจำตัว</th><th>คำนำหน้า</th><th>ชื่อ</th><th>นามสกุล</th><th>เพศ</th><th>เลขประจำตัวประชาชน</th><th>วันเกิด</th><th>ห้อง</th></tr></thead>
    <tbody>${d.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status === "transferred" || s.enrollment_status === "withdrawn" ? "inactive" : ""}">
      <td class="num"><input data-f="number" inputmode="numeric" value="${s.manual_number ?? ""}" placeholder="${s.number ?? ""}" aria-label="เลขที่ ${esc(s.name)}" style="width:56px;text-align:center"></td>
      <td>${esc(s.student_code)}${s.transfer_in_term ? ' <span class="tag">ย้ายเข้า</span>' : ""}${s.enrollment_status === "transferred" ? ' <span class="tag warn">ย้ายออก</span>' : s.enrollment_status === "withdrawn" ? ' <span class="tag warn">ออกกลางคัน</span>' : ""}</td>
      <td><input data-f="name_prefix" list="prefixList" value="${esc(s.name_prefix)}" style="width:96px" aria-label="คำนำหน้า"></td>
      <td><input data-f="first_name" value="${esc(s.first_name)}" aria-label="ชื่อ" style="min-width:130px"></td>
      <td><input data-f="last_name" value="${esc(s.last_name)}" aria-label="นามสกุล" style="min-width:130px"></td>
      <td><select data-f="gender" style="width:70px" aria-label="เพศ"><option value="">–</option><option ${s.gender === "ช" ? "selected" : ""} value="ช">ช</option><option ${s.gender === "ญ" ? "selected" : ""} value="ญ">ญ</option></select></td>
      <td><input data-f="national_id" inputmode="numeric" maxlength="17" value="${esc(s.national_id)}" style="width:150px" aria-label="เลขประจำตัวประชาชน ${esc(s.name)}"></td>
      <td><input data-f="birth_date" type="date" value="${esc(s.birth_date)}" style="width:150px" aria-label="วันเกิด ${esc(s.name)}"></td>
      <td><select data-f="room" style="width:96px" aria-label="ห้อง">${roomOpts(rosterRoom)}</select></td></tr>`).join("")}</tbody></table></div>
    <datalist id="prefixList">${d.prefixes.map((p) => `<option value="${esc(p)}">`).join("")}</datalist></div>`;
  for (const b of view.querySelectorAll("[data-rr]")) b.onclick = () => { rosterRoom = b.dataset.rr; sessionStorage.setItem("sr-admin-roster", rosterRoom); render(); };
  document.getElementById("renumber").onclick = async () => {
    if (!(await confirmBox("เรียงเลขที่ใหม่ทั้งห้อง", `ห้อง ${esc(rosterRoom)}: ล้างเลขที่ที่ตรึงไว้และเลขที่ที่เว้นไว้ของคนที่ย้ายออก แล้วเรียงใหม่ตามเกณฑ์ปกติ — <b>เลขที่ของนักเรียนอาจเปลี่ยน</b> ครูที่วางคะแนนจาก Excel ตามเลขที่ต้องใช้รายชื่อใหม่`, "เรียงใหม่", true))) return;
    try { await api(`/api/roster/renumber?${yq}`, { method: "POST", body: { grade_level: g, classroom: rm } }); toast("เรียงเลขที่ใหม่แล้ว"); render(); } catch (err) { showError(err); }
  };
  view.querySelector("tbody").addEventListener("change", async (e) => {
    const el = e.target, tr = el.closest("tr"), f = el.dataset.f;
    if (!f) return;
    let body;
    if (f === "room") {
      const [grade_level, classroom] = el.value.split("/");
      if (!(await confirmBox("ย้ายห้อง", `ย้ายนักเรียนไปห้อง ${esc(el.value)} — คะแนนที่กรอกไว้ในห้องเดิมยังอยู่ (แสดงเป็น "ย้ายห้อง") · ถ้าเปิดภาคเรียนแล้ว นักเรียนได้เลขที่ต่อท้ายห้องใหม่ เลขที่ของคนเดิมไม่เลื่อน`, "ย้ายห้อง"))) { el.value = rosterRoom; return; }
      body = { grade_level, classroom };
    } else body = { [f]: el.value.trim() };
    try {
      el.disabled = true;
      const r = await api(`/api/roster/${tr.dataset.sid}?${yq}`, { method: "PUT", body });
      toast(r.moved ? "ย้ายห้องแล้ว" : "บันทึกแล้ว");
      if (f === "number" || r.moved) render();
    } catch (err) { showError(err); if (f === "number") render(); }
    finally { el.disabled = false; }
  });
}

// ---------- นักเรียนย้ายเข้า / ย้ายออก / ออกกลางคัน (soft delete) ----------
const STATUS_TH = { enrolled: "กำลังเรียน", transferred: "ย้ายออก", withdrawn: "ออกกลางคัน", graduated: "จบการศึกษา" };
let moveQuery = "";
async function renderMoves() {
  const m = await api(`/api/moves?${yq}`);
  const termSel = (name = "term_number") => `<label>ภาคเรียน<select name="${name}">${[1, 2].map((t) => `<option value="${t}" ${t === m.term_number ? "selected" : ""}>ภาคเรียนที่ ${t}</option>`).join("")}</select></label>`;
  const roomSel = () => `<label>เข้าเรียนห้อง<select name="room" required><option value="">เลือกห้อง</option>${m.rooms.map((r) => `<option value="${esc(r.grade_level)}|${esc(r.classroom)}">${esc(r.grade_level)}/${esc(r.classroom)}</option>`).join("")}</select></label>`;
  view.innerHTML = `${studentTabs("moves")}
    <div class="panel">
      <div class="panel-head"><h2>ค้นหานักเรียน</h2><button class="btn primary" id="newKid">+ นักเรียนย้ายเข้าใหม่</button></div>
      <p class="muted small">นักเรียนที่ย้ายออกหรือออกกลางคันจะไม่แสดงในรายชื่อทุกหน้า แต่ระบบไม่ลบข้อมูล — ถ้ากลับมาเรียนอีก ให้ค้นหาแล้วกด "รับกลับเข้าเรียน" จะได้เลขประจำตัวเดิมและข้อมูลเดิมทั้งหมด
        · นักเรียนที่เข้าระหว่างปีได้เลขที่ต่อท้ายห้อง · หลังเปิดภาค คนที่ย้ายออกถูกเว้นเลขที่ไว้ เลขที่ของคนอื่นไม่เลื่อน (ยกเลิก/รับกลับห้องเดิมได้เลขที่เดิม)</p>
      <form id="findForm" class="row-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <input type="search" name="q" value="${esc(moveQuery)}" placeholder="เลขประจำตัว / เลขบัตรประชาชน 13 หลัก / ชื่อ" style="flex:1;min-width:220px" required>
        <button class="btn">ค้นหา</button>
      </form>
      <div id="found"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>รายการปีการศึกษา ${me.year.year_be}</h2></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>วันที่</th><th>นักเรียน</th><th>รายการ</th><th>ห้อง</th><th>ภาค</th><th>โรงเรียน / หมายเหตุ</th><th>บันทึกโดย</th><th></th></tr></thead>
      <tbody>${m.moves.map((x) => `<tr class="${x.undone_at ? "muted" : ""}">
        <td class="small">${esc(x.move_date ? thaiTime(x.move_date, false) : thaiTime(x.created_at, false))}</td><td>${esc(x.student_code)} ${esc(x.name)}</td>
        <td><span class="tag ${x.direction === "out" ? "warn" : "ok"}">${esc(x.label)}</span>${x.undone_at ? ' <span class="tag">ยกเลิกแล้ว</span>' : ""}</td>
        <td>${esc(x.grade_level || "")}/${esc(x.classroom || "")}</td><td class="num">${x.term_number}</td>
        <td class="small">${esc([x.school, x.note].filter(Boolean).join(" · "))}</td><td class="small">${esc(x.by_name || "")}</td>
        <td>${x.direction === "out" && !x.undone_at ? `<button class="btn small" data-undo="${x.id}">ยกเลิก</button>` : x.direction === "in" ? `<a class="small" href="/homeroom.html?grade=${encodeURIComponent(x.grade_level)}&room=${encodeURIComponent(x.classroom)}&year=${Y}#carry">คะแนนยกมา</a>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="8" class="empty">ยังไม่มีรายการ</td></tr>`}</tbody></table></div>
    </div>`;

  const showFound = async () => {
    const box = document.getElementById("found");
    if (!moveQuery) { box.innerHTML = ""; return; }
    box.innerHTML = `<p class="muted small">กำลังค้นหา…</p>`;
    const { results } = await api(`/api/moves?${yq}&q=${encodeURIComponent(moveQuery)}`);
    box.innerHTML = results.length ? `<div class="table-wrap" style="margin-top:10px"><table class="list"><thead><tr><th>เลขประจำตัว</th><th>ชื่อ–สกุล</th><th>เลขประจำตัวประชาชน</th><th>ห้องล่าสุด</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${results.map((x, i) => `<tr><td>${esc(x.student_code)}</td><td>${esc(x.name)}</td><td class="small">${esc(x.national_id)}</td>
        <td>${x.grade_level ? `${esc(x.grade_level)}/${esc(x.classroom)}${x.in_year ? "" : ` <span class="muted small">(ปี ${esc(x.last_year_be || "")})</span>`}` : "–"}</td>
        <td><span class="tag ${x.enrolled ? "ok" : "warn"}">${esc(STATUS_TH[x.status] || x.status)}</span></td>
        <td class="actions">${x.enrolled
          ? `<button class="btn small" data-out="${i}" data-reason="transfer">ย้ายออก</button><button class="btn small" data-out="${i}" data-reason="dropout">ออกกลางคัน</button>`
          : `<button class="btn small primary" data-back="${i}">รับกลับเข้าเรียน</button>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted" style="margin-top:10px">ไม่พบนักเรียน — ถ้าเป็นนักเรียนที่ไม่เคยเรียนที่นี่ ให้กด "นักเรียนย้ายเข้าใหม่"</p>`;
    for (const b of box.querySelectorAll("[data-out]")) b.onclick = async () => {
      const x = results[Number(b.dataset.out)], transfer = b.dataset.reason === "transfer";
      const r = await dialog({
        title: `${transfer ? "ย้ายออก" : "ออกกลางคัน / ติดตามไม่ได้"}: ${x.name}`,
        okText: "บันทึก", okClass: "danger",
        body: `<p class="muted small">${esc(x.name)} จะไม่แสดงในรายชื่อ รายวิชา ปพ.5 และ ปพ.6 อีก แต่ข้อมูลและคะแนนยังเก็บไว้ ยกเลิกได้ภายหลัง</p>
          <div class="form-grid">${termSel()}<label>วันที่${transfer ? "ย้ายออก" : "ออก"}<input type="date" name="move_date"></label>
          ${transfer ? `<label>ย้ายไปโรงเรียน<input name="school" maxlength="200"></label>` : ""}
          <label>หมายเหตุ<input name="note" maxlength="300" placeholder="${transfer ? "" : "เช่น ขาดเรียนต่อเนื่อง ติดตามไม่ได้"}"></label></div>`,
      });
      if (!r.ok) return;
      try { await api(`/api/moves/out?${yq}`, { method: "POST", body: { student_id: x.id, reason: b.dataset.reason, ...r.data } }); toast("บันทึกแล้ว"); renderMoves(); } catch (err) { showError(err); }
    };
    for (const b of box.querySelectorAll("[data-back]")) b.onclick = async () => {
      const x = results[Number(b.dataset.back)];
      const r = await dialog({
        title: `รับกลับเข้าเรียน: ${x.name}`,
        body: `<p class="muted small">ใช้ระเบียนเดิม เลขประจำตัว ${esc(x.student_code)}</p>
          <div class="form-grid">${roomSel()}${termSel()}<label>วันที่เข้าเรียน<input type="date" name="move_date"></label>
          <label>ย้ายมาจากโรงเรียน<input name="school" maxlength="200"></label><label>หมายเหตุ<input name="note" maxlength="300"></label></div>`,
      });
      if (!r.ok) return;
      const [grade_level, classroom] = String(r.data.room || "").split("|");
      try { await api(`/api/moves/in?${yq}`, { method: "POST", body: { student_id: x.id, grade_level, classroom, ...r.data } }); toast("รับเข้าแล้ว — ครูประจำชั้นกรอกคะแนนยกมาจาก ปพ.6 ได้ที่หน้าห้อง"); renderMoves(); } catch (err) { showError(err); }
    };
  };
  document.getElementById("findForm").onsubmit = (e) => { e.preventDefault(); moveQuery = e.target.q.value.trim(); showFound().catch(showError); };
  showFound().catch(showError);

  document.getElementById("newKid").onclick = async () => {
    const r = await dialog({
      title: "นักเรียนย้ายเข้าใหม่",
      body: `<p class="muted small">ค้นหาก่อนเสมอ ถ้าเคยเรียนที่นี่มาก่อนให้ใช้ "รับกลับเข้าเรียน" เพื่อใช้เลขประจำตัวเดิม — ระบบจะไม่ยอมให้เลขประจำตัวหรือเลขบัตรประชาชนซ้ำ</p>
        <div class="form-grid">
          <label>เลขประจำตัวนักเรียน<input name="student_code" value="${esc(m.next_code)}" required maxlength="20"></label>
          <label>คำนำหน้า<select name="name_prefix"><option>เด็กชาย</option><option>เด็กหญิง</option></select></label>
          <label>ชื่อ<input name="first_name" required maxlength="80"></label>
          <label>นามสกุล<input name="last_name" required maxlength="80"></label>
          <label>เลขประจำตัวประชาชน<input name="national_id" inputmode="numeric" maxlength="17"></label>
          <label>วันเกิด<input type="date" name="birth_date"></label>
          ${roomSel()}${termSel()}
          <label>วันที่ย้ายเข้า<input type="date" name="move_date"></label>
          <label>ย้ายมาจากโรงเรียน<input name="school" maxlength="200"></label>
        </div>`,
    });
    if (!r.ok) return;
    const d = r.data, [grade_level, classroom] = String(d.room || "").split("|");
    try {
      await api(`/api/moves/in?${yq}`, { method: "POST", body: { grade_level, classroom, term_number: d.term_number, move_date: d.move_date, school: d.school,
        student: { student_code: d.student_code, name_prefix: d.name_prefix, first_name: d.first_name, last_name: d.last_name, national_id: d.national_id, birth_date: d.birth_date } } });
      toast("เพิ่มนักเรียนแล้ว — ครูประจำชั้นกรอกคะแนนยกมาจาก ปพ.6 ได้ที่หน้าห้อง");
      moveQuery = d.student_code; renderMoves();
    } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-undo]")) b.onclick = async () => {
    if (!(await confirmBox("ยกเลิกรายการนี้", "นักเรียนจะกลับมาอยู่ในรายชื่อห้องเดิมพร้อมข้อมูลเดิม"))) return;
    try { await api(`/api/moves/${b.dataset.undo}/undo?${yq}`, { method: "POST", body: {} }); toast("ยกเลิกแล้ว"); renderMoves(); } catch (err) { showError(err); }
  };
}

// ---------- คลังตัวชี้วัด: ชุดเริ่มต้น · อัปโหลดไฟล์แม่แบบ · วางทีละกลุ่ม · ส่งออก ----------
async function renderBank() {
  const { learning_areas } = await api(`/api/admin/subjects?${yq}`);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>ชุดตัวชี้วัดเริ่มต้น</h2></div>
    <p class="muted small">ระบบใส่ชุดเหล่านี้ให้แล้วตอนติดตั้ง (ชุดเดียวกับที่โรงเรียนบ้านป่าเด็งใช้) — กดนำเข้าซ้ำได้ถ้าเผลอลบไป ตัวชี้วัดที่มีอยู่แล้วจะข้าม</p>
    <div class="doc-grid">${STARTER_SETS.map((x) => `<div class="doc-item"><b>${esc(x.title)}</b><button class="btn small" data-starter="${x.key}">นำเข้าชุดนี้</button></div>`).join("")}</div></div>
    <div id="bankUpload" style="margin-top:16px"></div>
    <div class="panel" style="margin-top:16px">
    <div class="panel-head"><h2>วางตัวชี้วัดทีละกลุ่ม</h2></div>
    <p class="muted small">เลือกชั้นและกลุ่มสาระ แล้ววางตัวชี้วัดจากเอกสารหลักสูตรบรรทัดละ 1 ข้อ — ครูทุกคนเลือกตัวชี้วัดจากคลังนี้ได้ในหน้าโครงสร้างคะแนน</p>
    <form id="bankForm">
      <div class="form-grid">
        <label class="field">ระดับชั้น<select name="grade">${GRADES.map((g) => `<option>${g}</option>`).join("")}</select></label>
        <label class="field">กลุ่มสาระ<select name="area">${learning_areas.map((a) => `<option>${a}</option>`).join("")}</select></label>
      </div>
      <label class="field" style="margin-top:12px">ตัวชี้วัด<textarea name="lines" required placeholder="ท 1.1 ป.1/1 ออกเสียงคำ คำคล้องจอง และข้อความสั้น ๆ"></textarea></label>
      <div class="actions" style="margin-top:12px"><button class="btn primary">นำเข้า</button><span class="muted small" id="bankPreview"></span></div>
    </form></div>`;
  importCard(document.getElementById("bankUpload"), "bank", { onDone: drawBankSummary });
  for (const b of view.querySelectorAll("[data-starter]")) b.onclick = async () => {
    const set = STARTER_SETS.find((x) => x.key === b.dataset.starter);
    b.disabled = true; const label = b.textContent; b.textContent = "กำลังดาวน์โหลด…";
    try {
      const res = await fetch(STARTER_BASE + set.file);
      if (!res.ok) throw new Error("ดาวน์โหลดชุดตัวชี้วัดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
      const rows = starterRows(parseStarter(await res.text()));
      let added = 0, skipped = 0;
      for (let i = 0; i < rows.length; i += 3000) {
        b.textContent = `กำลังนำเข้า ${Math.min(i + 3000, rows.length)}/${rows.length}…`;
        const r = await api("/api/admin/indicator-bank/import", { method: "POST", body: { rows: rows.slice(i, i + 3000) } });
        added += r.added; skipped += r.skipped;
      }
      toast(`เพิ่ม ${added} ตัวชี้วัด${skipped ? ` (มีอยู่แล้ว ${skipped})` : ""}`);
      drawBankSummary();
    } catch (err) { showError(err); }
    finally { b.disabled = false; b.textContent = label; }
  };
  const f = document.getElementById("bankForm");
  f.lines.oninput = () => { const n = parseIndicatorLines(f.lines.value).length; document.getElementById("bankPreview").textContent = n ? `พบ ${n} ตัวชี้วัด` : ""; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const rows = parseIndicatorLines(f.lines.value).map((r) => ({ ...r, grade_level: f.grade.value, learning_area: f.area.value }));
    if (!rows.length) return;
    try { const r = await api("/api/admin/indicator-bank/import", { method: "POST", body: { rows } }); toast(`เพิ่ม ${r.added} ตัวชี้วัด${r.skipped ? ` (ซ้ำ ${r.skipped})` : ""}`); f.lines.value = ""; drawBankSummary(); } catch (err) { showError(err); }
  };
  view.insertAdjacentHTML("beforeend", `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>ตัวชี้วัดในคลัง</h2></div>
    <p class="muted small">ตัวชี้วัดที่ผูกรหัสวิชาจะแสดงเฉพาะในรายวิชานั้น · ไม่ระบุรหัสวิชา = ทุกวิชาของกลุ่มสาระในชั้นนั้นเห็น · ส่งออกทั้งคลังได้ที่การ์ด "ตัวชี้วัด" ด้านบน</p><div id="bankSummary"><p class="muted">กำลังโหลด…</p></div></div>`);
  drawBankSummary();
}
async function drawBankSummary() {
  const box = document.getElementById("bankSummary");
  if (!box) return;
  const { groups } = await api("/api/admin/indicator-bank");
  if (!groups.length) { box.innerHTML = `<p class="muted">ยังไม่มีตัวชี้วัดในคลัง</p>`; return; }
  box.innerHTML = `<div class="table-wrap"><table class="list"><thead><tr><th>ชั้น</th><th>รหัสวิชา</th><th>กลุ่มสาระ</th><th class="num">ระหว่างทาง</th><th class="num">ปลายทาง</th><th class="num">ผลการเรียนรู้/ผลลัพธ์/ความสามารถ</th><th class="num">รวม</th><th></th></tr></thead>
    <tbody>${groups.map((g, i) => `<tr><td>${esc(g.grade_level)}</td><td>${esc(g.subject_code || (g.grade_level.startsWith("อ.") ? "ปฐมวัย (ประเมินพัฒนาการ)" : "ทุกวิชาในกลุ่มสาระ"))}</td><td>${esc(g.learning_area)}</td>
      <td class="num">${g.mid || ""}</td><td class="num">${g.final || ""}</td><td class="num">${g.outcome || ""}</td><td class="num"><b>${g.n}</b></td>
      <td class="actions"><button class="btn small" data-g="${i}">ดูรายการ</button>${CAN_IMPORT ? `<button class="btn small" data-gdel="${i}">ลบทั้งกลุ่ม</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  for (const b of box.querySelectorAll("[data-g]")) b.onclick = () => showBankGroup(groups[Number(b.dataset.g)]);
  for (const b of box.querySelectorAll("[data-gdel]")) b.onclick = async () => {
    const g = groups[Number(b.dataset.gdel)];
    if (!(await confirmBox("ลบตัวชี้วัดทั้งกลุ่ม", `ลบตัวชี้วัด ${g.n} ข้อของ ${esc(g.grade_level)} ${esc(g.subject_code || g.learning_area)} ออกจากคลัง — ช่องคะแนนที่ครูสร้างไว้แล้วไม่ถูกลบ`, "ลบ", true))) return;
    const q = new URLSearchParams({ grade: g.grade_level, area: g.learning_area, subject: g.subject_code || "" });
    try { const r = await api(`/api/admin/indicator-bank/group?${q}`, { method: "DELETE" }); toast(`ลบ ${r.deleted} ตัวชี้วัด`); drawBankSummary(); } catch (err) { showError(err); }
  };
}
async function showBankGroup(g) {
  const q = new URLSearchParams({ grade: g.grade_level, area: g.learning_area, subject: g.subject_code || "" });
  const { indicators } = await api(`/api/admin/indicator-bank/list?${q}`);
  await dialog({
    title: `คลังตัวชี้วัด ${g.grade_level} ${g.subject_code || g.learning_area}`, wide: true, okText: "", cancelText: "ปิด",
    body: `<div style="display:grid;gap:6px" id="bankList">${indicators.map((x) => `<div class="actions" style="justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--line-soft);padding:4px 0" data-row="${x.id}">
      <span><b>${esc(x.code)}</b> ${esc(x.title)}${x.kind && !x.kind.startsWith("ผล") ? ` <span class="tag">${esc(x.kind)}</span>` : ""}</span>
      ${CAN_IMPORT ? `<button class="btn small" data-del="${x.id}">ลบ</button>` : ""}</div>`).join("")}</div>`,
    onOpen: (d) => {
      for (const b of d.querySelectorAll("[data-del]")) b.onclick = async () => {
        try { await api(`/api/admin/indicator-bank/${b.dataset.del}`, { method: "DELETE" }); d.querySelector(`[data-row="${b.dataset.del}"]`).remove(); drawBankSummary(); } catch (err) { showError(err); }
      };
    },
  });
}

// ---------- เกณฑ์และผู้ลงนาม ----------
async function renderSettings() {
  const { settings: s } = await api(`/api/admin/settings?${yq}`);
  view.innerHTML = `<form class="panel" id="setForm">
    <div class="panel-head"><h2>เกณฑ์การวัดผล ปีการศึกษา ${me.year.year_be}</h2></div>
    <div class="form-grid">
      <label class="field">สัดส่วนเริ่มต้นของวิชาใหม่ (ระหว่างภาค : ปลายภาค)<select name="collect_ratio">${ratioOptions(s.collect_ratio)}</select></label>
      <label class="field">เกณฑ์ผ่านตัวชี้วัด ภาค 1 (%)<input name="indicator_pass_pct" inputmode="numeric" value="${s.indicator_pass_pct}" required></label>
      <label class="field">เกณฑ์ผ่านตัวชี้วัด ภาค 2 (%)<input name="indicator_pass_pct_t2" inputmode="numeric" value="${s.indicator_pass_pct_t2 ?? ""}" placeholder="ว่าง = ใช้ค่าภาค 1"></label>
      <label class="field">เกณฑ์เวลาเรียน (%)<input name="attendance_pass_pct" inputmode="numeric" value="${s.attendance_pass_pct}" required></label>
    </div>
    <p class="muted small">ตัวชี้วัดที่ได้คะแนนถึงร้อยละนี้ของคะแนนเต็มได้ "ผ" · คะแนนรวมไม่ปัดเศษ ตัดเกรดจากคะแนนจริง (79.5 = 3.5)</p>
    <label class="field" style="margin-top:14px;max-width:420px">การเรียงเลขที่ในห้อง<select name="roster_order">
      <option value="gender" ${s.roster_order !== "code" ? "selected" : ""}>ชายก่อนหญิง แล้วเรียงตามเลขประจำตัว</option>
      <option value="code" ${s.roster_order === "code" ? "selected" : ""}>เรียงตามเลขประจำตัวอย่างเดียว</option></select></label>
    <p class="muted small">ต้องตรงกับรายชื่อที่ครูใช้ใน Excel เพราะการวางคะแนนจะลงตามลำดับเลขที่</p>
    <label class="check" style="margin-top:14px"><input type="checkbox" name="entry_open" ${s.entry_open ? "checked" : ""}> เปิดให้ครูกรอก/แก้ไขคะแนน</label>
    <h2 style="margin-top:24px">ข้อมูลบนเอกสาร</h2>
    <div class="form-grid">
      <label class="field">ชื่อโรงเรียน<input name="school_name" value="${esc(s.school_name)}" maxlength="120"></label>
      <label class="field">เขตพื้นที่<input name="school_area" value="${esc(s.school_area)}" maxlength="160" placeholder="สำนักงานเขตพื้นที่การศึกษาประถมศึกษาอ่างทอง"></label>
      <label class="field">สังกัด<input name="affiliation" value="${esc(s.affiliation)}" maxlength="160"></label>
      <label class="field">ที่อยู่บนปก ปพ.5<input name="school_address" value="${esc(s.school_address)}" maxlength="160" placeholder="อำเภอ… จังหวัดอ่างทอง"></label>
      <label class="field">ผู้อำนวยการ<input name="director_name" value="${esc(s.director_name)}" maxlength="120"></label>
      <div class="field" id="deputyBox">รองผู้อำนวยการ (ได้หลายคน)
        ${(() => { const ds = String(s.deputy_director_name || "").split("\n").filter(Boolean); return (ds.length ? ds : [""]).map((n, i) => `<input data-deputy value="${esc(n)}" maxlength="120" placeholder="รองผู้อำนวยการคนที่ ${i + 1}" aria-label="รองผู้อำนวยการคนที่ ${i + 1}" style="margin-bottom:6px">`).join(""); })()}
        <button type="button" class="btn small" id="addDeputy">+ เพิ่มรองผู้อำนวยการ</button></div>
      <label class="field">หัวหน้างานวิชาการ<input name="academic_head_name" value="${esc(s.academic_head_name)}" maxlength="120"></label>
      <label class="field">หัวหน้างานวัดผล<input name="measurement_head_name" value="${esc(s.measurement_head_name)}" maxlength="120"></label>
    </div>
    <div class="actions" style="margin-top:16px"><button class="btn primary">บันทึก</button></div></form>`;
  document.getElementById("addDeputy").onclick = (ev) => {
    const box = document.getElementById("deputyBox"), n = box.querySelectorAll("[data-deputy]").length;
    if (n >= 5) { toast("ใส่ได้ไม่เกิน 5 คน", "bad"); return; }
    ev.target.insertAdjacentHTML("beforebegin", `<input data-deputy maxlength="120" placeholder="รองผู้อำนวยการคนที่ ${n + 1}" aria-label="รองผู้อำนวยการคนที่ ${n + 1}" style="margin-bottom:6px">`);
    ev.target.previousElementSibling.focus();
  };
  document.getElementById("setForm").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.entry_open = !!d.entry_open;
    d.deputy_director_names = [...e.target.querySelectorAll("[data-deputy]")].map((x) => x.value.trim()).filter(Boolean);
    try { await api(`/api/admin/settings?${yq}`, { method: "PUT", body: d }); toast("บันทึกแล้ว"); }
    catch (err) {
      // เปลี่ยนเกณฑ์ผ่าน/เวลาเรียนหลังมีรายวิชาส่งผลแล้ว → ยืนยันก่อน
      if (err.data?.needs_confirm && await confirmBox("เกณฑ์มีผลกับรายวิชาที่ส่งแล้ว", `${esc(err.message)}<br><br>ยืนยันเปลี่ยนเกณฑ์หรือไม่`, "ยืนยันเปลี่ยน", true)) {
        try { await api(`/api/admin/settings?${yq}`, { method: "PUT", body: { ...d, confirm_locked: true } }); toast("บันทึกแล้ว"); } catch (e2) { showError(e2); }
      } else if (!err.data?.needs_confirm) showError(err);
    }
  };
}

// ---------- บัญชีผู้ใช้และสิทธิ์ ----------
// ผู้ดูแลระบบ: ทุกบัญชี ทุกบทบาท + สิทธิ์ทีมวัดผล · ทีมวัดผล: เพิ่ม/แก้/ตั้งรหัสผ่านได้เฉพาะบัญชีครู
const ROLE_TH = { "": "ยังไม่กำหนด (สมัครใหม่)", teacher: "ครู", executive: "ผู้บริหาร", superadmin: "ผู้ดูแลระบบ", viewer: "ผู้ชมภายนอก (ดูอย่างเดียว)" };
let peopleQuery = "";
async function renderPeople() {
  teachersCache = null;
  const { users, me: myId, is_super } = await api("/api/users");
  const touchable = (u) => is_super || u.role == null || u.role === "teacher";
  const roleOpts = (cur) => Object.entries(ROLE_TH).filter(([k]) => is_super || ["", "teacher"].includes(k))
    .map(([k, v]) => `<option value="${k}" ${(cur || "") === k ? "selected" : ""}>${v}</option>`).join("");
  const pending = users.filter((u) => u.role == null);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>บัญชีผู้ใช้ <span class="tag">${users.length}</span>${pending.length ? ` <span class="tag warn">รอกำหนดบทบาท ${pending.length}</span>` : ""}</h2>
      <div class="actions"><button class="btn primary" id="addUser">+ เพิ่มบัญชี</button><a class="btn" href="/admin.html#import" data-kind-link="users">นำเข้า / ส่งออก Excel</a></div></div>
    <p class="muted small">ครูสมัครเองได้ที่หน้าเข้าสู่ระบบ (ยังไม่มีบทบาทจนกว่าจะได้รับวิชาสอนหรือกำหนดบทบาทที่นี่) ·
      ทีมวัดผล = เห็นบทบาท "เจ้าหน้าที่วัดผล": ตั้งค่ารายวิชา นำเข้าข้อมูล ตรวจและส่งคืนงาน · ผู้บริหาร = อนุมัติผลและดูรายงาน · ผู้ชมภายนอก = ดูสรุปได้อย่างเดียว ไม่เห็นชื่อนักเรียน
      ${is_super ? "" : "<br>ทีมวัดผลจัดการได้เฉพาะบัญชีครู (บทบาทอื่นให้ผู้ดูแลระบบกำหนด)"}</p>
    <input type="search" id="userQ" value="${esc(peopleQuery)}" placeholder="ค้นหาชื่อ อีเมล หรือตำแหน่ง" style="max-width:320px;margin:6px 0 10px">
    <div class="table-wrap"><table class="list"><thead><tr><th>ชื่อ-สกุล</th><th>อีเมล/ชื่อผู้ใช้</th><th>บทบาท</th><th>ทีมวัดผล</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead>
    <tbody>${[...pending, ...users.filter((u) => u.role != null)].map((u) => { const t = touchable(u); return `<tr data-q="${esc(`${u.full_name} ${u.email} ${u.position}`)}" class="${u.status !== "active" ? "muted" : ""}">
      <td><b>${esc(u.full_name)}</b>${u.id === myId ? ' <span class="tag">คุณ</span>' : ""}${u.status !== "active" ? ' <span class="tag warn">ระงับ</span>' : ""}${u.must_change ? ' <span class="tag" data-tip="ยังไม่ได้เปลี่ยนรหัสผ่านเริ่มต้น">รหัสเริ่มต้น</span>' : ""}<br><span class="muted small">${esc(u.position || "")}</span></td>
      <td class="small">${esc(u.email)}</td>
      <td>${t && u.id !== myId ? `<select data-role="${u.id}" style="min-width:140px" aria-label="บทบาท ${esc(u.full_name)}">${roleOpts(u.role)}</select>` : esc(ROLE_TH[u.role || ""])}
        ${u.role === "viewer" ? `<br><span class="small muted">หมดอายุ ${u.viewer_expires ? esc(thaiTime(u.viewer_expires, false)) : "ไม่กำหนด"}</span>` : ""}</td>
      <td>${u.role === "superadmin" ? '<span class="tag ok">ทุกสิทธิ์</span>' : u.role === "viewer" ? "" : is_super ? `<label class="check"><input type="checkbox" data-team="${u.id}" ${u.grade_admin ? "checked" : ""}> ให้สิทธิ์</label>` : u.grade_admin ? '<span class="tag ok">มีสิทธิ์</span>' : ""}</td>
      <td class="small muted">${u.last_login_at ? esc(thaiTime(u.last_login_at)) : "ยังไม่เคย"}</td>
      <td class="actions">${t ? `<button class="btn small" data-edit="${u.id}">แก้ไข</button><button class="btn small" data-pw="${u.id}">ตั้งรหัสผ่านใหม่</button>${u.id !== myId ? `<button class="btn small" data-del="${u.id}">ลบ</button>` : ""}` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  const q = document.getElementById("userQ");
  const filter = () => { peopleQuery = q.value.trim(); for (const tr of view.querySelectorAll("tbody tr")) tr.hidden = !!peopleQuery && !tr.dataset.q.toLowerCase().includes(peopleQuery.toLowerCase()); };
  q.oninput = filter; filter();
  const byId = (id) => users.find((u) => u.id === Number(id));
  const showPassword = (u, pw) => dialog({ title: "รหัสผ่านเริ่มต้น", okText: "", cancelText: "ปิด",
    body: `<p>${esc(u.full_name)} (${esc(u.email)})</p><p style="font-size:1.4em"><code>${esc(pw)}</code></p><p class="muted small">แจ้งผู้ใช้ — เข้าสู่ระบบครั้งแรกแล้วระบบจะให้เปลี่ยนรหัสผ่าน · รหัสนี้แสดงครั้งเดียว</p>` });
  for (const sel of view.querySelectorAll("[data-role]")) sel.onchange = async () => {
    const u = byId(sel.dataset.role);
    let body = { role: sel.value || null };
    if (sel.value === "viewer") {
      const r = await dialog({ title: "บัญชีผู้ชมภายนอก", body: `<label class="field">ใช้งานได้ถึงวันที่ (ไม่บังคับ)<input type="date" name="exp"></label><p class="muted small">ผู้ชมภายนอกดูสรุปผลสัมฤทธิ์และข้อมูล SAR ได้อย่างเดียว ไม่เห็นชื่อนักเรียน</p>` });
      if (!r.ok) { sel.value = u.role || ""; return; }
      body.viewer_expires = r.data.exp || null;
    }
    try { await api(`/api/users/${u.id}`, { method: "PUT", body }); toast("เปลี่ยนบทบาทแล้ว"); render(); } catch (err) { sel.value = u.role || ""; showError(err); }
  };
  for (const c of view.querySelectorAll("[data-team]")) c.onchange = async () => {
    try { await api(`/api/users/${c.dataset.team}`, { method: "PUT", body: { grade_admin: c.checked } }); toast(c.checked ? "ให้สิทธิ์ทีมวัดผลแล้ว" : "ยกเลิกสิทธิ์แล้ว"); } catch (err) { c.checked = !c.checked; showError(err); }
  };
  const form = (u = {}) => `<div class="form-grid">
    <label class="field">ชื่อ-สกุล<input name="full_name" required maxlength="120" value="${esc(u.full_name || "")}" placeholder="นายสมชาย ใจดี"></label>
    <label class="field">อีเมล หรือชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)<input name="email" required maxlength="120" value="${esc(u.email || "")}" autocapitalize="off" placeholder="somchai หรือ somchai@gmail.com"></label>
    <label class="field">ตำแหน่ง<input name="position" maxlength="120" value="${esc(u.position || "")}" placeholder="ครู / ครูชำนาญการ"></label>
    ${u.id ? `<label class="field">สถานะ<select name="status"><option value="active" ${u.status === "active" ? "selected" : ""}>ใช้งาน</option><option value="disabled" ${u.status !== "active" ? "selected" : ""}>ระงับการใช้งาน</option></select></label>`
      : `<label class="field">บทบาท<select name="role">${roleOpts("teacher")}</select></label>
         <label class="field">รหัสผ่านเริ่มต้น (ว่าง = ระบบสร้างให้)<input name="password" maxlength="100" autocomplete="new-password"></label>`}
    ${u.role === "viewer" ? `<label class="field">ผู้ชมใช้งานได้ถึง<input type="date" name="viewer_expires" value="${esc(u.viewer_expires || "")}"></label>` : ""}</div>`;
  document.getElementById("addUser").onclick = async () => {
    const r = await dialog({ title: "เพิ่มบัญชีผู้ใช้", body: form(), okText: "เพิ่ม" });
    if (!r.ok) return;
    try {
      const x = await api("/api/users", { method: "POST", body: { ...r.data, role: r.data.role || null } });
      toast("เพิ่มบัญชีแล้ว"); await render();
      if (x.password) showPassword(x.user, x.password);
    } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-edit]")) b.onclick = async () => {
    const u = byId(b.dataset.edit);
    const r = await dialog({ title: `แก้ไขบัญชี ${u.full_name}`, body: form(u) });
    if (!r.ok) return;
    try { await api(`/api/users/${u.id}`, { method: "PUT", body: r.data }); toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-pw]")) b.onclick = async () => {
    const u = byId(b.dataset.pw);
    const r = await dialog({ title: `ตั้งรหัสผ่านใหม่: ${u.full_name}`, okText: "ตั้งรหัสผ่าน",
      body: `<label class="field">รหัสผ่านใหม่ (ว่าง = ระบบสร้างให้)<input name="password" maxlength="100" autocomplete="new-password"></label><p class="muted small">ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์ และต้องเปลี่ยนรหัสผ่านเมื่อเข้าครั้งถัดไป</p>` });
    if (!r.ok) return;
    try { const x = await api(`/api/users/${u.id}/password`, { method: "POST", body: { password: r.data.password || "" } }); toast("ตั้งรหัสผ่านแล้ว"); if (x.password) showPassword(u, x.password); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-del]")) b.onclick = async () => {
    const u = byId(b.dataset.del);
    if (!(await confirmBox("ลบบัญชี", `ลบบัญชี ${esc(u.full_name)} — เข้าสู่ระบบไม่ได้อีก (ข้อมูลคะแนนและประวัติที่บันทึกไว้ยังอยู่) ถ้าแค่หยุดใช้ชั่วคราวให้ "แก้ไข → ระงับการใช้งาน" แทน`, "ลบบัญชี", true))) return;
    try { await api(`/api/users/${u.id}`, { method: "DELETE" }); toast("ลบแล้ว"); render(); } catch (err) { showError(err); }
  };
}

// ---------- ปีการศึกษาและภาคเรียน ----------
const thDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "–");
async function renderYears() {
  const { years } = await api("/api/setup/years");
  const termFields = (y = {}) => {
    const t = (n) => (y.terms || []).find((x) => x.term_number === n) || {};
    const ce = (y.year_be || defaultBe()) - 543;
    const d = (n, k, def) => esc(t(n)[k] || (y.id ? "" : def));
    return `<div class="form-grid">
      ${y.id ? "" : `<label class="field">ปีการศึกษา (พ.ศ.)<input name="year_be" inputmode="numeric" required value="${defaultBe()}" data-be></label>`}
      <label class="field">เปิดภาคเรียนที่ 1<input type="date" name="t1s" required value="${d(1, "start_date", `${ce}-05-16`)}"></label>
      <label class="field">ปิดภาคเรียนที่ 1<input type="date" name="t1e" required value="${d(1, "end_date", `${ce}-10-10`)}"></label>
      <label class="field">เปิดภาคเรียนที่ 2<input type="date" name="t2s" value="${d(2, "start_date", `${ce}-11-01`)}"></label>
      <label class="field">ปิดภาคเรียนที่ 2<input type="date" name="t2e" value="${d(2, "end_date", `${ce + 1}-03-31`)}"></label>
      ${y.id ? "" : `<label class="check"><input type="checkbox" name="activate"> ตั้งเป็นปีปัจจุบันทันที</label>`}</div>
      <p class="muted small">ภาคเรียนที่ 2 เว้นว่างได้ (ถ้าโรงเรียนรายงานผลปีละครั้ง) · ปีใหม่จะยกเกณฑ์ ชื่อโรงเรียน และผู้ลงนามจากปีก่อนให้อัตโนมัติ</p>`;
  };
  const termsOfForm = (d) => [{ term_number: 1, start_date: d.t1s, end_date: d.t1e }, ...(d.t2s && d.t2e ? [{ term_number: 2, start_date: d.t2s, end_date: d.t2e }] : [])];
  const STATUS = { active: '<span class="tag ok">ปีปัจจุบัน</span>', draft: '<span class="tag">เตรียมไว้</span>', closed: '<span class="tag">ปิดแล้ว</span>' };
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>ปีการศึกษา</h2><button class="btn primary" id="newYear">+ เพิ่มปีการศึกษา</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ปี</th><th>สถานะ</th><th>ภาคเรียนที่ 1</th><th>ภาคเรียนที่ 2</th><th class="num">นักเรียน</th><th class="num">รายวิชา</th><th></th></tr></thead>
    <tbody>${years.map((y) => { const t = (n) => y.terms.find((x) => x.term_number === n); return `<tr>
      <td><b>${y.year_be}</b></td><td>${STATUS[y.status] || esc(y.status)}</td>
      <td class="small">${t(1) ? `${thDate(t(1).start_date)} – ${thDate(t(1).end_date)}` : '<span class="tag warn">ยังไม่ตั้ง</span>'}</td>
      <td class="small">${t(2) ? `${thDate(t(2).start_date)} – ${thDate(t(2).end_date)}` : "–"}</td>
      <td class="num">${y.students}</td><td class="num">${y.subjects}</td>
      <td class="actions"><button class="btn small" data-yedit="${y.id}">แก้วันที่</button>${y.status !== "active" ? `<button class="btn small" data-yact="${y.id}">ตั้งเป็นปีปัจจุบัน</button>` : ""}
        ${!y.students && !y.subjects && years.length > 1 ? `<button class="btn small" data-ydel="${y.id}">ลบ</button>` : ""}</td></tr>`; }).join("")
      || '<tr><td colspan="7" class="empty">ยังไม่มีปีการศึกษา</td></tr>'}</tbody></table></div>
    <p class="muted small">ปีปัจจุบัน = ปีที่เปิดขึ้นมาเป็นค่าเริ่มต้นของทุกคน (เลือกดูปีอื่นได้ที่เมนูซ้าย)</p></div>
    ${years.length > 1 ? `<div class="panel"><div class="panel-head"><h2>เลื่อนชั้นนักเรียนขึ้นปีใหม่</h2></div>
      <p class="muted small">นักเรียนที่กำลังเรียนในปีต้นทางจะขึ้นชั้นถัดไปห้องเดิมในภาคเรียนแรกของปีปลายทาง (อ.3 → ป.1 · ป.6 = จบการศึกษา) · นักเรียนที่มีรายชื่อในปีปลายทางแล้วจะข้าม · ย้ายห้องรายคนได้ภายหลังที่เมนูนักเรียน</p>
      <form id="promoteForm" class="actions" style="flex-wrap:wrap;gap:8px">
        <label>จากปี<select name="from_year">${years.map((y, i) => `<option value="${y.id}" ${i === 1 ? "selected" : ""}>${y.year_be}</option>`).join("")}</select></label>
        <label>ไปปี<select name="to_year">${years.map((y, i) => `<option value="${y.id}" ${i === 0 ? "selected" : ""}>${y.year_be}</option>`).join("")}</select></label>
        <button class="btn primary">ตรวจรายการ</button></form><div id="promoteOut"></div></div>` : ""}
    <div class="panel"><div class="panel-head"><h2>ยกรายชื่อภาคเรียนที่ 1 ไปภาคเรียนที่ 2</h2><button class="btn" id="carryBtn">ยกรายชื่อปี ${me.year.year_be}</button></div>
      <p class="muted small">ไม่จำเป็นต้องทำ — ระบบใช้รายชื่อล่าสุดของปีอยู่แล้ว ใช้เฉพาะเมื่อต้องการบันทึกรายชื่อแยกรายภาค (ทำได้ครั้งเดียว ก่อนมีรายชื่อภาค 2)</p></div>`;
  const yearDialog = async (y) => {
    const r = await dialog({ title: y ? `แก้วันเปิด–ปิดภาคเรียน ปี ${y.year_be}` : "เพิ่มปีการศึกษา", body: termFields(y),
      onOpen: (d) => { const be = d.querySelector("[data-be]"); if (be) be.onchange = () => { const ce = Number(be.value) - 543; if (ce > 1900) { const set = (n, v) => { d.querySelector(`[name=${n}]`).value = v; }; set("t1s", `${ce}-05-16`); set("t1e", `${ce}-10-10`); set("t2s", `${ce}-11-01`); set("t2e", `${ce + 1}-03-31`); } }; } });
    if (!r.ok) return;
    try {
      if (y) await api(`/api/setup/years/${y.id}`, { method: "PUT", body: { terms: termsOfForm(r.data) } });
      else await api("/api/setup/years", { method: "POST", body: { year_be: Number(r.data.year_be), terms: termsOfForm(r.data), activate: !!r.data.activate } });
      toast("บันทึกแล้ว");
      if (!y && r.data.activate) { try { localStorage.removeItem("sr-year"); } catch { /* */ } location.href = "/admin.html#years"; location.reload(); }
      else render();
    } catch (err) { showError(err); }
  };
  document.getElementById("newYear").onclick = () => yearDialog(null);
  for (const b of view.querySelectorAll("[data-yedit]")) b.onclick = () => yearDialog(years.find((y) => y.id === Number(b.dataset.yedit)));
  for (const b of view.querySelectorAll("[data-yact]")) b.onclick = async () => {
    const y = years.find((x) => x.id === Number(b.dataset.yact));
    if (!(await confirmBox("ตั้งเป็นปีปัจจุบัน", `ทุกคนจะเปิดระบบมาที่ปีการศึกษา ${y.year_be} เป็นค่าเริ่มต้น`, "ตั้งเป็นปีปัจจุบัน"))) return;
    try { await api(`/api/setup/years/${y.id}/activate`, { method: "POST", body: {} }); try { localStorage.removeItem("sr-year"); } catch { /* */ } toast("ตั้งแล้ว"); location.href = `/admin.html?year=${y.id}#years`; } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-ydel]")) b.onclick = async () => {
    const y = years.find((x) => x.id === Number(b.dataset.ydel));
    if (!(await confirmBox("ลบปีการศึกษา", `ลบปีการศึกษา ${y.year_be} (ยังไม่มีนักเรียนและรายวิชา)`, "ลบ", true))) return;
    try { await api(`/api/setup/years/${y.id}`, { method: "DELETE" }); toast("ลบแล้ว"); if (y.id === Y) location.href = "/admin.html#years"; else render(); } catch (err) { showError(err); }
  };
  const pf = document.getElementById("promoteForm");
  if (pf) pf.onsubmit = async (e) => {
    e.preventDefault();
    const body = { from_year: Number(pf.from_year.value), to_year: Number(pf.to_year.value) };
    const out = document.getElementById("promoteOut");
    try {
      const r = await api("/api/setup/promote", { method: "POST", body: { ...body, dry_run: true } });
      out.innerHTML = `<p class="note">เลื่อนชั้น ${r.promote} คน · จบการศึกษา ${r.graduate} คน${r.skipped ? ` · มีรายชื่อในปีปลายทางแล้ว (ข้าม) ${r.skipped} คน` : ""}</p>
        ${r.rooms.length ? `<p class="small">${r.rooms.map((x) => `<span class="tag">${esc(x.room)} ${x.students} คน</span>`).join(" ")}</p>` : ""}
        ${r.promote + r.graduate ? `<button class="btn primary" id="promoteGo">ยืนยันเลื่อนชั้น</button>` : ""}`;
      const go = document.getElementById("promoteGo");
      if (go) go.onclick = async () => {
        go.disabled = true;
        try { const x = await api("/api/setup/promote", { method: "POST", body }); toast(`เลื่อนชั้น ${x.promote} คน · จบ ${x.graduate} คน`); render(); } catch (err) { go.disabled = false; showError(err); }
      };
    } catch (err) { showError(err); }
  };
  document.getElementById("carryBtn").onclick = async () => {
    if (!(await confirmBox("ยกรายชื่อไปภาคเรียนที่ 2", `คัดลอกรายชื่อนักเรียนที่กำลังเรียนในภาคเรียนที่ 1 ปี ${me.year.year_be} ไปภาคเรียนที่ 2 (ห้องเดิม)`, "ยกรายชื่อ"))) return;
    try { const r = await api("/api/setup/carry-term", { method: "POST", body: { year: Y } }); toast(`ยกรายชื่อ ${r.carried} คน`); } catch (err) { showError(err); }
  };
}
function defaultBe() { const d = new Date(); return d.getFullYear() + 543 - (d.getMonth() < 4 ? 1 : 0); }

// ---------- ตั้งค่าระบบ (ผู้ดูแลระบบ): ตราโรงเรียน · ขนาดฐานข้อมูล ----------
async function renderSystem() {
  const [sys, brand] = await Promise.all([api("/api/setup/system"), api("/api/setup/branding")]);
  const total = sys.tables.reduce((a, t) => a + (t.rows || 0), 0);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>ตราโรงเรียน</h2></div>
    <div class="actions" style="align-items:center;gap:16px"><img id="logoPrev" src="${esc(brand.logo || "/logo.png")}" alt="ตราโรงเรียน" style="width:96px;height:96px;object-fit:contain;border:1px solid var(--line);border-radius:12px;background:#fff">
      <div><label class="btn">เลือกรูปภาพ<input type="file" id="logoIn" accept="image/*" hidden></label> ${brand.logo ? '<button class="btn" id="logoDel">ใช้ตราเริ่มต้น</button>' : ""}
      <p class="muted small">ใช้บนเมนู หน้าเข้าสู่ระบบ และเอกสาร ปพ. — ระบบย่อรูปให้อัตโนมัติ (แนะนำภาพสี่เหลี่ยมจัตุรัส พื้นหลังโปร่งใส) · หน้าเว็บอาจแสดงตราเดิมอีกไม่เกิน 5 นาที</p></div></div></div>
    <div class="panel"><div class="panel-head"><h2>ฐานข้อมูล Cloudflare D1</h2><span class="muted small">${sys.tables.length} ตาราง · ${total.toLocaleString("th-TH")} แถว</span></div>
      <p class="muted small">ข้อมูลทั้งหมดอยู่ในฐานข้อมูล D1 ของโรงเรียนบน Cloudflare · สำรองเป็นไฟล์ได้ที่เมนู "สำรองและกู้คืนข้อมูล" · Cloudflare ย้อนข้อมูลกลับไปจุดเวลาใดก็ได้ใน 30 วันด้วย Time Travel (ในหน้า D1 ของ Cloudflare)</p>
      <details style="margin-top:8px"><summary class="small">จำนวนแถวรายตาราง</summary><div class="table-wrap"><table class="list"><thead><tr><th>ตาราง</th><th class="num">แถว</th></tr></thead>
        <tbody>${sys.tables.map((t) => `<tr><td class="small">${esc(t.name)}</td><td class="num">${t.rows ?? ""}</td></tr>`).join("")}</tbody></table></div></details></div>`;
  document.getElementById("logoIn").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const url = await shrinkImage(f);
      await api("/api/setup/branding", { method: "PUT", body: { logo: url } });
      toast("เปลี่ยนตราโรงเรียนแล้ว"); document.getElementById("logoPrev").src = url;
    } catch (err) { showError(err); }
  };
  const del = document.getElementById("logoDel");
  if (del) del.onclick = async () => { try { await api("/api/setup/branding", { method: "PUT", body: { logo: null } }); toast("ใช้ตราเริ่มต้นแล้ว"); render(); } catch (err) { showError(err); } };
}
// ย่อรูปให้ยาวไม่เกิน 512px แล้วลดคุณภาพจนขนาด data URL ≤ 250,000 ตัวอักษร
async function shrinkImage(file) {
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("อ่านไฟล์ภาพไม่ได้")); r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ")); i.src = src; });
  for (const size of [512, 384, 256, 200, 128]) {
    const k = Math.min(1, size / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");
    if (png.length <= 250000) return png;
    for (const qy of [0.9, 0.8, 0.7, 0.6]) { const w = c.toDataURL("image/webp", qy); if (w.startsWith("data:image/webp") && w.length <= 250000) return w; }
  }
  throw new Error("รูปภาพใหญ่เกินไป ลองใช้ภาพที่เรียบง่ายกว่านี้");
}

// ---------- อนุมัติผลการเรียน (ผู้บริหาร) ----------
// mode "review" = ฝ่ายวัดผลตรวจรายวิชาที่ครูส่ง · "approve" = ผู้บริหารอนุมัติรายวิชาที่ตรวจแล้ว
async function renderApprove(mode = "approve") {
  const { courses } = await api(`/api/admin/courses?${yq}`);
  const R = mode === "review";
  const waiting = courses.filter((c) => c.status === (R ? "submitted" : "reviewed"));
  const done = courses.filter((c) => (R ? ["reviewed", "approved"] : ["approved"]).includes(c.status));
  const later = R ? 0 : courses.filter((c) => c.status === "submitted").length;
  const verb = R ? "ตรวจแล้ว ส่งผู้บริหาร" : "อนุมัติ";
  const rooms = [...new Set(waiting.map((c) => `${c.grade_level}/${c.classroom}`))];
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>${R ? "รอฝ่ายวัดผลตรวจ" : "รอการอนุมัติ"} <span class="tag">${waiting.length} รายวิชา</span></h2>
      ${waiting.length ? `<div class="actions"><label class="check"><input type="checkbox" id="allChk"> เลือกทั้งหมด</label><button class="btn primary" id="approveSel" disabled>${verb}ที่เลือก</button></div>` : ""}</div>
    <p class="muted small">${R ? "เปิด ปพ.5 หรือหน้ารายวิชาเพื่อตรวจ แก้ได้เลยโดยไม่ต้องส่งคืน (ระบบบันทึกประวัติให้ครูเห็น) หรือส่งคืนพร้อมเหตุผลให้ครูแก้เอง"
      : `อนุมัติได้เฉพาะรายวิชาที่ฝ่ายวัดผลตรวจแล้ว${later ? ` · ยังรอฝ่ายวัดผลตรวจอีก ${later} รายวิชา` : ""}`}</p>
    ${waiting.length ? rooms.map((r) => `<h3 style="margin-top:14px">${esc(r)}</h3>
      <div class="table-wrap"><table class="list"><thead><tr><th style="width:36px"></th><th>รหัส</th><th>วิชา</th><th>ครูผู้สอน</th><th>${R ? "ส่งเมื่อ" : "ตรวจเมื่อ"}</th><th></th></tr></thead>
      <tbody>${waiting.filter((c) => `${c.grade_level}/${c.classroom}` === r).map((c) => `<tr>
        <td><input type="checkbox" class="pick" value="${c.id}" aria-label="เลือก ${esc(c.code)}" style="width:18px;height:18px;min-height:0"></td>
        <td>${esc(c.code)}</td><td><a href="/course.html?id=${c.id}&year=${Y}">${esc(c.name)}</a>${c.edit_count ? ` <span class="tag warn" title="ฝ่ายวัดผลแก้ไขหลังส่ง">แก้ ${c.edit_count}</span>` : ""}</td>
        <td class="small">${c.teachers.map((t) => esc(t.full_name)).join(", ")}</td><td class="small muted">${esc(thaiTime(R ? c.submitted_at : c.reviewed_at))}</td>
        <td class="actions"><a class="btn small" target="_blank" rel="noopener" href="/print/pp5.html?course=${c.id}">ตรวจ ปพ.5</a><button class="btn small" data-return="${c.id}">ส่งคืน</button></td></tr>`).join("")}</tbody></table></div>`).join("")
      : `<div class="empty"><strong>${R ? "ไม่มีรายวิชารอตรวจ" : "ไม่มีรายวิชารออนุมัติ"}</strong>${R ? "เมื่อครูส่งผลแล้ว รายวิชาจะขึ้นที่นี่" : "เมื่อฝ่ายวัดผลตรวจแล้ว รายวิชาจะขึ้นที่นี่"}</div>`}
  </div>
  <div class="panel"><div class="panel-head"><h2>${R ? "ตรวจแล้ว / อนุมัติแล้ว" : "อนุมัติแล้ว"} <span class="tag ok">${done.length}</span></h2></div>
    <p class="muted small">${R ? "รายวิชาที่ตรวจแล้วรอผู้บริหารอนุมัติ หรืออนุมัติแล้ว ถ้าฝ่ายวัดผลแก้คะแนนหลังอนุมัติ รายวิชาจะกลับมารอผู้บริหารอนุมัติใหม่ · ส่งคืนให้ครูแก้เองได้ทุกสถานะ" : "ถ้าฝ่ายวัดผลแก้ผลหลังอนุมัติ รายวิชาจะกลับมาขึ้นในรายการรออนุมัติอีกครั้ง"}</p>
    ${R && done.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>ห้อง</th><th>รหัส</th><th>วิชา</th><th>สถานะ</th><th></th></tr></thead><tbody>${done.map((c) => `<tr>
      <td>${esc(c.grade_level)}/${esc(c.classroom)}</td><td>${esc(c.code)}</td><td><a href="/course.html?id=${c.id}&year=${Y}">${esc(c.name)}</a></td><td>${statusTag(c)}</td>
      <td class="actions"><a class="btn small" target="_blank" rel="noopener" href="/print/pp5.html?course=${c.id}">ปพ.5</a><button class="btn small" data-return="${c.id}">ส่งคืน</button></td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
  for (const b of view.querySelectorAll("[data-return]")) b.onclick = async () => {
    const r = await dialog({ title: "ส่งคืนให้ครูแก้", okText: "ส่งคืน", okClass: "danger",
      body: `<label class="field">เหตุผล / สิ่งที่ต้องแก้ (ครูจะเห็นข้อความนี้)<textarea name="note" required minlength="3" maxlength="500"></textarea></label>` });
    if (!r.ok) return;
    try { await api(`/api/admin/courses/${b.dataset.return}/return`, { method: "POST", body: { note: r.data.note } }); toast("ส่งคืนแล้ว"); render(); } catch (err) { showError(err); }
  };
  const picks = () => [...view.querySelectorAll(".pick")];
  const sync = () => { const n = picks().filter((p) => p.checked).length; const b = document.getElementById("approveSel"); if (b) { b.disabled = !n; b.textContent = n ? `${verb}ที่เลือก (${n})` : `${verb}ที่เลือก`; } };
  for (const p of picks()) p.onchange = sync;
  const all = document.getElementById("allChk");
  if (all) all.onchange = () => { for (const p of picks()) p.checked = all.checked; sync(); };
  const btn = document.getElementById("approveSel");
  if (btn) btn.onclick = async () => {
    const ids = picks().filter((p) => p.checked).map((p) => Number(p.value));
    if (!(await confirmBox(R ? "ตรวจผลการเรียนแล้ว" : "อนุมัติผลการเรียน", `${verb} ${ids.length} รายวิชา`, R ? "ตรวจแล้ว" : "อนุมัติ"))) return;
    try {
      const r = await api(`/api/admin/courses/${R ? "review" : "approve"}`, { method: "POST", body: { course_ids: ids } });
      toast(R ? `ส่งต่อผู้บริหาร ${r.reviewed} รายวิชา` : `อนุมัติ ${r.approved} รายวิชา`); render();
    } catch (err) { showError(err); }
  };
}

// ---------- คำขอแก้ไขจากครู (หลังปิดการกรอก/ส่งผลแล้ว) ----------
async function renderRequests() {
  const { requests, grant_days } = await api(`/api/admin/edit-requests?${yq}`);
  const what = (r) => r.scope === "course"
    ? `<a href="/course.html?id=${r.course_id}&year=${Y}">${esc(r.code || "")} ${esc(r.subject_name || "")}</a> <span class="muted">${esc(r.grade_level)}/${esc(r.classroom)}</span>`
    : `<a href="/homeroom.html?grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}&year=${Y}">ข้อมูลครูประจำชั้น ${esc(r.grade_level)}/${esc(r.classroom)}</a>`;
  const STATUS = { approved: '<span class="tag ok">อนุมัติ</span>', rejected: '<span class="tag warn">ไม่อนุมัติ</span>', closed: '<span class="tag">ปิดสิทธิ์แล้ว</span>' };
  const pending = requests.filter((r) => r.status === "pending"), done = requests.filter((r) => r.status !== "pending");
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>รอพิจารณา <span class="tag">${pending.length}</span></h2></div>
    <p class="muted small">อนุมัติคำขอรายวิชา = ส่งคืนรายวิชาให้ครูแก้ (แก้ได้แม้ปิดการกรอก) แล้วครูต้องส่งผลใหม่ผ่านการตรวจและอนุมัติอีกครั้ง ·
      อนุมัติคำขอของครูประจำชั้น = เปิดให้แก้ข้อมูลของห้อง (มาเรียน คุณลักษณะฯ กิจกรรม ความเห็น น้ำหนักส่วนสูง คะแนนยกมา) ${grant_days} วัน</p>
    ${pending.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>ขอแก้</th><th>เหตุผล</th><th>ผู้ขอ</th><th>เมื่อ</th><th></th></tr></thead><tbody>
      ${pending.map((r) => `<tr><td>${what(r)}</td><td class="small">${esc(r.reason)}</td><td class="small">${esc(r.requested_by_name || "")}</td><td class="small muted">${esc(thaiTime(r.requested_at))}</td>
        <td class="actions"><button class="btn small primary" data-ok="${r.id}">อนุมัติ</button><button class="btn small" data-no="${r.id}">ไม่อนุมัติ</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><strong>ไม่มีคำขอรอพิจารณา</strong>เมื่อปิดการกรอกหรือส่งผลแล้ว ครูต้องส่งคำขอที่นี่ก่อนแก้</div>`}
  </div>
  ${done.length ? `<div class="panel"><div class="panel-head"><h2>พิจารณาแล้ว</h2></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ขอแก้</th><th>เหตุผล</th><th>ผู้ขอ</th><th>ผล</th><th></th></tr></thead><tbody>
    ${done.map((r) => `<tr><td>${what(r)}</td><td class="small">${esc(r.reason)}${r.decision_note ? `<br><span class="muted">ตอบ: ${esc(r.decision_note)}</span>` : ""}</td>
      <td class="small">${esc(r.requested_by_name || "")}</td>
      <td class="small">${STATUS[r.status] || ""} ${esc(r.decided_by_name || "")} ${esc(thaiTime(r.decided_at))}${r.active ? `<br>แก้ได้ถึง ${esc(thaiTime(r.open_until))}` : ""}</td>
      <td class="actions">${r.active ? `<button class="btn small" data-close="${r.id}">ปิดสิทธิ์แก้</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}`;
  const act = async (id, action, body) => {
    try { await api(`/api/admin/edit-requests/${id}/${action}`, { method: "POST", body }); toast(action === "approve" ? "อนุมัติแล้ว" : action === "reject" ? "แจ้งไม่อนุมัติแล้ว" : "ปิดสิทธิ์แล้ว"); render(); }
    catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-ok]")) b.onclick = async () => {
    const r = await dialog({ title: "อนุมัติคำขอแก้ไข", okText: "อนุมัติ",
      body: `<label class="field">หมายเหตุถึงครู (ไม่บังคับ)<textarea name="note" maxlength="500"></textarea></label>` });
    if (r.ok) act(b.dataset.ok, "approve", { note: r.data.note });
  };
  for (const b of view.querySelectorAll("[data-no]")) b.onclick = async () => {
    const r = await dialog({ title: "ไม่อนุมัติคำขอ", okText: "ไม่อนุมัติ", okClass: "danger",
      body: `<label class="field">เหตุผล (ครูจะเห็นข้อความนี้)<textarea name="note" required minlength="3" maxlength="500"></textarea></label>` });
    if (r.ok) act(b.dataset.no, "reject", { note: r.data.note });
  };
  for (const b of view.querySelectorAll("[data-close]")) b.onclick = async () => {
    if (await confirmBox("ปิดสิทธิ์แก้", "ครูประจำชั้นจะแก้ข้อมูลของห้องนี้ไม่ได้อีก จนกว่าจะส่งคำขอใหม่", "ปิดสิทธิ์")) act(b.dataset.close, "close", {});
  };
}

// ---------- ประวัติการใช้งาน ----------
const ACTION_TEXT = {
  "course.submit": "ส่งผลการเรียน", "edit_request.course": "ขอแก้ไขรายวิชา", "edit_request.homeroom": "ขอแก้ไขข้อมูลประจำชั้น",
  "edit_request.approve": "อนุมัติคำขอแก้ไข", "edit_request.reject": "ไม่อนุมัติคำขอแก้ไข", "edit_request.close": "ปิดสิทธิ์แก้", "course.return": "ส่งคืนให้ครูแก้", "course.reopen_approved": "ส่งคืนหลังอนุมัติ", "course.approve": "อนุมัติผล",
  "settings.update": "แก้เกณฑ์/ผู้ลงนาม", "pilot.set": "ตั้งห้องที่เปิดใช้", "import.subjects": "นำเข้ารายวิชา", "import.teachers": "นำเข้าครูผู้สอน",
  "import.homerooms": "นำเข้าครูประจำชั้น", "template.save": "บันทึกแม่แบบ", "template.apply": "ใช้แม่แบบ", "scores.remedial": "บันทึกคะแนนแก้ตัว",
  "results.update": "แก้เวลาเรียน/ผลพิเศษ", "items.add": "เพิ่มช่องคะแนน", "item.update": "แก้ช่องคะแนน", "item.delete": "ลบช่องคะแนน",
  "staff_role": "ให้/ถอนสิทธิ์ทีมวัดผล", "subject.create": "เพิ่มรายวิชา", "subject.update": "แก้รายวิชา", "subject.delete": "ลบรายวิชา",
};
async function renderAudit() {
  const { entries } = await api("/api/admin/audit");
  view.innerHTML = `<div class="panel"><div class="panel-head"><h2>200 รายการล่าสุด</h2><input type="search" id="auditQ" placeholder="ค้นหาชื่อหรือการกระทำ" style="max-width:260px"></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>เวลา (UTC)</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead>
    <tbody>${entries.map((e) => `<tr data-q="${esc(`${e.full_name || ""} ${ACTION_TEXT[e.action] || e.action}`)}"><td class="small nowrap">${esc(e.created_at)}</td><td>${esc(e.full_name || "–")}</td>
      <td>${esc(ACTION_TEXT[e.action] || e.action)}</td><td class="small muted" style="max-width:420px;word-break:break-word">${esc(String(e.detail || "").slice(0, 220))}</td></tr>`).join("")}</tbody></table></div></div>`;
  const q = document.getElementById("auditQ");
  q.oninput = () => { for (const tr of view.querySelectorAll("tbody tr")) tr.hidden = !tr.dataset.q.includes(q.value.trim()); };
}

renderTabs();
render();
