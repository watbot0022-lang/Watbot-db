import test from "node:test";
import assert from "node:assert/strict";
import { parseBirth, thaiBirth } from "../src/routes/roster.js";

test("วันเกิด: ส่งออกเป็น วว/ดด/ปปปป พ.ศ. และนำกลับเข้าได้ค่าเดิม", () => {
  assert.equal(thaiBirth("2017-06-15"), "15/06/2560");
  assert.equal(parseBirth(thaiBirth("2017-06-15")), "2017-06-15");
  assert.equal(parseBirth("2017-06-15"), "2017-06-15");
  assert.equal(parseBirth("31/02/2561"), null);
  assert.equal(thaiBirth(""), "");
});
