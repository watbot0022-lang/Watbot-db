// ระบบวัดโบสถ์ทำงานเดี่ยว: ติดตั้งครั้งแรกบนฐานข้อมูลว่าง · บัญชีผู้ใช้ · ปีการศึกษา · นำเข้า/ส่งออกครูและนักเรียน · เลื่อนชั้น
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";

const ORIGIN = "http://school.test";
async function client() {
  const env = await makeEnv({ fresh: true });
  const cookies = {};
  async function call(who, method, path, body, expect) {
    const headers = { "Content-Type": "application/json", Origin: ORIGIN };
    if (who && cookies[who]) headers.Cookie = cookies[who];
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const ck = res.headers.get("Set-Cookie");
    if (who && ck) cookies[who] = ck.split(";")[0];
    const data = await res.json().catch(() => null);
    if (expect !== undefined) assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    return { status: res.status, data };
  }
  return { env, call, cookies };
}

test("ติดตั้งครั้งแรก: ฐานข้อมูลว่าง → สร้างผู้ดูแลระบบ + ปีการศึกษาแรก · ตั้งซ้ำไม่ได้", async () => {
  const { env, call } = await client();
  assert.equal((await call(null, "GET", "/api/auth/status", null, 200)).data.needs_setup, true);
  await call("a", "POST", "/api/auth/setup", { email: "admin", full_name: "นายผู้ดูแล ระบบ", password: "short" }, 400);
  await call("a", "POST", "/api/auth/setup", { email: "admin", full_name: "นายผู้ดูแล ระบบ", password: "Admin12345", year_be: 2569 }, 200);
  assert.equal((await call(null, "GET", "/api/auth/status", null, 200)).data.needs_setup, false);
  await call("x", "POST", "/api/auth/setup", { email: "hacker", full_name: "แฮก เกอร์", password: "Admin12345" }, 409);
  const me = (await call("a", "GET", "/api/me", null, 200)).data;
  assert.equal(me.user.role, "superadmin");
  assert.equal(me.year.year_be, 2569);
  assert.equal(me.setup.terms, 2);
  assert.equal(me.settings.school_name, "โรงเรียนวัดโบสถ์ (ราษฎร์รังสฤษฏ์)");
  // คลังตัวชี้วัดชุดเริ่มต้นใส่ให้อัตโนมัติ
  assert.ok(env.DB.raw.prepare("SELECT COUNT(*) n FROM gr_indicator_bank").get().n > 900);
  // ทุกตารางที่ระบบใช้ถูกสร้าง
  for (const t of ["users", "students", "student_details", "student_enrollments", "academic_terms", "gr_courses", "viewer_accounts"]) {
    assert.ok(env.DB.raw.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
  }
});

test("บัญชีผู้ใช้: สมัครเอง · ผู้ดูแลกำหนดบทบาท · นำเข้าครู (รหัสเริ่มต้น → ต้องเปลี่ยน) · ระงับ/ลบ · ทีมวัดผลจำกัดสิทธิ์", async () => {
  const { call } = await client();
  await call("a", "POST", "/api/auth/setup", { email: "admin", full_name: "นายผู้ดูแล ระบบ", password: "Admin12345" }, 200);
  // สมัครเอง: เข้าสู่ระบบได้แต่ยังไม่มีสิทธิ์
  await call("r", "POST", "/api/auth/register", { email: "kru.new@gmail.com", full_name: "นางสาวครูใหม่ สมัครเอง", password: "Kru12345x" }, 200);
  assert.equal((await call("r", "GET", "/api/me")).status, 403);
  await call("r", "POST", "/api/auth/register", { email: "kru.new@gmail.com", full_name: "ซ้ำ ซ้ำซ้อน", password: "Kru12345x" }, 409);
  const kru = (await call("a", "GET", "/api/users", null, 200)).data.users.find((u) => u.email === "kru.new@gmail.com");
  assert.equal(kru.role, null);
  await call("a", "PUT", `/api/users/${kru.id}`, { role: "teacher" }, 200);
  assert.equal((await call("r", "GET", "/api/me", null, 200)).data.user.role, "teacher");
  await call("r", "GET", "/api/users", null, 403); // ครูทั่วไปจัดการบัญชีไม่ได้

  // นำเข้าครูจากแม่แบบ: ตรวจก่อน → บันทึก → ได้รหัสผ่านเริ่มต้น
  const rows = [
    { email: "somchai", full_name: "นายสมชาย ใจดี", position: "ครู", role: "ครู", team: "", password: "" },
    { email: "somsri@gmail.com", full_name: "นางสมศรี รักเรียน", position: "ครูชำนาญการ", role: "", team: "ใช่", password: "" },
    { email: "director", full_name: "นายผอ. ทดสอบ", position: "ผู้อำนวยการ", role: "ผู้บริหาร", team: "", password: "Director2569" },
  ];
  const bad = (await call("a", "POST", "/api/users/import", { rows: [...rows, { email: "x y", full_name: "", role: "หัวหน้า" }], dry_run: true }, 200)).data;
  assert.equal(bad.errors.length, 1);
  const dry = (await call("a", "POST", "/api/users/import", { rows, dry_run: true }, 200)).data;
  assert.deepEqual(dry.summary, { add: 3, update: 0 });
  const done = (await call("a", "POST", "/api/users/import", { rows }, 200)).data;
  assert.equal(done.created.length, 3);
  const pw = done.created.find((c) => c.email === "somchai").password;
  assert.match(pw, /^[a-z]{2}\d{6}$/);
  const login = (await call("sc", "POST", "/api/auth/login", { email: "somchai", password: pw }, 200)).data;
  assert.equal(login.must_change, true);
  assert.equal((await call("sc", "GET", "/api/me", null, 200)).data.user.must_change, true);
  await call("sc", "POST", "/api/auth/password", { current: pw, password: "Somchai2569" }, 200);
  assert.equal((await call("sc", "GET", "/api/me", null, 200)).data.user.must_change, false);
  await call("dir", "POST", "/api/auth/login", { email: "director", password: "Director2569" }, 200);
  assert.equal((await call("dir", "GET", "/api/me", null, 200)).data.user.role, "executive");
  // ทีมวัดผล (นำเข้าแล้วได้สิทธิ์): จัดการได้เฉพาะบัญชีครู
  const ssPw = done.created.find((c) => c.email === "somsri@gmail.com").password;
  await call("ss", "POST", "/api/auth/login", { email: "somsri@gmail.com", password: ssPw }, 200);
  const list = (await call("ss", "GET", "/api/users", null, 200)).data.users;
  const dir = list.find((u) => u.email === "director"), sc = list.find((u) => u.email === "somchai");
  await call("ss", "PUT", `/api/users/${dir.id}`, { full_name: "เปลี่ยน ชื่อ" }, 403);
  await call("ss", "PUT", `/api/users/${sc.id}`, { role: "superadmin" }, 403);
  await call("ss", "POST", `/api/users/${sc.id}/password`, {}, 200);
  // ตั้งรหัสผ่านใหม่ → ออกจากระบบทุกอุปกรณ์
  assert.equal((await call("sc", "GET", "/api/me")).status, 401);
  // ระงับบัญชี → ใช้ไม่ได้ทันที · ลบแล้วสร้างอีเมลเดิมใหม่ได้
  await call("dir", "GET", "/api/me", null, 200);
  await call("a", "PUT", `/api/users/${dir.id}`, { status: "disabled" }, 200);
  assert.equal((await call("dir", "GET", "/api/me")).status, 401);
  await call("a", "DELETE", `/api/users/${dir.id}`, null, 200);
  await call("a", "POST", "/api/users", { email: "director", full_name: "นายผอ. คนใหม่", role: "executive" }, 200);
  // ผู้ชมภายนอก
  const v = (await call("a", "POST", "/api/users", { email: "viewer1", full_name: "ผู้ชม ภายนอก", role: "viewer", viewer_expires: "2099-12-31" }, 200)).data;
  assert.equal(v.user.role, "viewer");
  await call("vw", "POST", "/api/auth/login", { email: "viewer1", password: v.password }, 200);
  assert.equal((await call("vw", "GET", "/api/me", null, 200)).data.user.role, "viewer");
  await call("vw", "GET", "/api/users", null, 403);
  // ส่งออกข้อมูลครู
  const ex = (await call("a", "GET", "/api/users/export", null, 200)).data.rows;
  assert.ok(ex.some((r) => r.email === "somsri@gmail.com" && r.team === "ใช่"));
  // อุปกรณ์ที่เข้าสู่ระบบ
  await call("a2", "POST", "/api/auth/login", { email: "admin", password: "Admin12345" }, 200);
  const ss = (await call("a", "GET", "/api/auth/sessions", null, 200)).data.sessions;
  assert.equal(ss.length, 2);
  assert.equal((await call("a", "POST", "/api/auth/sessions/revoke-others", {}, 200)).data.revoked, 1);
  assert.equal((await call("a2", "GET", "/api/me")).status, 401);
  await call("a", "GET", "/api/me", null, 200);
});

test("ปีการศึกษา + นักเรียน: นำเข้า (ห้องใหม่ วันเกิด พ.ศ. ข้อมูลผู้ปกครอง) · ส่งออก · เลื่อนชั้นปีใหม่", async () => {
  const { env, call } = await client();
  await call("a", "POST", "/api/auth/setup", { email: "admin", full_name: "นายผู้ดูแล ระบบ", password: "Admin12345", year_be: 2569 }, 200);
  const y1 = (await call("a", "GET", "/api/me", null, 200)).data.year.id;
  const rows = [
    { student_code: "00101", name_prefix: "เด็กชาย", first_name: "ก้อง", last_name: "ใจดี", gender: "ช", national_id: "1234567890123", birth_date: "31/05/2562", room: "อ.3/1", guardian_first_name: "แม่ก้อง", province: "ราชบุรี" },
    { student_code: "00102", name_prefix: "เด็กหญิง", first_name: "ขวัญ", last_name: "ดีงาม", birth_date: "2018-01-15", room: "ป.6/1" },
    { student_code: "00103", name_prefix: "เด็กหญิง", first_name: "จันทร์", last_name: "สว่าง", room: "ป4/2" },
  ];
  const bad = (await call("a", "POST", `/api/roster/import?year=${y1}`, { rows: [{ ...rows[0], birth_date: "31/13/2562" }, { ...rows[1], room: "ม.1/1" }], dry_run: true }, 200)).data;
  assert.equal(bad.errors.length, 2);
  await call("a", "POST", `/api/roster/import?year=${y1}`, { rows }, 200);
  const st = env.DB.raw.prepare("SELECT student_code, birth_date FROM students ORDER BY student_code").all();
  assert.deepEqual(st.map((s) => [s.student_code, s.birth_date]), [["00101", "2019-05-31"], ["00102", "2018-01-15"], ["00103", null]]);
  const ex = (await call("a", "GET", `/api/roster/export?year=${y1}`, null, 200)).data.students;
  assert.deepEqual(ex.map((s) => s.room), ["อ.3/1", "ป.4/2", "ป.6/1"]);
  assert.equal(ex[0].guardian_first_name, "แม่ก้อง");
  assert.equal(ex[0].province, "ราชบุรี");
  // ปีใหม่ + เลื่อนชั้น (อ.3 → ป.1 · ป.6 จบ)
  await call("a", "POST", "/api/setup/years", { year_be: 2569, terms: [{ term_number: 1, start_date: "2026-05-16", end_date: "2026-10-10" }] }, 409);
  await call("a", "POST", "/api/setup/years", { year_be: 2570, terms: [{ term_number: 1, start_date: "2027-05-16", end_date: "2027-10-10" }, { term_number: 2, start_date: "2027-11-01", end_date: "2028-03-31" }] }, 200);
  const years = (await call("a", "GET", "/api/setup/years", null, 200)).data.years;
  const y2 = years.find((y) => y.year_be === 2570).id;
  assert.equal(years.find((y) => y.id === y1).students, 3);
  const dry = (await call("a", "POST", "/api/setup/promote", { from_year: y1, to_year: y2, dry_run: true }, 200)).data;
  assert.equal(dry.promote, 2); assert.equal(dry.graduate, 1);
  await call("a", "POST", "/api/setup/promote", { from_year: y1, to_year: y2 }, 200);
  const rooms = (await call("a", "GET", `/api/admin/rooms?year=${y2}`, null, 200)).data.rooms.map((r) => `${r.grade_level}/${r.classroom}`);
  assert.deepEqual(rooms, ["ป.1/1", "ป.5/2"]);
  assert.equal(env.DB.raw.prepare("SELECT status FROM students WHERE student_code='00102'").get().status, "graduated");
  assert.equal((await call("a", "POST", "/api/setup/promote", { from_year: y1, to_year: y2, dry_run: true }, 200)).data.skipped, 2);
  // ตั้งปีปัจจุบัน · ลบปีที่มีนักเรียนไม่ได้
  await call("a", "POST", `/api/setup/years/${y2}/activate`, {}, 200);
  assert.equal((await call("a", "GET", "/api/me", null, 200)).data.year.year_be, 2570);
  await call("a", "DELETE", `/api/setup/years/${y2}`, null, 409);
  // แก้วันภาคเรียน
  await call("a", "PUT", `/api/setup/years/${y2}`, { terms: [{ term_number: 1, start_date: "2027-05-17", end_date: "2027-10-09" }, { term_number: 2, start_date: "2027-10-01", end_date: "2028-03-31" }] }, 400);
  await call("a", "PUT", `/api/setup/years/${y2}`, { terms: [{ term_number: 1, start_date: "2027-05-17", end_date: "2027-10-09" }, { term_number: 2, start_date: "2027-11-02", end_date: "2028-03-31" }] }, 200);
});

test("ตราโรงเรียน: ผู้ดูแลอัปโหลดแล้ว /logo.png เป็นรูปใหม่", async () => {
  const { env, call } = await client();
  await call("a", "POST", "/api/auth/setup", { email: "admin", full_name: "นายผู้ดูแล ระบบ", password: "Admin12345" }, 200);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await call("a", "PUT", "/api/setup/branding", { logo: "data:text/html;base64,PGgxPg==" }, 400);
  await call("a", "PUT", "/api/setup/branding", { logo: png }, 200);
  const res = await worker.fetch(new Request(ORIGIN + "/logo.png"), env);
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.equal((await res.arrayBuffer()).byteLength, 70);
});
