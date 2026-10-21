// อ่านตารางที่วางจาก Excel / Google Sheets (คั่นด้วย Tab) หรือ CSV แล้วแปลงเป็นแถวตามชนิดข้อมูล
// ใช้ได้ทั้งในเบราว์เซอร์และในชุดทดสอบ (ไม่พึ่ง DOM)

export const IMPORT_KINDS = {
  subjects: {
    title: "รายวิชา",
    columns: [
      { key: "grade_level", label: "ชั้น", aliases: ["ระดับชั้น", "ชั้น"] },
      { key: "code", label: "รหัสวิชา", aliases: ["รหัสวิชา", "รหัส"] },
      { key: "name", label: "ชื่อวิชา", aliases: ["ชื่อวิชา", "รายวิชา", "วิชา"] },
      { key: "learning_area", label: "กลุ่มสาระ", aliases: ["กลุ่มสาระการเรียนรู้", "กลุ่มสาระ", "สาระ"] },
      { key: "subject_type", label: "ประเภท", aliases: ["ประเภท", "ประเภทวิชา"] },
      { key: "hours_per_year", label: "ชม./ปี", aliases: ["ชม./ปี", "ชั่วโมง/ปี", "เวลาเรียน", "ชั่วโมง"] },
      { key: "collect_ratio", label: "คะแนนระหว่างภาค (%)", aliases: ["คะแนนระหว่างภาค (%)", "คะแนนเก็บ", "ระหว่างภาค", "คะแนนเก็บ (%)"] },
    ],
    note: "ประเภท: พื้นฐาน / เพิ่มเติม · คะแนนระหว่างภาคเว้นว่างได้ (ใช้ค่าเริ่มต้นของปี) · รหัสวิชาเดิมของชั้นเดียวกันจะถูกแก้ตามไฟล์",
  },
  teachers: {
    title: "ครูผู้สอน",
    columns: [
      { key: "room", label: "ห้อง", aliases: ["ห้อง", "ชั้น/ห้อง", "ห้องเรียน"] },
      { key: "code", label: "รหัสวิชา", aliases: ["รหัสวิชา", "รหัส"] },
      { key: "name", label: "ชื่อวิชา", aliases: ["ชื่อวิชา", "วิชา"], optional: true },
      { key: "teachers", label: "ครูผู้สอน", aliases: ["ครูผู้สอน", "ครู", "ผู้สอน"] },
    ],
    note: "ห้องเขียนแบบ ป.4/2 · ครูหลายคนคั่นด้วยจุลภาค (,) · ใช้ชื่อ-สกุลตามบัญชีในระบบ หรืออีเมล · ครูในไฟล์จะแทนที่ครูเดิมของวิชานั้น",
  },
  homerooms: {
    title: "ครูประจำชั้น",
    columns: [
      { key: "room", label: "ห้อง", aliases: ["ห้อง", "ชั้น/ห้อง", "ห้องเรียน"] },
      { key: "teachers", label: "ครูประจำชั้น", aliases: ["ครูประจำชั้น", "ครู"] },
    ],
    note: "ห้องเขียนแบบ ป.4/2 · ครูหลายคนคั่นด้วยจุลภาค (,) · รายชื่อในไฟล์จะแทนที่ครูประจำชั้นเดิมของห้องนั้น",
  },
  students: {
    title: "รายชื่อนักเรียน",
    endpoint: "/api/roster/import",
    columns: [
      { key: "student_code", label: "เลขประจำตัว", aliases: ["เลขประจำตัว", "เลขประจำตัวนักเรียน", "รหัสนักเรียน", "รหัส"] },
      { key: "name_prefix", label: "คำนำหน้า", aliases: ["คำนำหน้า", "คำนำหน้าชื่อ"], optional: true },
      { key: "first_name", label: "ชื่อ", aliases: ["ชื่อ"] },
      { key: "last_name", label: "นามสกุล", aliases: ["นามสกุล", "สกุล"] },
      { key: "gender", label: "เพศ", aliases: ["เพศ"], optional: true },
      { key: "national_id", label: "เลขประจำตัวประชาชน", aliases: ["เลขประจำตัวประชาชน", "เลขบัตรประชาชน"], optional: true },
      { key: "birth_date", label: "วันเกิด (วว/ดด/ปปปป)", aliases: ["วันเกิด", "วันเกิด (วว/ดด/ปปปป)", "วันเกิด (ค.ศ.)", "วันเดือนปีเกิด"], optional: true },
      { key: "room", label: "ห้อง", aliases: ["ห้อง", "ชั้น/ห้อง", "ห้องเรียน"], optional: true },
    ],
    note: "เลขประจำตัวที่มีอยู่แล้ว = ปรับข้อมูลและย้ายเข้าห้องตามไฟล์ (นักเรียนที่เคยย้ายออกจะกลับเข้าเรียน ใช้ข้อมูลเดิม) · เลขใหม่ = เพิ่มนักเรียน ต้องระบุห้องแบบ ป.1/2 หรือ อ.2/1 · วันเกิดแบบ 2018-05-31 หรือ 31/05/2561 · ห้ามเลขประจำตัวประชาชนซ้ำกับนักเรียนคนอื่น · คอลัมน์ข้อมูลผู้ปกครอง/ที่อยู่เว้นว่างได้ (ช่องว่าง = ไม่แก้ของเดิม)",
  },
  users: {
    title: "ข้อมูลครู",
    endpoint: "/api/users/import",
    columns: [
      { key: "email", label: "อีเมล/ชื่อผู้ใช้", aliases: ["อีเมล/ชื่อผู้ใช้", "อีเมล", "ชื่อผู้ใช้", "email", "username"] },
      { key: "full_name", label: "ชื่อ-สกุล", aliases: ["ชื่อ-สกุล", "ชื่อ-นามสกุล", "ชื่อ สกุล", "ชื่อ"] },
      { key: "position", label: "ตำแหน่ง", aliases: ["ตำแหน่ง"], optional: true },
      { key: "role", label: "บทบาท", aliases: ["บทบาท", "สิทธิ์"], optional: true },
      { key: "team", label: "ทีมวัดผล", aliases: ["ทีมวัดผล", "ทีมวัดและประเมินผล"], optional: true },
      { key: "password", label: "รหัสผ่านเริ่มต้น", aliases: ["รหัสผ่านเริ่มต้น", "รหัสผ่าน", "password"], optional: true },
    ],
    note: "อีเมล/ชื่อผู้ใช้ใช้เข้าสู่ระบบ (เช่น somchai หรือ somchai@gmail.com) · บทบาท: ครู / ผู้บริหาร / ผู้ดูแลระบบ (ว่าง = ครู) · ทีมวัดผล: ใส่ \"ใช่\" เพื่อให้สิทธิ์ · รหัสผ่านว่าง = ระบบสร้างให้และแสดงหลังบันทึก (ผู้ใช้ต้องเปลี่ยนเมื่อเข้าครั้งแรก) · บัญชีเดิม = แก้ชื่อ ตำแหน่ง และบทบาทตามไฟล์",
  },
  bank: {
    title: "ตัวชี้วัด",
    endpoint: "/api/admin/indicator-bank/import",
    chunk: 3000,
    columns: [
      { key: "grade_level", label: "ชั้น", aliases: ["ชั้น", "ระดับชั้น"] },
      { key: "learning_area", label: "กลุ่มสาระ/ด้าน", aliases: ["กลุ่มสาระ/ด้าน", "กลุ่มสาระ", "กลุ่มสาระการเรียนรู้", "ด้าน"] },
      { key: "subject_code", label: "รหัสวิชา", aliases: ["รหัสวิชา"], optional: true },
      { key: "kind", label: "ประเภท", aliases: ["ประเภท"], optional: true },
      { key: "code", label: "รหัสตัวชี้วัด", aliases: ["รหัสตัวชี้วัด", "รหัส", "ตัวชี้วัดที่"], optional: true },
      { key: "title", label: "ตัวชี้วัด", aliases: ["ตัวชี้วัด", "ข้อความ", "ข้อความตัวชี้วัด", "รายการ"] },
    ],
    note: "ประเภท: ระหว่างทาง / ปลายทาง / ผลการเรียนรู้ / ผลลัพธ์การเรียนรู้ / ความสามารถผู้เรียน (อนุบาล) · รหัสวิชาว่าง = ทุกวิชาของกลุ่มสาระในชั้นนั้นเห็น · ตัวชี้วัดที่มีอยู่แล้ว (ชั้น+กลุ่มสาระ+รหัส+ข้อความเดียวกัน) จะข้าม ไม่ซ้ำ",
  },
};

// ข้อมูลเพิ่มเติมของนักเรียน (ไม่บังคับ) — ชื่อคอลัมน์ตรงกับ EXTRA_FIELDS ของเซิร์ฟเวอร์
export const STUDENT_EXTRA = [
  ["nationality", "สัญชาติ"], ["religion", "ศาสนา"],
  ["father_prefix", "คำนำหน้าบิดา"], ["father_first_name", "ชื่อบิดา"], ["father_last_name", "นามสกุลบิดา"],
  ["mother_prefix", "คำนำหน้ามารดา"], ["mother_first_name", "ชื่อมารดา"], ["mother_last_name", "นามสกุลมารดา"],
  ["guardian_prefix", "คำนำหน้าผู้ปกครอง"], ["guardian_first_name", "ชื่อผู้ปกครอง"], ["guardian_last_name", "นามสกุลผู้ปกครอง"],
  ["guardian_relationship", "ความเกี่ยวข้องกับนักเรียน"], ["guardian_phone", "เบอร์โทรผู้ปกครอง"],
  ["house_number", "บ้านเลขที่"], ["village_no", "หมู่ที่"], ["road_soi", "ถนน/ซอย"], ["subdistrict", "ตำบล"], ["district", "อำเภอ"], ["province", "จังหวัด"],
];
for (const [key, label] of STUDENT_EXTRA) IMPORT_KINDS.students.columns.push({ key, label, aliases: [label], optional: true, extra: true });

// แยกข้อความเป็นตาราง: รองรับ Tab (จาก Excel) และ CSV ที่มีเครื่องหมายคำพูด
export function parseGrid(text) {
  const src = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n").find((l) => l.trim()) || "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

// แปลงตาราง → แถวข้อมูล: ถ้าแถวแรกเป็นหัวตาราง จับคอลัมน์ตามชื่อหัว ไม่เช่นนั้นใช้ลำดับคอลัมน์ตามแม่แบบ
export function gridToRows(kind, grid) {
  const spec = IMPORT_KINDS[kind];
  if (!spec || !grid.length) return { rows: [], header: false };
  const head = grid[0].map(norm);
  const index = {};
  for (const col of spec.columns) {
    const at = head.findIndex((h) => col.aliases.some((a) => h === norm(a)));
    if (at >= 0) index[col.key] = at;
  }
  const required = spec.columns.filter((c) => !c.optional);
  const header = required.filter((c) => c.key in index).length >= Math.min(2, required.length);
  let body = grid;
  if (header) body = grid.slice(1);
  else {
    // ไม่มีหัวตาราง: ลำดับคอลัมน์ตามแม่แบบ (ข้ามคอลัมน์ optional ถ้าจำนวนคอลัมน์ไม่พอ)
    const width = Math.max(...grid.map((r) => r.length));
    const base = spec.columns.filter((c) => !c.extra);
    const cols = width >= spec.columns.length ? spec.columns : width >= base.length ? base : required;
    cols.forEach((c, i) => { index[c.key] = i; });
  }
  const rows = body.map((r) => Object.fromEntries(spec.columns.filter((c) => c.key in index).map((c) => [c.key, r[index[c.key]] ?? ""])));
  return { rows, header };
}

export function templateRows(kind) {
  return [IMPORT_KINDS[kind].columns.map((c) => c.label)];
}
