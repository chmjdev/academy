import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createApp } from "../src/server.js";

test("ANC CC Ops Academy server test suite", async (t) => {
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
    assert.equal(body.academy.name, "ANC CC Ops Academy");
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

  await t.test("GET / serves HTML portal with ANC and CEDEC branding", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.ok(html.includes("ANC CC Ops Academy"));
    assert.ok(html.includes("CEDEC AFRICA"));
    assert.ok(html.includes("10 Sponsored Student Seats"));
  });
});
