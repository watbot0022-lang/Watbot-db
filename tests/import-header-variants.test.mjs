import test from "node:test";
import assert from "node:assert/strict";
import { gridToRows, parseGrid } from "../public/js/paste.js";

const rowOf = (h) => gridToRows("students", parseGrid(`เลขประจำตัว\tชื่อ\tนามสกุล\t${h}\tวัน/เดือน/ปีเกิด\tชั้นเรียน\tหมายเหตุ\n3149\tก\tข\t1159900729576\t28/08/2563\tป.1/1\tx`));

test("นำเข้านักเรียน: หัวคอลัมน์เลขประจำตัวประชาชนหลายแบบยังอ่านได้ และไม่สับกับเลขประจำตัวนักเรียน", () => {
  for (const h of ["เลขบัตรประจำตัวประชาชน", "เลขประจำตัวประชาชน 13 หลัก", "รหัสประจำตัวประชาชน", "บัตรประชาชน", "ID"]) {
    const { rows } = rowOf(h);
    assert.equal(rows[0].student_code, "3149", h);
    assert.equal(rows[0].national_id, "1159900729576", h);
    assert.equal(rows[0].birth_date, "28/08/2563", h);
    assert.equal(rows[0].room, "ป.1/1", h);
  }
});

test("นำเข้านักเรียน: แจ้งคอลัมน์ที่ระบบไม่รู้จัก แทนการทิ้งเงียบ ๆ", () => {
  assert.deepEqual(rowOf("เลขประจำตัวประชาชน").ignored, ["หมายเหตุ"]);
});
