// บัญชีผู้ใช้ (ครู ผู้บริหาร ผู้ดูแล ผู้ชมภายนอก) + การ์ดนำเข้า/ส่งออกข้อมูลครู
// สิทธิ์: ผู้ดูแลระบบ (superadmin) จัดการได้ทุกบัญชี · ทีมวัดผล (grade_admin) เพิ่ม/แก้ได้เฉพาะบัญชีครู/บัญชีที่ยังไม่มีบทบาท
import { json, readJson, fail, requireImporter, text, audit, HttpError } from "../lib/http.js";
import { compareThaiName } from "../lib/data.js";
import { normEmail, validEmail, checkPasswordStrength, passwordFields } from "./auth.js";
import { revokeAllSessions } from "../lib/auth-sessions.js";

const ROLE_TH = { teacher: "ครู", executive: "ผู้บริหาร", superadmin: "ผู้ดูแลระบบ", viewer: "ผู้ชมภายนอก" };
const ROLE_FROM_TH = { "ครู": "teacher", "ครูผู้สอน": "teacher", teacher: "teacher", "ผู้บริหาร": "executive", executive: "executive", "ผู้ดูแลระบบ": "superadmin", superadmin: "superadmin",
  "แอดมิน": "superadmin", "ผู้ชมภายนอก": "viewer", viewer: "viewer", "": null, "ยังไม่กำหนด": null };
const YES = /^(ใช่|y|yes|true|1|✓|มี)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// รหัสผ่านเริ่มต้นอ่านง่าย: ตัวอักษร 2 ตัว + ตัวเลข 6 ตัว (เช่น kp482913)
export function genPassword() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const letters = "abcdefghjkmnpqrstuvwxyz";
  return letters[b[0] % letters.length] + letters[b[1] % letters.length] + [...b.slice(2)].map((x) => x % 10).join("");
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(`SELECT u.id, u.email, u.full_name, u.position, u.role, u.status, u.last_login_at, u.created_at, u.must_change,
      r.role AS grade_role, v.user_id AS viewer_id, v.expires_at AS viewer_expires
    FROM users u LEFT JOIN gr_staff_roles r ON r.user_id = u.id LEFT JOIN viewer_accounts v ON v.user_id = u.id
    WHERE u.deleted_at IS NULL`).all();
  return results.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, position: u.position || "", role: u.viewer_id != null ? "viewer" : u.role,
    grade_admin: !!u.grade_role, status: u.status, viewer_expires: u.viewer_expires || null, last_login_at: u.last_login_at, created_at: u.created_at, must_change: !!u.must_change }))
    .sort((a, b) => compareThaiName(a.full_name, b.full_name));
}

const canTouch = (actor, target) => actor.role === "superadmin" || target.role == null || target.role === "teacher";

// บทบาท + สิทธิ์ทีมวัดผล + บัญชีผู้ชมภายนอก
async function applyAccess(env, actor, u, { role, grade_admin, viewer_expires }) {
  const stmts = [];
  if (role !== undefined) {
    if (!["teacher", "executive", "superadmin", "viewer", null].includes(role)) fail(400, "บทบาทไม่ถูกต้อง");
    if (actor.role !== "superadmin" && !["teacher", null].includes(role)) fail(403, "กำหนดบทบาทผู้บริหาร/ผู้ดูแลระบบ/ผู้ชมภายนอกได้เฉพาะผู้ดูแลระบบ");
    if (u.id === actor.id && role !== actor.role) fail(400, "เปลี่ยนบทบาทของตัวเองไม่ได้ (กันไม่ให้ระบบไม่มีผู้ดูแล)");
    if (role === "viewer") {
      stmts.push(env.DB.prepare("UPDATE users SET role = NULL WHERE id = ?").bind(u.id));
      stmts.push(env.DB.prepare(`INSERT INTO viewer_accounts (user_id, expires_at, created_by) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at`).bind(u.id, DATE.test(viewer_expires || "") ? viewer_expires : null, actor.id));
      stmts.push(env.DB.prepare("DELETE FROM gr_staff_roles WHERE user_id = ?").bind(u.id));
    } else {
      stmts.push(env.DB.prepare("DELETE FROM viewer_accounts WHERE user_id = ?").bind(u.id));
      stmts.push(env.DB.prepare("UPDATE users SET role = ?, approved_at = CASE WHEN ? IS NOT NULL AND approved_at IS NULL THEN datetime('now') ELSE approved_at END, approved_by = CASE WHEN ? IS NOT NULL AND approved_by IS NULL THEN ? ELSE approved_by END WHERE id = ?")
        .bind(role, role, role, actor.id, u.id));
    }
  } else if (viewer_expires !== undefined) {
    stmts.push(env.DB.prepare("UPDATE viewer_accounts SET expires_at = ? WHERE user_id = ?").bind(DATE.test(viewer_expires || "") ? viewer_expires : null, u.id));
  }
  if (grade_admin !== undefined) {
    if (actor.role !== "superadmin") fail(403, "ให้สิทธิ์ทีมวัดผลได้เฉพาะผู้ดูแลระบบ");
    stmts.push(grade_admin
      ? env.DB.prepare("INSERT INTO gr_staff_roles (user_id, role, granted_by) VALUES (?, 'grade_admin', ?) ON CONFLICT(user_id) DO NOTHING").bind(u.id, actor.id)
      : env.DB.prepare("DELETE FROM gr_staff_roles WHERE user_id = ?").bind(u.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export async function handleUsers(request, env, user, parts, method) {
  requireImporter(user);
  const id = /^\d+$/.test(parts[2] || "") ? Number(parts[2]) : null;
  const byId = async (uid) => (await listUsers(env)).find((x) => x.id === uid) || null;

  if (!parts[2] && method === "GET") return json({ users: await listUsers(env), me: user.id, is_super: user.role === "superadmin" });

  if (parts[2] === "export" && method === "GET") {
    return json({ rows: (await listUsers(env)).map((u) => ({ email: u.email, full_name: u.full_name, position: u.position, role: ROLE_TH[u.role] || "ยังไม่กำหนด",
      team: u.grade_admin ? "ใช่" : "", status: u.status === "active" ? "ใช้งาน" : "ระงับ" })) });
  }

  if (!parts[2] && method === "POST") {
    const b = await readJson(request);
    const email = normEmail(b.email), name = text(b.full_name, 120);
    if (!validEmail(email)) fail(400, "อีเมล/ชื่อผู้ใช้ไม่ถูกต้อง (ภาษาอังกฤษ ตัวเลข . _ - อย่างน้อย 3 ตัว หรืออีเมล)");
    if (!name) fail(400, "กรุณากรอกชื่อ-สกุล");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) fail(409, "อีเมล/ชื่อผู้ใช้นี้มีบัญชีอยู่แล้ว");
    const password = b.password ? String(b.password) : genPassword();
    if (b.password) checkPasswordStrength(password);
    const pw = await passwordFields(password);
    const r = await env.DB.prepare("INSERT INTO users (email, password_hash, password_salt, full_name, position, role, status, must_change) VALUES (?, ?, ?, ?, ?, NULL, 'active', 1)")
      .bind(email, pw.password_hash, pw.password_salt, name, text(b.position, 120) || null).run();
    const u = { id: r.meta.last_row_id, role: null };
    await applyAccess(env, user, u, { role: b.role === undefined ? "teacher" : b.role || null, grade_admin: user.role === "superadmin" && b.grade_admin !== undefined ? !!b.grade_admin : undefined, viewer_expires: b.viewer_expires });
    await audit(env, user, "users.create", { id: u.id, email, role: b.role });
    return json({ ok: true, user: await byId(u.id), password: b.password ? null : password });
  }

  if (id && !parts[3] && method === "PUT") {
    const u = await byId(id);
    if (!u) fail(404, "ไม่พบผู้ใช้");
    if (!canTouch(user, u)) fail(403, "แก้ไขบัญชีนี้ได้เฉพาะผู้ดูแลระบบ");
    const b = await readJson(request);
    const sets = [], vals = [];
    if ("full_name" in b) { const n = text(b.full_name, 120); if (!n) fail(400, "กรุณากรอกชื่อ-สกุล"); sets.push("full_name = ?"); vals.push(n); }
    if ("position" in b) { sets.push("position = ?"); vals.push(text(b.position, 120) || null); }
    if ("email" in b) {
      const e = normEmail(b.email);
      if (!validEmail(e)) fail(400, "อีเมล/ชื่อผู้ใช้ไม่ถูกต้อง");
      if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").bind(e, id).first()) fail(409, "อีเมล/ชื่อผู้ใช้นี้มีบัญชีอยู่แล้ว");
      sets.push("email = ?"); vals.push(e);
    }
    let disabled = false;
    if ("status" in b) {
      if (id === user.id && b.status !== "active") fail(400, "ระงับบัญชีของตัวเองไม่ได้");
      disabled = b.status === "disabled";
      sets.push("status = ?"); vals.push(disabled ? "disabled" : "active");
      if (disabled) sets.push("session_version = session_version + 1");
    }
    if (sets.length) await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
    await applyAccess(env, user, u, { role: "role" in b ? b.role || null : undefined, grade_admin: "grade_admin" in b ? !!b.grade_admin : undefined, viewer_expires: "viewer_expires" in b ? b.viewer_expires : undefined });
    if (disabled) await revokeAllSessions(env, id, "disabled");
    await audit(env, user, "users.update", { id, fields: Object.keys(b) });
    return json({ ok: true, user: await byId(id) });
  }

  // ตั้งรหัสผ่านใหม่ให้ผู้ใช้ (ลืมรหัส) → ออกจากระบบทุกอุปกรณ์ และต้องเปลี่ยนรหัสเมื่อเข้าครั้งถัดไป
  if (id && parts[3] === "password" && method === "POST") {
    const u = await byId(id);
    if (!u) fail(404, "ไม่พบผู้ใช้");
    if (!canTouch(user, u)) fail(403, "ตั้งรหัสผ่านบัญชีนี้ได้เฉพาะผู้ดูแลระบบ");
    const b = await readJson(request);
    const password = b.password ? String(b.password) : genPassword();
    if (b.password) checkPasswordStrength(password);
    const pw = await passwordFields(password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change = 1, session_version = session_version + 1, password_changed_at = datetime('now') WHERE id = ?")
      .bind(pw.password_hash, pw.password_salt, id).run();
    await revokeAllSessions(env, id, "password_reset");
    await audit(env, user, "users.password_reset", { id });
    return json({ ok: true, password: b.password ? null : password });
  }

  // ลบบัญชี (soft delete — ประวัติคะแนนและการบันทึกยังอยู่)
  if (id && !parts[3] && method === "DELETE") {
    const u = await byId(id);
    if (!u) fail(404, "ไม่พบผู้ใช้");
    if (id === user.id) fail(400, "ลบบัญชีของตัวเองไม่ได้");
    if (!canTouch(user, u)) fail(403, "ลบบัญชีนี้ได้เฉพาะผู้ดูแลระบบ");
    // เปลี่ยนอีเมลของบัญชีที่ลบ เพื่อให้สร้างบัญชีใหม่ด้วยอีเมลเดิมได้ (email เป็น UNIQUE)
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET deleted_at = datetime('now'), deleted_by = ?, status = 'disabled', session_version = session_version + 1, email = email || '#deleted-' || id WHERE id = ?").bind(user.id, id),
      env.DB.prepare("DELETE FROM gr_staff_roles WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM viewer_accounts WHERE user_id = ?").bind(id),
    ]);
    await revokeAllSessions(env, id, "deleted");
    await audit(env, user, "users.delete", { id, email: u.email });
    return json({ ok: true });
  }

  // ---------- นำเข้าข้อมูลครูจากไฟล์แม่แบบ ----------
  // แถว: email, full_name, position, role (ครู/ผู้บริหาร/ผู้ดูแลระบบ), team (ทีมวัดผล: ใช่), password (ว่าง = ระบบสร้างให้)
  if (parts[2] === "import" && method === "POST") {
    const b = await readJson(request);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 300) : [];
    if (!rows.length) fail(400, "ไม่มีข้อมูลให้นำเข้า");
    const errors = [], plan = [], seen = new Set();
    const byEmail = new Map((await listUsers(env)).map((u) => [normEmail(u.email), u]));
    for (const [i, r] of rows.entries()) {
      try {
        const email = normEmail(r.email), name = text(r.full_name, 120);
        if (!validEmail(email)) fail(400, `อีเมล/ชื่อผู้ใช้ "${text(r.email, 60)}" ไม่ถูกต้อง`);
        if (seen.has(email)) fail(400, `อีเมล ${email} ซ้ำในไฟล์`);
        seen.add(email);
        if (!name) fail(400, "ไม่มีชื่อ-สกุล");
        const roleText = text(r.role, 30);
        if (!(roleText in ROLE_FROM_TH)) fail(400, `บทบาท "${roleText}" ไม่ถูกต้อง (ใช้ ครู / ผู้บริหาร / ผู้ดูแลระบบ / ผู้ชมภายนอก)`);
        const role = roleText === "" ? "teacher" : ROLE_FROM_TH[roleText];
        const team = YES.test(text(r.team, 10));
        if (user.role !== "superadmin" && (!["teacher", null].includes(role) || team)) fail(403, "ทีมวัดผลนำเข้าได้เฉพาะบัญชีครู (บทบาทอื่น/สิทธิ์ทีมวัดผล ให้ผู้ดูแลระบบนำเข้า)");
        const existing = byEmail.get(email) || null;
        if (existing && !canTouch(user, existing)) fail(403, `บัญชี ${email} แก้ได้เฉพาะผู้ดูแลระบบ`);
        if (existing && existing.id === user.id && role !== user.role) fail(400, "เปลี่ยนบทบาทของตัวเองผ่านการนำเข้าไม่ได้");
        const password = text(r.password, 100);
        if (password) checkPasswordStrength(password);
        plan.push({ email, name, position: text(r.position, 120), role, team, password, existing });
      } catch (e) { if (e instanceof HttpError) errors.push({ row: i + 1, error: e.message }); else throw e; }
    }
    const summary = { add: plan.filter((p) => !p.existing).length, update: plan.filter((p) => p.existing).length };
    if (b.dry_run || errors.length) return json({ ok: !errors.length, dry_run: true, errors, summary });
    const created = [];
    for (const p of plan) {
      let u = p.existing;
      const stmts = [];
      if (u) {
        stmts.push(env.DB.prepare("UPDATE users SET full_name = ?, position = COALESCE(?, position) WHERE id = ?").bind(p.name, p.position || null, u.id));
        if (p.password) {
          const pw = await passwordFields(p.password);
          stmts.push(env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change = 1, session_version = session_version + 1 WHERE id = ?").bind(pw.password_hash, pw.password_salt, u.id));
        }
        await env.DB.batch(stmts);
      } else {
        const password = p.password || genPassword();
        const pw = await passwordFields(password);
        const r = await env.DB.prepare("INSERT INTO users (email, password_hash, password_salt, full_name, position, role, status, must_change) VALUES (?, ?, ?, ?, ?, NULL, 'active', 1)")
          .bind(p.email, pw.password_hash, pw.password_salt, p.name, p.position || null).run();
        u = { id: r.meta.last_row_id, role: null };
        created.push({ email: p.email, full_name: p.name, password: p.password ? "(ตามไฟล์)" : password });
      }
      await applyAccess(env, user, u, { role: p.role, grade_admin: user.role === "superadmin" ? p.team : undefined });
    }
    await audit(env, user, "users.import", summary);
    return json({ ok: true, summary, created });
  }

  fail(404, "ไม่พบเส้นทาง API");
}
