// กิจกรรมพัฒนาผู้เรียน (ปพ.5.1): ครูประจำชั้นและฝ่ายวิชาการบันทึกในหน้าเดียว — ผลขึ้น ปพ.6 อัตโนมัติ
// กิจกรรมและตัวชี้วัด ฝ่ายวัดผลกำหนดรายปี + ระดับชั้น (?setup=1) · บันทึก ผ/มผ รายตัวชี้วัด รายภาค
// กิจกรรมผ่านเมื่อผ่านเวลาเรียนและผ่านทุกตัวชี้วัด (ยังไม่มีตัวชี้วัด = ใช้ช่อง "จุดประสงค์") · ผลทั้งปีผ่านเมื่อผ่านทั้ง 2 ภาค
import { shell, api, esc, showError, params, editGate, dialog, confirmBox, toast, ICONS } from "/js/app.js";
import { activityKey, activityIndicatorKey, activityResult } from "/js/grading.js";

const me = await shell("activities");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
const T = me.term === 1 ? 1 : 2;
const Y = me.year.id;
const SCOPE = me.role === "teacher" ? "&scope=teacher" : ""; // บทบาทครู: เห็นเฉพาะห้องที่เป็นครูประจำชั้น
const SETUP = params().get("setup") === "1";
document.getElementById("yearLine").textContent = SETUP
  ? `ปีการศึกษา ${me.year.year_be} · ตั้งกิจกรรมและตัวชี้วัดแยกรายระดับชั้น (ฝ่ายวัดผล)`
  : `ปีการศึกษา ${me.year.year_be} · ภาคเรียนที่ ${T} · ทุกคนผ่านเป็นค่าเริ่มต้น เอาเครื่องหมายออกเฉพาะคนที่ไม่ผ่าน · `
    + (T === 1 ? "ผลภาค 1 ขึ้นใน ปพ.6 ภาคเรียนที่ 1 · สรุปผลทั้งปีที่ภาคเรียนที่ 2" : "ผลทั้งปีต้องผ่านทั้งภาคเรียนที่ 1 และ 2 · ขึ้นใน ปพ.6 อัตโนมัติ");

let meta;
if (SETUP) { await setupPage(); throw new Error("setup"); }
try { meta = await api(`/api/activities?year=${Y}${SCOPE}`); }
catch (err) { view.innerHTML = `<div class="panel empty"><strong>เปิดไม่ได้</strong>${esc(err.message)}</div>`; throw err; }
const setupLink = meta.can_setup ? `<a class="btn small" href="/activities.html?setup=1">ตั้งกิจกรรม/ตัวชี้วัด</a>` : "";
if (!meta.rooms.length) {
  view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีห้องที่บันทึกได้</strong>หน้านี้สำหรับครูประจำชั้นและฝ่ายวิชาการ<br>${setupLink}</div>`;
  throw new Error("no rooms");
}
const key = (r) => `${r.grade_level}/${r.classroom}`;
let room = params().get("room") || sessionStorage.getItem("sr-act-room");
if (!meta.rooms.some((r) => key(r) === room)) room = key(meta.rooms[0]);
const pending = new Map(); // "ห้อง|sid|item_key" → "" | "มผ" (เก็บห้องไว้ในคีย์ — เปลี่ยนห้องระหว่างบันทึกแล้วไม่ส่งผิดห้อง)
let saving = false, timer, d, gate;

async function load() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  const [g, r] = room.split("/");
  d = await api(`/api/activities?year=${Y}${SCOPE}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(r)}`);
  const reqPath = `/api/homeroom/edit-request?year=${Y}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(r)}`;
  if (gate) gate.update(d.edit, reqPath); else gate = editGate(view, d.edit, reqPath);
  draw();
}

// ช่องบันทึกของกิจกรรมในภาค t: เวลาเรียน + ตัวชี้วัดแต่ละข้อ (ยังไม่มีตัวชี้วัด = จุดประสงค์)
const cols = (a, t) => [{ key: activityKey(a.key, "t", t), label: "เวลาเรียน", title: "เวลาเรียน" },
  ...(a.indicators.length ? a.indicators.map((i, n) => ({ key: activityIndicatorKey(a.key, i.id, t), label: `ตช.${n + 1}`, title: i.label }))
    : [{ key: activityKey(a.key, "o", t), label: "จุดประสงค์", title: "จุดประสงค์" }])];
// t = ภาค (1/2) หรือ null = ทั้งปี (ต้องผ่านทั้ง 2 ภาค)
const actResult = (s, a, t) => activityResult(a.key, s.values, t, a.indicators.map((i) => i.id));
const result = (s, t) => d.activities.some((a) => actResult(s, a, t) === "มผ") ? "มผ" : "ผ";
const RF = T === 2 ? null : 1; // ผลที่นับ "ไม่ผ่าน" ในแถบด้านบน: ภาค 1 = ผลภาค 1 · ภาค 2 = ผลทั้งปี
const short = (v) => v === "ผ" ? "ผ" : '<b style="color:var(--bad)">มผ</b>';
const long = (v) => v === "ผ" ? "ผ่าน" : '<b style="color:var(--bad)">ไม่ผ่าน</b>';
const countText = (act) => `${act.length} คน · ไม่ผ่าน${T === 2 ? "ทั้งปี" : "ภาค 1"} ${act.filter((x) => result(x, RF) === "มผ").length} คน`;

function draw() {
  const active = d.students.filter((s) => s.enrollment_status === "enrolled");
  const per = (a) => cols(a, T).length + (T === 2 ? 2 : 1); // ภาค 2: ผลภาค 1 + ช่องภาค 2 + ทั้งปี
  const [pg, pr] = room.split("/");
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${meta.rooms.length > 1 ? meta.rooms.map((r) => `<button class="btn small ${key(r) === room ? "primary" : ""}" data-room="${esc(key(r))}">${esc(key(r))}</button>`).join("") : `<b>${esc(room)}</b>`}
        <span class="muted small" id="actCount">${countText(active)}</span></span>
      <span class="actions"><a class="btn small" target="_blank" rel="noopener" href="/print/pp51.html?year=${Y}&grade=${encodeURIComponent(pg)}&room=${encodeURIComponent(pr)}&term=${T}${SCOPE}">${ICONS.print} ปพ.5.1 ภาค ${T}</a>${setupLink}</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead>
        <tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
          ${d.activities.map((a) => `<th class="col-head" colspan="${per(a)}"><span class="t">${esc(a.label)}</span></th>`).join("")}
          ${T === 2 ? '<th class="col-head" rowspan="2">สรุป<br>ภาค 1</th><th class="col-head" rowspan="2">สรุป<br>ภาค 2</th><th class="col-head" rowspan="2">สรุป<br>ทั้งปี</th>' : '<th class="col-head" rowspan="2">สรุป<br>ภาค 1</th>'}</tr>
        <tr>${d.activities.map((a) => (T === 2 ? '<th class="col-head small">ภาค 1</th>' : "") + cols(a, T).map((p) => `<th class="col-head small" title="${esc(p.title)}">${esc(p.label)}${T === 2 ? "<br>ภาค 2" : ""}</th>`).join("")
          + `<th class="col-head small">${T === 2 ? "ทั้งปี" : "ผล"}</th>`).join("")}</tr>
      </thead>
      <tbody>${d.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${d.activities.map((a) => (T === 2 ? `<td class="calc small" title="ผลภาคเรียนที่ 1">${short(actResult(s, a, 1))}</td>` : "")
          + cols(a, T).map((p) => { const k = p.key; const ok = s.values[k] !== "มผ";
          return `<td class="chk-cell ${ok ? "" : "fail"}"><input type="checkbox" data-key="${k}" ${ok ? "checked" : ""} aria-label="${esc(s.name)} ${esc(a.label)} ${esc(p.title)} ภาค ${T}"></td>`; }).join("")
          + `<td class="calc small" data-act="${a.key}">${short(actResult(s, a, RF))}</td>`).join("")}
        ${T === 2 ? `<td class="calc">${long(result(s, 1))}</td><td class="calc" data-sum2>${long(result(s, 2))}</td>` : ""}<td class="calc" data-sum>${long(result(s, RF))}</td></tr>`).join("")}</tbody>
    </table></div>
    ${d.activities.some((a) => a.indicators.length) ? `<div class="panel" style="margin-top:10px"><b>ตัวชี้วัด</b>${d.activities.filter((a) => a.indicators.length).map((a) =>
      `<div class="small" style="margin-top:6px"><b>${esc(a.label)}</b><ol style="margin:2px 0 0 18px;padding:0">${a.indicators.map((i) => `<li>${esc(i.label)}</li>`).join("")}</ol></div>`).join("")}</div>` : ""}
    <p class="muted small" style="margin-top:10px">ช่องมีเครื่องหมาย = ผ่าน · แต่ละกิจกรรมผ่านเมื่อผ่านเวลาเรียนและผ่านทุกตัวชี้วัด (ตช.) ·
      ${T === 2 ? "ผลทั้งปีผ่านเมื่อผ่านทั้งภาคเรียนที่ 1 และภาคเรียนที่ 2 (แก้ผลภาค 1 ได้ที่ภาคเรียนที่ 1)" : "ผลทั้งปีสรุปที่ภาคเรียนที่ 2 (ต้องผ่านทั้ง 2 ภาค)"} · บันทึกอัตโนมัติ</p>`;
  for (const b of view.querySelectorAll("[data-room]")) b.onclick = async () => {
    await flush();
    for (let i = 0; i < 100 && (saving || pending.size); i++) { await new Promise((ok) => setTimeout(ok, 100)); if (!saving && pending.size) await flush(); }
    if (pending.size) { showError("ยังบันทึกห้องเดิมไม่สำเร็จ — กดลองใหม่ก่อนเปลี่ยนห้อง"); return; }
    room = b.dataset.room; sessionStorage.setItem("sr-act-room", room); load().catch(showError);
  };
  document.getElementById("sheet").addEventListener("change", (e) => {
    const box = e.target;
    if (!box.dataset.key) return;
    const tr = box.closest("tr"), sid = Number(tr.dataset.sid), s = d.students.find((x) => x.id === sid);
    const value = box.checked ? "" : "มผ";
    if (value) s.values[box.dataset.key] = value; else delete s.values[box.dataset.key];
    box.parentElement.classList.toggle("fail", !box.checked);
    const a = d.activities.find((x) => cols(x, T).some((c) => c.key === box.dataset.key));
    tr.querySelector(`[data-act="${a.key}"]`).innerHTML = short(actResult(s, a, RF));
    tr.querySelector("[data-sum]").innerHTML = long(result(s, RF));
    if (T === 2) tr.querySelector("[data-sum2]").innerHTML = long(result(s, 2));
    document.getElementById("actCount").textContent = countText(d.students.filter((x) => x.enrollment_status === "enrolled"));
    pending.set(`${room}|${sid}|${box.dataset.key}`, value);
    state(); clearTimeout(timer); timer = setTimeout(flush, 600);
  });
}

async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const batch = [...pending.entries()];
  pending.clear(); state();
  const byRoom = {};
  for (const [k, v] of batch) { const [rm, sid, item_key] = k.split("|"); (byRoom[rm] ||= []).push({ k, v, change: { student_id: Number(sid), item_key, value: v } }); }
  let failed = null;
  for (const [rm, list] of Object.entries(byRoom)) {
    const [g, r] = rm.split("/");
    try { await api(`/api/activities?year=${Y}${SCOPE}`, { method: "PUT", body: { grade: g, room: r, term: T, changes: list.map((x) => x.change) } }); }
    catch (err) {
      failed = err;
      if (err.status >= 500 || !err.status) for (const x of list) if (!pending.has(x.k)) pending.set(x.k, x.v); // เครือข่าย: เก็บไว้ลองใหม่
      else showError(`${rm}: ${err.message} — รายการนี้ไม่ถูกบันทึก`);
    }
  }
  saving = false;
  if (failed && pending.size) { state(failed); showError(failed); return; }
  state();
  if (pending.size) flush();
}
function state(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.textContent = "บันทึกไม่สำเร็จ"; }
  else if (saving || pending.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else el.textContent = "บันทึกแล้ว";
}
window.addEventListener("beforeunload", (e) => { if (pending.size || saving) { e.preventDefault(); e.returnValue = ""; } });
load().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });

// ---------- ฝ่ายวัดผล: ตั้งกิจกรรมและตัวชี้วัด รายปี + ระดับชั้น ----------
async function setupPage() {
  let S, grade = sessionStorage.getItem("sr-act-setup-grade") || "ป.1";
  const call = async (method, path, body) => { S = { ...S, ...(await api(`/api/activities/setup${path}?year=${Y}`, { method, body })) }; draw(); };
  const draw = () => {
    const list = S.activities[grade] || [], can = S.can_edit;
    view.innerHTML = `<div class="panel">
      <div class="panel-head"><h2>กิจกรรมพัฒนาผู้เรียน ปีการศึกษา ${me.year.year_be}</h2><a class="btn small" href="/activities.html">กลับไปหน้าบันทึกผล</a></div>
      <div class="actions" style="margin-bottom:10px">${S.grades.map((g) => `<button class="btn small ${g === grade ? "primary" : ""}" data-grade="${g}">${g}</button>`).join("")}</div>
      <p class="muted small">ครูบันทึก ผ่าน/ไม่ผ่าน รายตัวชี้วัด รายภาค · กิจกรรมผ่านเมื่อผ่านเวลาเรียนและทุกตัวชี้วัด · ยังไม่มีตัวชี้วัด = ประเมินช่อง "จุดประสงค์" ช่องเดียว
        · ปีใหม่คัดลอกรายการจากปีก่อนอัตโนมัติ · ลบกิจกรรม/ตัวชี้วัดแล้ว ผลที่บันทึกไว้ของรายการนั้นไม่นำมาคิด</p>
      ${list.length ? list.map((a, n) => `<div class="panel" style="margin-top:10px" data-act="${a.id}">
        <div class="panel-head"><h3 style="margin:0">${n + 1}. ${esc(a.label)}</h3>${can ? `<span class="actions">
          <button class="btn small" data-edit="${a.id}">แก้ชื่อ/ลำดับ</button><button class="btn small danger" data-del="${a.id}">ลบกิจกรรม</button></span>` : ""}</div>
        ${a.indicators.length ? `<table class="list"><thead><tr><th style="width:60px">ข้อ</th><th>ตัวชี้วัด</th>${can ? "<th></th>" : ""}</tr></thead><tbody>${a.indicators.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.label)}</td>
          ${can ? `<td class="actions"><button class="btn small" data-iedit="${i.id}">แก้ไข</button><button class="btn small danger" data-idel="${i.id}">ลบ</button></td>` : ""}</tr>`).join("")}</tbody></table>`
          : '<p class="muted small">ยังไม่มีตัวชี้วัด (ประเมินช่องจุดประสงค์)</p>'}
        ${can ? `<button class="btn small" data-iadd="${a.id}">+ เพิ่มตัวชี้วัด</button>` : ""}</div>`).join("")
        : `<div class="empty"><strong>${grade} ยังไม่มีกิจกรรม</strong></div>`}
      ${can ? `<div class="actions" style="margin-top:12px"><button class="btn primary" id="addAct">+ เพิ่มกิจกรรม ${grade}</button><button class="btn" id="copyAct">คัดลอกรายการ ${grade} ไปชั้นอื่น</button></div>` : ""}
    </div>`;
    const find = (id) => list.find((a) => a.id === Number(id));
    const findInd = (id) => list.flatMap((a) => a.indicators.map((i) => ({ ...i, act: a }))).find((i) => i.id === Number(id));
    const form = (label, value = "", order = "") => `<label class="field">${label}<input name="v" required maxlength="200" value="${esc(value)}"></label>
      <label class="field" style="margin-top:10px">ลำดับ<input name="o" inputmode="numeric" value="${order}" placeholder="ว่าง = ต่อท้าย/คงเดิม"></label>`;
    const run = (p) => p.then(() => toast("บันทึกแล้ว")).catch(showError);
    for (const b of view.querySelectorAll("[data-grade]")) b.onclick = () => { grade = b.dataset.grade; sessionStorage.setItem("sr-act-setup-grade", grade); draw(); };
    const add = document.getElementById("addAct");
    if (add) add.onclick = async () => { const r = await dialog({ title: `เพิ่มกิจกรรม ${grade}`, body: form("ชื่อกิจกรรม"), okText: "เพิ่ม" }); if (r.ok) run(call("POST", "", { grade, name: r.data.v, sort_order: r.data.o })); };
    const copy = document.getElementById("copyAct");
    if (copy) copy.onclick = async () => {
      const r = await dialog({ title: `คัดลอกกิจกรรมของ ${grade}`, okText: "คัดลอก",
        body: `<p class="note warn">รายการกิจกรรมและตัวชี้วัดของชั้นที่เลือกจะถูกแทนที่ด้วยของ ${grade} — ผลรายตัวชี้วัดที่ครูบันทึกไว้ในชั้นนั้นไม่นำมาคิด</p>
          ${S.grades.filter((g) => g !== grade).map((g) => `<label class="check"><input type="checkbox" name="to_${g}"> ${g}</label>`).join(" ")}` });
      if (!r.ok) return;
      const to = Object.keys(r.data).filter((k) => k.startsWith("to_")).map((k) => k.slice(3));
      if (to.length) run(call("POST", "/copy", { from: grade, to }));
    };
    for (const b of view.querySelectorAll("[data-edit]")) b.onclick = async () => {
      const a = find(b.dataset.edit); const r = await dialog({ title: "แก้ไขกิจกรรม", body: form("ชื่อกิจกรรม", a.label, a.sort_order) });
      if (r.ok) run(call("PUT", `/${a.id}`, { name: r.data.v, sort_order: r.data.o }));
    };
    for (const b of view.querySelectorAll("[data-del]")) b.onclick = async () => {
      const a = find(b.dataset.del);
      if (await confirmBox("ลบกิจกรรม", `ลบ <b>${esc(a.label)}</b> ของ ${grade} พร้อมตัวชี้วัด ${a.indicators.length} ข้อ — ไม่ขึ้นในหน้าบันทึกผลและ ปพ.6 อีก`, "ลบ", true)) run(call("DELETE", `/${a.id}`));
    };
    for (const b of view.querySelectorAll("[data-iadd]")) b.onclick = async () => {
      const a = find(b.dataset.iadd); const r = await dialog({ title: `เพิ่มตัวชี้วัด: ${a.label}`, body: form("ตัวชี้วัด"), okText: "เพิ่ม" });
      if (r.ok) run(call("POST", `/${a.id}/indicators`, { label: r.data.v, sort_order: r.data.o }));
    };
    for (const b of view.querySelectorAll("[data-iedit]")) b.onclick = async () => {
      const i = findInd(b.dataset.iedit); const r = await dialog({ title: `แก้ไขตัวชี้วัด: ${i.act.label}`, body: form("ตัวชี้วัด", i.label, i.sort_order) });
      if (r.ok) run(call("PUT", `/indicators/${i.id}`, { label: r.data.v, sort_order: r.data.o }));
    };
    for (const b of view.querySelectorAll("[data-idel]")) b.onclick = async () => {
      const i = findInd(b.dataset.idel);
      if (await confirmBox("ลบตัวชี้วัด", `ลบ "${esc(i.label)}" ของ ${esc(i.act.label)} (${grade}) — ผลที่บันทึกไว้ของข้อนี้ไม่นำมาคิด`, "ลบ", true)) run(call("DELETE", `/indicators/${i.id}`));
    };
  };
  try { S = await api(`/api/activities/setup?year=${Y}`); draw(); }
  catch (err) { view.innerHTML = `<div class="panel empty"><strong>เปิดไม่ได้</strong>${esc(err.message)}</div>`; }
}
