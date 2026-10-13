import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/server.js";
import { loadGuides, validateSystem } from "../src/guides.js";
import { loadCourses } from "../src/courses.js";

const GUIDES_DIR = new URL("../data/guides/", import.meta.url).pathname;
const COURSES_DIR = new URL("../data/courses/", import.meta.url).pathname;
const CURRICULUM = JSON.parse(fs.readFileSync(new URL("../data/curriculum.json", import.meta.url), "utf8"));
const courseFiles = () => fs.readdirSync(COURSES_DIR).filter(f => f.endsWith(".json"));

test("Govtech Academy server test suite", async (t) => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;

  t.after(() => {
    server.close();
  });

  await t.test("GET /healthz returns 200 with valid service metrics", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "academy");
    assert.equal(body.domain, "academy.cedec.io");
    assert.equal(body.lessonsCount, 15);
    assert.equal(body.videosCount, 9);
    assert.ok(body.seatsRemaining > 0);
  });

  await t.test("GET /api/curriculum returns all 15 lessons with metadata", async () => {
    const res = await fetch(`${base}/api/curriculum`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.academy.name, "ANC CC Ops Course");
    assert.equal(body.lessons.length, 15);
  });

  await t.test("GET /api/lessons/:id returns single lesson with quiz", async () => {
    const res = await fetch(`${base}/api/lessons/lesson-01-system-overview`);
    assert.equal(res.status, 200);
    const lesson = await res.json();
    assert.equal(lesson.moduleNumber, 1);
    assert.equal(lesson.video, "ancops-intro.mp4");
    assert.ok(lesson.quiz.length > 0);
  });

  await t.test("GET /api/stats returns 10 student seats", async () => {
    const res = await fetch(`${base}/api/stats`);
    assert.equal(res.status, 200);
    const stats = await res.json();
    assert.equal(stats.total, 10);
    assert.ok(stats.claimed >= 4);
    assert.equal(stats.remaining, stats.total - stats.claimed);
  });

  await t.test("POST /api/enrol successfully claims a student seat", async () => {
    const res = await fetch(`${base}/api/enrol`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test Cadre Mzi",
        role: "Ops Officer",
        region: "Gauteng"
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.message.includes("Seat confirmed for Test Cadre Mzi"));
  });

  await t.test("POST /api/quiz/:id evaluates answers correctly", async () => {
    // Lesson 1, Question 1: correct is 2 ("Chief Platform Hacker" not a role)
    // Question 2: correct is 1 (POPIA compliance / accountability)
    const res = await fetch(`${base}/api/quiz/lesson-01-system-overview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { 0: 2, 1: 1 } })
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.scorePercent, 100);
    assert.equal(result.passed, true);
    assert.equal(result.correct, 2);
  });

  await t.test("GET /media/videos/:file handles HTTP 206 range requests", async () => {
    const res = await fetch(`${base}/media/videos/ancops-intro.mp4`, {
      headers: { Range: "bytes=0-1023" }
    });
    assert.equal(res.status, 206);
    assert.match(res.headers.get("content-range") || "", /^bytes 0-1023\/\d+$/);
    const buf = await res.arrayBuffer();
    assert.equal(buf.byteLength, 1024);
  });

  await t.test("GET /media/posters/:file serves poster jpeg", async () => {
    const res = await fetch(`${base}/media/posters/ancops-intro.jpg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 1000);
  });

  await t.test("GET / is the Govtech Academy course catalogue", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.ok(html.includes("<h1>Govtech Academy</h1>"));
    assert.ok(html.includes('href="/course/ancops"'));
    assert.ok(!html.includes("ANC CC Ops Academy"));
  });

  await t.test("GET /course/ancops serves the ANC course under the Govtech Academy brand", async () => {
    const html = await (await fetch(`${base}/course/ancops`)).text();
    assert.ok(html.includes("Govtech Academy"));
    assert.ok(html.includes("ANC CC Ops Course"));
    assert.ok(html.includes("CEDEC AFRICA"));
    assert.ok(html.includes("10 Sponsored Student Seats"));
  });

  await t.test("old /lesson/ links redirect to the ANC course", async () => {
    const res = await fetch(`${base}/lesson/lesson-01-system-overview`, { redirect: "manual" });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/course/ancops");
  });

  await t.test("GET /api/guides lists every Govtech system's how-to guides", async () => {
    const res = await fetch(`${base}/api/guides`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const files = fs.readdirSync(GUIDES_DIR).filter(f => f.endsWith(".json"));
    assert.equal(body.systems.length, files.length);
    assert.ok(body.guidesCount > 0);
    for (const s of body.systems) assert.ok(s.guidesCount > 0, s.id);
  });

  await t.test("GET /api/guides/:system/:guide returns one guide, 404 otherwise", async () => {
    const index = await (await fetch(`${base}/api/guides`)).json();
    const sys = index.systems[0];
    const res = await fetch(`${base}/api/guides/${sys.id}/${sys.guides[0].id}`);
    assert.equal(res.status, 200);
    const guide = await res.json();
    assert.ok(guide.steps.length > 0);
    assert.equal((await fetch(`${base}/api/guides/${sys.id}/no-such-guide`)).status, 404);
    assert.equal((await fetch(`${base}/api/guides/no-such-system`)).status, 404);
  });

  await t.test("GET /guides/... serves the guides library page", async () => {
    for (const p of ["/guides", "/guides/newt", "/guides/newt/register-an-asset"]) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.ok(html.includes("How-to Guides"), p);
    }
    const home = await (await fetch(`${base}/`)).text();
    assert.ok(home.includes('href="/guides"'));
  });

  await t.test("GET /api/courses lists ANC CC Ops first, then one course per system file", async () => {
    const body = await (await fetch(`${base}/api/courses`)).json();
    assert.equal(body.courses[0].id, "ancops");
    assert.equal(body.courses[0].lessonsCount, 15);
    assert.equal(body.courses.length, 1 + courseFiles().length);
  });

  await t.test("every course page renders, and its quizzes grade through /api/quiz", async () => {
    const { courses } = await (await fetch(`${base}/api/courses`)).json();
    for (const c of courses) {
      const page = `/course/${c.id}`;
      const res = await fetch(`${base}${page}`);
      assert.equal(res.status, 200, page);
      assert.ok((await res.text()).includes('<a href="/">All Courses'), page);
      const full = await (await fetch(`${base}/api/courses/${c.id}`)).json();
      const lesson = full.lessons.find(l => (l.quiz || []).length);
      if (!lesson) continue;
      const answers = Object.fromEntries(lesson.quiz.map((q, i) => [i, q.correctIndex]));
      const graded = await (await fetch(`${base}/api/quiz/${lesson.id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers })
      })).json();
      assert.equal(graded.scorePercent, 100, lesson.id);
    }
    assert.equal((await fetch(`${base}/course/no-such-course`)).status, 404);
    assert.equal((await fetch(`${base}/courses`)).status, 200);
  });

  await t.test("healthz reports the loaded guides", async () => {
    const body = await (await fetch(`${base}/healthz`)).json();
    assert.ok(body.guideSystems >= 1);
    assert.ok(body.guidesCount >= body.guideSystems);
  });
});

test("every guide file is valid and carries no secrets or server addresses", () => {
  const { systems, errors } = loadGuides(GUIDES_DIR);
  assert.deepEqual(errors, []);
  assert.ok(systems.length > 0);
  for (const file of fs.readdirSync(GUIDES_DIR).filter(f => f.endsWith(".json"))) {
    const text = fs.readFileSync(path.join(GUIDES_DIR, file), "utf8");
    assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, `${file}: IP address`);
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i, `${file}: email address`);
    assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|htpasswd/i, `${file}: key material`);
  }
});

test("validateSystem rejects a guide without steps", () => {
  const errors = validateSystem({ id: "x", name: "X", summary: "s", guides: [{ id: "a", title: "A", steps: [] }] }, "x.json");
  assert.equal(errors.length, 1);
});

test("every course loads, links only to guides that exist, and carries no secrets", () => {
  const { courses, errors } = loadCourses(CURRICULUM, COURSES_DIR);
  assert.deepEqual(errors, []);
  const { systems } = loadGuides(GUIDES_DIR);
  for (const c of courses) {
    const sys = systems.find(s => s.id === c.system);
    for (const l of c.lessons) {
      for (const id of l.guides || []) {
        assert.ok(sys && sys.guides.some(g => g.id === id), `${c.id}/${l.id}: unknown guide "${id}"`);
      }
      for (const q of l.quiz || []) {
        assert.equal(q.options.length, 4, `${l.id}: quiz needs 4 options`);
      }
    }
  }
  for (const file of courseFiles()) {
    const text = fs.readFileSync(path.join(COURSES_DIR, file), "utf8");
    assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, `${file}: IP address`);
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i, `${file}: email address`);
  }
});
