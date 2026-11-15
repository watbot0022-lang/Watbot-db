import test from "node:test";
import assert from "node:assert/strict";
import { computeStudentResult, structureIssues } from "../public/js/grading.js";

const item = (id, kind, max, term) => ({ id, kind, max_score: max, term_number: term });

test("ตัดเกรดรายภาค: ภาคละ 100 ตัดเกรดแยกภาค · ผลทั้งปี = ค่าเฉลี่ย 2 ภาค", () => {
  const items = [item(1, "indicator", 70, 1), item(2, "final", 30, 1), item(3, "indicator", 70, 2), item(4, "final", 30, 2)];
  const st = { collect_ratio: 70, hours_per_year: 0, grading_mode: "term" };
  const r = computeStudentResult(items, { 1: 60, 2: 25, 3: 50, 4: 20 }, {}, st, {}, null);
  assert.equal(r.term_scores[1].total, 85);
  assert.equal(r.term_scores[1].grade, "4");
  assert.equal(r.term_scores[2].grade, "3");
  assert.equal(r.total, 77.5);
  assert.equal(r.grade, "3.5");
  assert.equal(r.total_max, 100);
  // ภาค 1 อย่างเดียว: มีเกรดภาค 1 แต่ยังไม่มีผลทั้งปี
  const r1 = computeStudentResult(items.slice(0, 2), { 1: 60, 2: 25 }, {}, st, {}, null);
  assert.equal(r1.term_scores[1].grade, "4");
  assert.equal(r1.total, null);
  assert.equal(r1.grade, null);
  assert.deepEqual(structureIssues(items, 70, "ตัวชี้วัด", "term"), []);
  assert.equal(structureIssues(items, 70, "ตัวชี้วัด", "year").length, 4);
});

test("ตัดเกรดรายปี (ค่าเริ่มต้น): ภาคละ 50 รวมตัดเกรดครั้งเดียว ไม่มีเกรดรายภาค", () => {
  const items = [item(1, "indicator", 35, 1), item(2, "final", 15, 1), item(3, "indicator", 35, 2), item(4, "final", 15, 2)];
  const r = computeStudentResult(items, { 1: 30, 2: 12, 3: 25, 4: 10 }, {}, { collect_ratio: 70, hours_per_year: 0 }, {}, null);
  assert.equal(r.total, 77);
  assert.equal(r.grade, "3.5");
  assert.equal(r.term_scores[1].grade, undefined);
  assert.deepEqual(structureIssues(items, 70), []);
});

test("API: เปลี่ยนรูปแบบการตัดเกรดของรายวิชา แล้วผลคำนวณตามรูปแบบใหม่", async () => {
  const { default: worker } = await import("../src/index.js");
  const { makeEnv } = await import("../dev/server.mjs");
  const { PASSWORD } = await import("../dev/seed.mjs");
  const ORIGIN = "http://school.test", env = await makeEnv();
  const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) }), env);
  const cookie = r.headers.get("Set-Cookie").split(";")[0];
  const call = async (method, path, body) => {
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  await call("POST", "/api/admin/subjects/template", { grades: ["ป.4"] });
  await call("POST", "/api/admin/courses/generate", {});
  const { data: { courses } } = await call("GET", "/api/admin/courses");
  const id = (courses.find((c) => !c.locked) || courses[0])?.id ?? courses[0]?.course_id;
  assert.ok(id, JSON.stringify(courses.slice(0, 1)));
  const before = await call("GET", `/api/courses/${id}`);
  assert.equal(before.data.course.grading_mode, "year");
  assert.equal((await call("PUT", `/api/courses/${id}/grading-mode`, { mode: "x" })).status, 400);
  const after = await call("PUT", `/api/courses/${id}/grading-mode`, { mode: "term" });
  assert.equal(after.status, 200);
  assert.equal(after.data.course.grading_mode, "term");
  assert.equal((await call("GET", `/api/courses/${id}`)).data.course.grading_mode, "term");
});
