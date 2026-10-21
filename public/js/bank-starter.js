// ชุดตัวชี้วัดเริ่มต้น (จากคลังของระบบป่าเด็ง หลักสูตร 2569) — ไฟล์อยู่ที่ /data/ ของเว็บนี้ แปลงเป็นแถวสำหรับนำเข้าคลังตัวชี้วัด
// แต่ละชุดเป็นไฟล์ JS ที่ export default { rows: [[ชั้น, กลุ่มสาระ/ด้าน, รหัส, ข้อความ, รหัสวิชา, ประเภท]], competencies? }
export const STARTER_SETS = [
  { key: "p46", file: "indicator-bank-2569.js", title: "ตัวชี้วัด ป.4–6 (หลักสูตรแกนกลาง ปรับปรุง 2560 · ระหว่างทาง/ปลายทาง + ผลการเรียนรู้วิชาเพิ่มเติม)" },
  { key: "p13", file: "indicator-bank-2569-p13.js", title: "ผลลัพธ์การเรียนรู้ ป.1–3 (หลักสูตรประถมศึกษาตอนต้น 2569)" },
  { key: "kinder", file: "indicator-bank-2569-kinder.js", title: "ความสามารถผู้เรียน อ.1–อ.3 (หลักสูตรปฐมวัย · 4 ด้าน 33 องค์ประกอบ)" },
];
export const STARTER_BASE = "/data/";

export function starterRows(data) {
  const comp = new Map((data.competencies || []).map((c) => [`${c.grade}|${c.code}`, c]));
  return data.rows.map(([grade_level, learning_area, code, title, subject_code, kind]) => {
    const c = comp.get(`${grade_level}|${code}`);
    return { grade_level, learning_area, code: code || "", title, subject_code: subject_code || "", kind: kind || "", subgroup: c?.comp || "", subdomain: c?.domain || "" };
  });
}
// อ่านไฟล์ JS (export default {...}) เป็นข้อมูล
export function parseStarter(text) {
  const i = text.indexOf("export default");
  return JSON.parse(text.slice(i + "export default".length).trim().replace(/;\s*$/, ""));
}
