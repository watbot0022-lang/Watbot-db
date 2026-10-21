import { buildClearCookie, buildSessionCookie, signJWT, verifyPassword, hashPassword, generateSalt } from "../lib/crypto.js";
import { json, readJson, fail, currentUser, text, audit } from "../lib/http.js";
import { createSession, revokeSession, revokeAllSessions, listSessions, alertLockout, lockedNow, verifyTurnstile, TURNSTILE_ERROR } from "../lib/auth-sessions.js";

// เข้าสู่ระบบด้วยอีเมลหรือชื่อผู้ใช้ (บัญชีในตาราง users ของระบบนี้)
// ใช้กติกาล็อกบัญชีชุดเดียวกัน: ผิด 5 ครั้งใน 15 นาที → รอ 15 นาที
export async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) fail(400, "กรุณากรอกอีเมล/ชื่อผู้ใช้ และรหัสผ่าน");
  if (!(await verifyTurnstile(env, body.turnstile_token, request)).ok) fail(400, TURNSTILE_ERROR);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const throttleKey = `${email}|${ip}`.slice(0, 500);
  const throttle = await env.DB.prepare("SELECT locked_until FROM auth_login_throttles WHERE throttle_key = ?").bind(throttleKey).first();
  if (throttle?.locked_until && new Date(`${throttle.locked_until.replace(" ", "T")}Z`).getTime() > Date.now()) {
    return json({ error: "มีการลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่" }, 429, { "Retry-After": "900" });
  }

  const user = await env.DB.prepare(
    "SELECT id, full_name, role, status, password_hash, password_salt, session_version, must_change FROM users WHERE email = ? AND deleted_at IS NULL"
  ).bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    await recordFailure(env, throttleKey);
    if (await lockedNow(env, throttleKey)) await alertLockout(env, email, request, "grades");
    return json({ error: "อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง" }, 401);
  }
  if (user.status !== "active") return json({ error: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" }, 403);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_login_throttles WHERE throttle_key = ?").bind(throttleKey),
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
  ]);
  const session = await createSession(env, user.id, request, "grades");
  const token = await signJWT({ sub: user.id, sv: Number(user.session_version || 1), sid: session.sid }, env.JWT_SECRET);
  return json({ ok: true, must_change: !!user.must_change, user: { id: user.id, full_name: user.full_name, role: user.role } }, 200, { "Set-Cookie": buildSessionCookie(token) });
}

async function recordFailure(env, key) {
  await env.DB.prepare(`INSERT INTO auth_login_throttles (throttle_key, failure_count, first_failed_at, last_failed_at, locked_until)
    VALUES (?, 1, datetime('now'), datetime('now'), NULL)
    ON CONFLICT(throttle_key) DO UPDATE SET
      failure_count = CASE WHEN first_failed_at < datetime('now','-15 minutes') THEN 1 ELSE failure_count + 1 END,
      first_failed_at = CASE WHEN first_failed_at < datetime('now','-15 minutes') THEN datetime('now') ELSE first_failed_at END,
      last_failed_at = datetime('now'),
      locked_until = CASE WHEN (CASE WHEN first_failed_at < datetime('now','-15 minutes') THEN 1 ELSE failure_count + 1 END) >= 5
        THEN datetime('now','+15 minutes') ELSE NULL END`).bind(key).run();
}

export async function logout(request, env) {
  const user = request && env ? await currentUser(request, env).catch(() => null) : null;
  if (user?.session_id) await revokeSession(env, user.session_id, user.id, "logout").catch(() => {});
  return json({ ok: true }, 200, { "Set-Cookie": buildClearCookie() });
}

// ---------- วัดโบสถ์: ระบบบัญชีผู้ใช้ของตัวเอง (ป่าเด็งใช้บัญชีจากระบบบริหารโรงเรียน) ----------
export const normEmail = (v) => String(v || "").trim().toLowerCase();
// อีเมล หรือชื่อผู้ใช้ภาษาอังกฤษ (ตัวอักษร ตัวเลข . _ -) อย่างน้อย 3 ตัว
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || /^[a-z0-9._-]{3,60}$/.test(e);
export function checkPasswordStrength(pw) {
  const s = String(pw || "");
  if (s.length < 8 || !/[A-Za-z]/.test(s) || !/\d/.test(s)) fail(400, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข");
  if (s.length > 100) fail(400, "รหัสผ่านยาวเกินไป");
}
export async function passwordFields(pw) {
  const salt = generateSalt();
  return { password_salt: salt, password_hash: await hashPassword(String(pw), salt) };
}
const signIn = async (env, request, user) => {
  const session = await createSession(env, user.id, request, "grades");
  return signJWT({ sub: user.id, sv: Number(user.session_version || 1), sid: session.sid }, env.JWT_SECRET);
};
const hasUsers = async (env) => !!(await env.DB.prepare("SELECT 1 AS x FROM users WHERE deleted_at IS NULL LIMIT 1").first());

// ปีการศึกษาแรกตอนติดตั้ง: ภาค 1 16 พ.ค.–10 ต.ค. · ภาค 2 1 พ.ย.–31 มี.ค. (แก้ได้ที่เมนูปีการศึกษา)
async function ensureFirstYear(env, yearBe, userId) {
  if (await env.DB.prepare("SELECT 1 AS x FROM academic_years LIMIT 1").first()) return;
  const now = new Date(Date.now() + 7 * 3600e3);
  let be = Number(yearBe);
  if (!Number.isInteger(be) || be < 2500 || be > 2700) be = now.getUTCFullYear() + 543 - (now.getUTCMonth() < 4 ? 1 : 0);
  const ce = be - 543;
  const r = await env.DB.prepare("INSERT INTO academic_years (year_be, label, start_date, end_date, status, created_by) VALUES (?, ?, ?, ?, 'active', ?)")
    .bind(be, `ปีการศึกษา ${be}`, `${ce}-05-16`, `${ce + 1}-03-31`, userId).run();
  const id = r.meta.last_row_id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO academic_terms (academic_year_id, term_number, name, start_date, end_date) VALUES (?, 1, ?, ?, ?)").bind(id, `ภาคเรียนที่ 1/${be}`, `${ce}-05-16`, `${ce}-10-10`),
    env.DB.prepare("INSERT INTO academic_terms (academic_year_id, term_number, name, start_date, end_date) VALUES (?, 2, ?, ?, ?)").bind(id, `ภาคเรียนที่ 2/${be}`, `${ce}-11-01`, `${ce + 1}-03-31`),
  ]);
}

export async function handleAuth(request, env, parts, method) {
  const action = parts[2];
  if (action === "status" && method === "GET") {
    const st = await env.DB.prepare(`SELECT s.school_name FROM gr_settings s JOIN academic_years y ON y.id = s.academic_year_id
      WHERE s.school_name IS NOT NULL AND s.school_name <> '' ORDER BY (y.status = 'active') DESC, y.year_be DESC LIMIT 1`).first().catch(() => null);
    const needs = !(await hasUsers(env));
    return json({ needs_setup: needs, allow_register: true, school: st?.school_name || null, setup_email: needs ? normEmail(env.SETUP_ADMIN_EMAIL) || null : null });
  }

  // ติดตั้งครั้งแรก: ยังไม่มีผู้ใช้เลย → สร้างผู้ดูแลระบบคนแรก + ปีการศึกษาแรก
  if (action === "setup" && method === "POST") {
    if (await hasUsers(env)) fail(409, "ตั้งค่าครั้งแรกไปแล้ว — เข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ");
    const b = await readJson(request);
    const email = normEmail(b.email), name = text(b.full_name, 120);
    if (!validEmail(email)) fail(400, "อีเมลหรือชื่อผู้ใช้ไม่ถูกต้อง (ภาษาอังกฤษ ตัวเลข . _ - อย่างน้อย 3 ตัว หรืออีเมล)");
    // กำหนดผู้ดูแลระบบคนแรกไว้ล่วงหน้า (vars.SETUP_ADMIN_EMAIL ใน wrangler.jsonc) — คนอื่นเปิดฟอร์มติดตั้งก่อนก็ยึดระบบไม่ได้
    const fixed = normEmail(env.SETUP_ADMIN_EMAIL);
    if (fixed && email !== fixed) fail(403, `บัญชีผู้ดูแลระบบคนแรกต้องใช้อีเมล ${fixed}`);
    if (!name) fail(400, "กรุณากรอกชื่อ-สกุล");
    checkPasswordStrength(b.password);
    const pw = await passwordFields(b.password);
    const r = await env.DB.prepare("INSERT INTO users (email, password_hash, password_salt, full_name, position, role, status, approved_at) VALUES (?, ?, ?, ?, ?, 'superadmin', 'active', datetime('now'))")
      .bind(email, pw.password_hash, pw.password_salt, name, text(b.position, 120) || null).run();
    const user = { id: r.meta.last_row_id, full_name: name, role: "superadmin", session_version: 1 };
    await ensureFirstYear(env, b.year_be, user.id);
    await audit(env, user, "setup.first_admin", { email });
    const token = await signIn(env, request, user);
    return json({ ok: true, user }, 200, { "Set-Cookie": buildSessionCookie(token) });
  }

  // สมัครใช้งานเอง: เข้าสู่ระบบได้แต่ยังไม่มีบทบาท จนกว่าฝ่ายวัดผล/ผู้ดูแลจะมอบหมายวิชาหรือกำหนดบทบาท
  if (action === "register" && method === "POST") {
    const b = await readJson(request);
    if (!(await verifyTurnstile(env, b.turnstile_token, request)).ok) fail(400, TURNSTILE_ERROR);
    const email = normEmail(b.email), name = text(b.full_name, 120);
    if (!validEmail(email)) fail(400, "อีเมลหรือชื่อผู้ใช้ไม่ถูกต้อง");
    if (!name || name.length < 4) fail(400, "กรุณากรอกชื่อ-สกุลให้ครบ");
    checkPasswordStrength(b.password);
    if (await env.DB.prepare("SELECT 1 AS x FROM users WHERE email = ? AND deleted_at IS NULL").bind(email).first()) fail(409, "อีเมลนี้มีบัญชีอยู่แล้ว — เข้าสู่ระบบ หรือให้ผู้ดูแลระบบตั้งรหัสผ่านใหม่");
    const pw = await passwordFields(b.password);
    const r = await env.DB.prepare("INSERT INTO users (email, password_hash, password_salt, full_name, position, role, status) VALUES (?, ?, ?, ?, ?, NULL, 'active')")
      .bind(email, pw.password_hash, pw.password_salt, name, text(b.position, 120) || null).run();
    const user = { id: r.meta.last_row_id, full_name: name, role: null, session_version: 1 };
    await audit(env, user, "users.register", { email });
    const token = await signIn(env, request, user);
    return json({ ok: true, user }, 200, { "Set-Cookie": buildSessionCookie(token) });
  }

  const user = await currentUser(request, env);
  if (!user) fail(401, "กรุณาเข้าสู่ระบบ");

  // เปลี่ยนรหัสผ่านของตัวเอง → ออกจากระบบอุปกรณ์อื่นทั้งหมด แล้วเข้าสู่ระบบใหม่ที่เครื่องนี้
  if (action === "password" && method === "POST") {
    const b = await readJson(request);
    const u = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(user.id).first();
    if (!(await verifyPassword(String(b.current || ""), u.password_salt, u.password_hash))) fail(400, "รหัสผ่านเดิมไม่ถูกต้อง");
    checkPasswordStrength(b.password);
    if (b.password === b.current) fail(400, "รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");
    const pw = await passwordFields(b.password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change = 0, session_version = session_version + 1, password_changed_at = datetime('now') WHERE id = ?")
      .bind(pw.password_hash, pw.password_salt, user.id).run();
    await revokeAllSessions(env, user.id, "password_change");
    await audit(env, user, "users.password_change", {});
    const token = await signIn(env, request, { ...user, session_version: Number(user.session_version || 1) + 1 });
    return json({ ok: true }, 200, { "Set-Cookie": buildSessionCookie(token) });
  }

  // อุปกรณ์ที่เข้าสู่ระบบอยู่ + ออกจากระบบอุปกรณ์อื่น
  if (action === "sessions" && method === "GET") {
    const list = await listSessions(env, user.id, user.session_id);
    return json({ sessions: list.map((s) => ({ id: String(s.id).slice(0, 12), device_label: s.device_label, user_agent: s.user_agent, ip_address: s.ip_address, country: s.country,
      created_at: s.created_at, last_seen_at: s.last_seen_at, current: s.current })) });
  }
  if (action === "sessions" && parts[3] === "revoke-others" && method === "POST") {
    const r = await env.DB.prepare("UPDATE auth_sessions SET revoked_at = datetime('now'), revoked_reason = 'revoke_others' WHERE user_id = ? AND revoked_at IS NULL AND id <> ?")
      .bind(user.id, String(user.session_id || "")).run();
    await audit(env, user, "sessions.revoke_others", { n: r.meta.changes });
    return json({ ok: true, revoked: Number(r.meta.changes || 0) });
  }
  fail(404, "ไม่พบเส้นทาง API");
}
