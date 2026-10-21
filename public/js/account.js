// บัญชีของฉัน: เปลี่ยนรหัสผ่าน · อุปกรณ์ที่เข้าสู่ระบบอยู่ (ออกจากระบบอุปกรณ์อื่น)
import { shell, api, esc, toast, showError, confirmBox, thaiTime } from "/js/app.js";

const me = await shell("account");
const main = document.getElementById("main"), view = document.getElementById("view");
main.hidden = false;
document.getElementById("who").textContent = `${me.user.full_name} · ${me.user.email || ""}`;
const first = me.user.must_change || new URLSearchParams(location.search).has("first");
const device = (ua) => {
  const s = String(ua || "");
  const os = /iPhone|iPad/.test(s) ? "iPhone/iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS/.test(s) ? "Mac" : /CrOS/.test(s) ? "Chromebook" : /Linux/.test(s) ? "Linux" : "อุปกรณ์อื่น";
  const br = /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  return `${os}${br ? ` · ${br}` : ""}`;
};

async function render() {
  const { sessions } = await api("/api/auth/sessions");
  view.innerHTML = `
    ${first && me.user.must_change ? `<p class="note warn"><b>กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน</b> — บัญชีนี้ใช้รหัสผ่านเริ่มต้นที่ผู้ดูแลตั้งให้</p>` : ""}
    <form class="panel" id="pwForm" style="max-width:520px">
      <div class="panel-head"><h2>เปลี่ยนรหัสผ่าน</h2></div>
      <div style="display:grid;gap:12px">
        <label class="field">รหัสผ่านปัจจุบัน${me.user.must_change ? " (รหัสเริ่มต้น)" : ""}<input type="password" name="current" required autocomplete="current-password"></label>
        <label class="field">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field">ยืนยันรหัสผ่านใหม่<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label>
      </div>
      <p class="muted small">เปลี่ยนแล้วอุปกรณ์อื่นทุกเครื่องจะออกจากระบบ</p>
      <div class="actions"><button class="btn primary">บันทึกรหัสผ่านใหม่</button></div>
    </form>
    <div class="panel">
      <div class="panel-head"><h2>อุปกรณ์ที่เข้าสู่ระบบอยู่ <span class="tag">${sessions.length}</span></h2>
        ${sessions.length > 1 ? '<button class="btn" id="revokeBtn">ออกจากระบบอุปกรณ์อื่นทั้งหมด</button>' : ""}</div>
      <div class="table-wrap"><table class="list"><thead><tr><th>อุปกรณ์</th><th>เข้าสู่ระบบเมื่อ</th><th></th></tr></thead>
      <tbody>${sessions.map((s) => `<tr><td>${esc(s.device_label || device(s.user_agent))}<br><span class="muted small">${esc([s.ip_address, s.country].filter(Boolean).join(" · "))}</span></td>
        <td class="small">${esc(thaiTime(s.created_at))}${s.last_seen_at ? `<br><span class="muted">ใช้ล่าสุด ${esc(thaiTime(s.last_seen_at))}</span>` : ""}</td><td>${s.current ? '<span class="tag ok">เครื่องนี้</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted small">การเข้าสู่ระบบแต่ละครั้งใช้ได้ 7 วัน · ถ้าเห็นอุปกรณ์ที่ไม่รู้จัก ให้เปลี่ยนรหัสผ่านทันที</p>
    </div>`;
  const f = document.getElementById("pwForm");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (d.password !== d.confirm) { toast("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน", "bad"); return; }
    try {
      await api("/api/auth/password", { method: "POST", body: { current: d.current, password: d.password } });
      toast("เปลี่ยนรหัสผ่านแล้ว");
      if (me.user.must_change) { location.href = "/"; return; }
      f.reset(); render();
    } catch (err) { showError(err); }
  };
  const rb = document.getElementById("revokeBtn");
  if (rb) rb.onclick = async () => {
    if (!(await confirmBox("ออกจากระบบอุปกรณ์อื่น", "ทุกอุปกรณ์ยกเว้นเครื่องนี้จะต้องเข้าสู่ระบบใหม่", "ออกจากระบบ"))) return;
    try { const r = await api("/api/auth/sessions/revoke-others", { method: "POST", body: {} }); toast(`ออกจากระบบ ${r.revoked} อุปกรณ์`); render(); } catch (err) { showError(err); }
  };
}
render().catch(showError);
