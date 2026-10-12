import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGuides, guidesIndex, guidesCount, renderGuidesUI, scriptJSON, SYSTEM_ORDER } from "./guides.js";
import { loadCourses, findLesson, coursesIndex, ANCOPS_COURSE_ID } from "./courses.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CURRICULUM_FILE = path.join(DATA_DIR, "curriculum.json");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const POSTERS_DIR = path.join(DATA_DIR, "posters");
const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");
const GUIDES_DIR = path.join(DATA_DIR, "guides");
const COURSES_DIR = path.join(DATA_DIR, "courses");

const PORT = parseInt(process.env.PORT || "3155", 10);
const HOST = process.env.ACADEMY_HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

// Load curriculum
let curriculum = JSON.parse(fs.readFileSync(CURRICULUM_FILE, "utf8"));

// Load how-to guides; a file that fails validation is skipped and reported.
const guideLoad = loadGuides(GUIDES_DIR);
const guideSystems = guideLoad.systems;
for (const err of guideLoad.errors) console.error(`[academy] guides: ${err}`);

// Load courses: ANC CC Ops (curriculum.json) first, then one per Govtech system.
const courseLoad = loadCourses(curriculum, COURSES_DIR, SYSTEM_ORDER);
const courses = courseLoad.courses;
for (const err of courseLoad.errors) console.error(`[academy] courses: ${err}`);

// Guide links shown under each lesson: { lessonId: [{ href, title }] }.
function lessonGuideLinks(course) {
  const sys = guideSystems.find(s => s.id === course.system);
  const links = {};
  for (const l of course.lessons) {
    links[l.id] = (l.guides || [])
      .map(id => sys && sys.guides.find(g => g.id === id))
      .filter(Boolean)
      .map(g => ({ href: `/guides/${sys.id}/${g.id}`, title: g.title }));
  }
  return links;
}

// Seat allocations (10 seats, first-come first-served)
let seatsState = {
  total: 10,
  claimed: 4,
  claims: [
    { name: "Sipho Dlamini", role: "Provincial DCIP Lead", region: "Gauteng", date: "2026-10-01" },
    { name: "Nomvula Khumalo", role: "Rapid-Response Coordinator", region: "KZN", date: "2026-10-02" },
    { name: "Bongani Cele", role: "Digital Canvassing Officer", region: "Eastern Cape", date: "2026-10-03" },
    { name: "Tshepo Modise", role: "Media Forensics Researcher", region: "Free State", date: "2026-10-04" }
  ]
};

// In-memory student progress state
const progressStore = new Map();

// Helper: MIME types
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".ico": return "image/x-icon";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

// Stream video with HTTP 206 Partial Content
function streamVideo(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Video not found");
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mime = getMimeType(filePath);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.writeHead(416, {
        "content-range": `bytes */${fileSize}`,
        "content-type": "text/plain"
      });
      return res.end("Requested Range Not Satisfiable");
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "content-range": `bytes ${start}-${end}/${fileSize}`,
      "accept-ranges": "bytes",
      "content-length": chunksize,
      "content-type": mime,
      "cache-control": "public, max-age=3600"
    });

    file.pipe(res);
  } else {
    res.writeHead(200, {
      "content-length": fileSize,
      "content-type": mime,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=3600"
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// Request handler
export function createApp() {
  return function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // Health Check
    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        status: "ok",
        service: "academy",
        domain: "academy.cedec.io",
        timestamp: new Date().toISOString(),
        lessonsCount: curriculum.lessons.length,
        videosCount: curriculum.lessons.filter(l => l.video).length,
        seatsRemaining: seatsState.total - seatsState.claimed,
        coursesCount: courses.length,
        guideSystems: guideSystems.length,
        guidesCount: guidesCount(guideSystems)
      }));
    }

    // API: Courses
    if (pathname === "/api/courses" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ courses: coursesIndex(courses) }));
    }

    if (pathname.startsWith("/api/courses/") && req.method === "GET") {
      const course = courses.find(c => c.id === decodeURIComponent(pathname.replace("/api/courses/", "")));
      if (!course) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Course not found" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ academy: course.academy, lessons: course.lessons }));
    }

    // API: How-to guides
    if (pathname === "/api/guides" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ systems: guidesIndex(guideSystems), guidesCount: guidesCount(guideSystems) }));
    }

    if (pathname.startsWith("/api/guides/") && req.method === "GET") {
      const [sysId, guideId] = pathname.replace("/api/guides/", "").split("/").map(decodeURIComponent);
      const sys = guideSystems.find(s => s.id === sysId);
      const body = sys && guideId ? sys.guides.find(g => g.id === guideId) : sys;
      if (!body) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Guide not found" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    // How-to guides UI (client-side routing below /guides)
    if (pathname === "/guides" || pathname.startsWith("/guides/")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(renderGuidesUI(guideSystems, curriculum.academy));
    }

    // API: Curriculum
    if (pathname === "/api/curriculum" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(curriculum));
    }

    // API: Single Lesson
    if (pathname.startsWith("/api/lessons/") && req.method === "GET") {
      const lessonId = pathname.replace("/api/lessons/", "");
      const lesson = findLesson(courses, lessonId)?.lesson;
      if (!lesson) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Lesson not found" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(lesson));
    }

    // API: Seats Stats
    if (pathname === "/api/stats" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        total: seatsState.total,
        claimed: seatsState.claimed,
        remaining: seatsState.total - seatsState.claimed,
        policy: "First-Come, First-Served Sponsored Seats",
        claims: seatsState.claims
      }));
    }

    // API: Enrol for Seat
    if (pathname === "/api/enrol" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          if (seatsState.claimed >= seatsState.total) {
            res.writeHead(400, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: "All 10 sponsored seats have been claimed!" }));
          }

          const claim = {
            name: (data.name || "Cadre Student").trim(),
            role: (data.role || "Campaign Communicator").trim(),
            region: (data.region || "National").trim(),
            date: new Date().toISOString().split("T")[0]
          };

          seatsState.claimed += 1;
          seatsState.claims.push(claim);

          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({
            success: true,
            message: `Seat confirmed for ${claim.name}! Seat ${seatsState.claimed} of ${seatsState.total}.`,
            seatsRemaining: seatsState.total - seatsState.claimed
          }));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        }
      });
      return;
    }

    // API: Submit Quiz
    if (pathname.startsWith("/api/quiz/") && req.method === "POST") {
      const lessonId = pathname.replace("/api/quiz/", "");
      const lesson = findLesson(courses, lessonId)?.lesson;
      if (!lesson) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Lesson not found" }));
      }

      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { answers } = JSON.parse(body || "{}");
          let correct = 0;
          const results = (lesson.quiz || []).map((q, idx) => {
            const userAnswer = answers ? answers[idx] : null;
            const isCorrect = userAnswer === q.correctIndex;
            if (isCorrect) correct++;
            return {
              question: q.question,
              userAnswer,
              correctAnswer: q.correctIndex,
              isCorrect,
              explanation: q.explanation
            };
          });

          const total = (lesson.quiz || []).length;
          const scorePercent = total > 0 ? Math.round((correct / total) * 100) : 100;
          const passed = scorePercent >= 75;

          // Record in progress store
          progressStore.set(`${lessonId}:quiz`, { passed, scorePercent, date: new Date().toISOString() });

          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({
            lessonId,
            scorePercent,
            correct,
            total,
            passed,
            results
          }));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid quiz payload" }));
        }
      });
      return;
    }

    // API: Record Progress
    if (pathname.startsWith("/api/progress/") && req.method === "POST") {
      const lessonId = pathname.replace("/api/progress/", "");
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          progressStore.set(lessonId, {
            completed: !!data.completed,
            position: data.position || 0,
            duration: data.duration || 0,
            updatedAt: new Date().toISOString()
          });
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ status: "saved", lessonId }));
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid progress payload" }));
        }
      });
      return;
    }

    // Media: Video Stream
    if (pathname.startsWith("/media/videos/")) {
      const fileName = path.basename(pathname.replace("/media/videos/", ""));
      const filePath = path.join(VIDEOS_DIR, fileName);
      return streamVideo(req, res, filePath);
    }

    // Media: Poster Images
    if (pathname.startsWith("/media/posters/")) {
      const fileName = path.basename(pathname.replace("/media/posters/", ""));
      const filePath = path.join(POSTERS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "content-type": getMimeType(filePath), "cache-control": "public, max-age=86400" });
        return fs.createReadStream(filePath).pipe(res);
      }
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Poster not found");
    }

    // Media: Screenshot Images
    if (pathname.startsWith("/media/screenshots/")) {
      const fileName = path.basename(pathname.replace("/media/screenshots/", ""));
      const filePath = path.join(SCREENSHOTS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "content-type": getMimeType(filePath), "cache-control": "public, max-age=86400" });
        return fs.createReadStream(filePath).pipe(res);
      }
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Screenshot not found");
    }

    // Brand Icons
    if (pathname === "/favicon.svg" || pathname === "/favicon.ico") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><clipPath id="r"><rect x="3" y="3" width="58" height="58" rx="13"/></clipPath></defs><g clip-path="url(#r)"><rect x="3" y="3" width="58" height="19.33" fill="#060d0a"/><rect x="3" y="22.33" width="58" height="19.33" fill="#007a3d"/><rect x="3" y="41.66" width="58" height="19.34" fill="#ffc72c"/></g><rect x="3" y="3" width="58" height="58" rx="13" fill="none" stroke="#ffc72c" stroke-opacity="0.8" stroke-width="2.5"/><circle cx="32" cy="32" r="10" fill="#0b1f2a" stroke="#ffc72c" stroke-width="1.5"/><text x="32" y="36" font-family="system-ui, sans-serif" font-weight="900" font-size="11" fill="#ffc72c" text-anchor="middle">CC</text></svg>`);
    }

    // Course catalogue
    if (pathname === "/courses") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(renderCoursesUI(courses, curriculum.academy));
    }

    // Render Web UI: "/" is the ANC CC Ops course; /course/<id> any course
    const courseMatch = pathname.match(/^\/course\/([^/]+)\/?$/);
    if (pathname === "/" || pathname.startsWith("/lesson/") || courseMatch) {
      const course = courseMatch ? courses.find(c => c.id === decodeURIComponent(courseMatch[1])) : courses[0];
      if (!course) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Course not found");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(renderAcademyUI({ academy: course.academy, lessons: course.lessons }, seatsState, {
        courseId: course.id,
        coursesCount: courses.length,
        guideLinks: lessonGuideLinks(course)
      }));
    }

    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Not Found");
  };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Course catalogue page
function renderCoursesUI(list, academy) {
  const cards = list.map(c => `
      <a class="card" href="${c.id === ANCOPS_COURSE_ID ? "/" : `/course/${encodeURIComponent(c.id)}`}">
        <h3>${escapeHtml(c.name)}</h3>
        <p class="tag">${escapeHtml(c.tagline)}</p>
        <p class="clamp">${escapeHtml(c.summary)}</p>
        <div class="meta">${c.lessons.length} modules${c.lessons.some(l => l.video) ? ` · ${c.lessons.filter(l => l.video).length} videos` : ""}</div>
      </a>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>All Courses · ${escapeHtml(academy.name)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root { --green: #007a3d; --gold: #ffc72c; --bg: #060d0a; --card: #14241d; --border: #213d31; --text: #f8fafc; --muted: #94a3b8; --dim: #64748b; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; }
    header { background: rgba(11,31,42,0.97); border-bottom: 2px solid var(--green); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    header .brand { display: flex; align-items: center; gap: 12px; }
    header img { width: 36px; height: 36px; }
    header h1 { font-size: 17px; font-weight: 800; }
    header p { font-size: 12px; color: var(--muted); }
    header nav { display: flex; gap: 16px; flex-wrap: wrap; }
    header nav a { color: var(--muted); text-decoration: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
    header nav a:hover, header nav a.on { color: var(--gold); }
    main { max-width: 1200px; margin: 0 auto; padding: 28px 24px 60px; }
    h2 { font-size: 26px; font-weight: 800; margin-bottom: 6px; }
    .lead { color: var(--muted); margin-bottom: 22px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    .grid > * { min-width: 0; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px; text-decoration: none; color: var(--text); display: block; transition: border-color .15s, transform .15s; }
    .card:hover { border-color: var(--gold); transform: translateY(-1px); }
    .card h3 { font-size: 16px; font-weight: 800; overflow-wrap: anywhere; }
    .card .tag { color: var(--gold); font-size: 13px; margin: 2px 0 8px; }
    .card p { font-size: 13px; color: var(--muted); }
    .clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .meta { margin-top: 10px; font-size: 12px; color: var(--dim); }
    @media (max-width: 600px) { main { padding: 20px 16px 48px; } header { padding: 10px 16px; } h2 { font-size: 22px; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><img src="/favicon.svg" alt=""><div><h1>All Courses</h1><p>${escapeHtml(academy.name)}</p></div></div>
    <nav><a href="/">ANC CC Ops Course</a><a href="/courses" class="on">All Courses</a><a href="/guides">How-to Guides</a></nav>
  </header>
  <main>
    <h2>Courses for every Govtech system</h2>
    <p class="lead">${list.length} courses, ${list.reduce((n, c) => n + c.lessons.length, 0)} modules. Each module ends with a knowledge check and links to the how-to guides for the tasks it teaches.</p>
    <div class="grid">${cards}</div>
  </main>
</body>
</html>`;
}

// HTML UI Renderer with ANC & CEDEC Branding
function renderAcademyUI(data, seats, opts = {}) {
  const c = data.academy;
  const courseId = opts.courseId || ANCOPS_COURSE_ID;
  const isAncops = courseId === ANCOPS_COURSE_ID;
  const storeKey = isAncops ? "ancops_academy_completed" : `academy_completed_${courseId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapeHtml(c.name)} · ${escapeHtml(c.tagline)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root {
      --anc-green: #007a3d;
      --anc-green-dark: #004d26;
      --anc-green-light: #059669;
      --anc-gold: #ffc72c;
      --anc-gold-dark: #d49e12;
      --anc-black: #060d0a;
      --cedec-navy: #0b1f2a;
      --cedec-slate: #162c38;
      --cedec-gold: #f2b233;
      --bg-main: #060d0a;
      --bg-surface: #0e1a14;
      --bg-card: #14241d;
      --border-color: #213d31;
      --border-gold: rgba(255, 199, 44, 0.3);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: var(--bg-main);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Top Emergency Alert Bar */
    .top-banner {
      background: linear-gradient(90deg, #d49e12, #ffc72c, #f2b233);
      color: #060d0a;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.3px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }
    .top-banner span.badge {
      background: #060d0a;
      color: #ffc72c;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      text-transform: uppercase;
    }
    .top-banner button {
      background: #060d0a;
      color: #ffffff;
      border: none;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .top-banner button:hover {
      background: #007a3d;
      color: #ffc72c;
    }

    /* Header Nav */
    header.main-header {
      background: rgba(11, 31, 42, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 2px solid var(--anc-green);
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .crest-icon {
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: 8px;
      border: 1px solid var(--anc-gold);
      box-shadow: 0 0 12px rgba(255, 199, 44, 0.2);
    }
    .brand-titles h1 {
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.3px;
    }
    .brand-titles h1 span.pill {
      background: var(--anc-green);
      color: var(--anc-gold);
      font-size: 10px;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .brand-titles p {
      font-size: 12px;
      color: var(--text-muted);
    }
    .header-links {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header-links a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: color 0.2s;
    }
    .header-links a:hover {
      color: var(--anc-gold);
    }
    .header-links a.btn-cta {
      background: linear-gradient(135deg, var(--anc-green), var(--anc-green-dark));
      color: #ffffff;
      border: 1px solid rgba(255, 199, 44, 0.4);
      padding: 6px 14px;
      border-radius: 6px;
    }
    .header-links a.btn-cta:hover {
      border-color: var(--anc-gold);
      box-shadow: 0 0 12px rgba(0, 122, 61, 0.4);
    }

    /* Main Container */
    .app-shell {
      display: grid;
      grid-template-columns: 360px 1fr;
      min-height: calc(100vh - 110px);
    }

    /* Sidebar Curriculum Navigation */
    aside.sidebar {
      background: var(--bg-surface);
      border-right: 1px solid var(--border-color);
      overflow-y: auto;
      max-height: calc(100vh - 110px);
      padding: 20px 16px;
    }
    .sidebar-header {
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 16px;
    }
    .sidebar-header h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--anc-gold);
      font-weight: 800;
      margin-bottom: 8px;
    }
    .progress-bar-container {
      background: #060d0a;
      border-radius: 999px;
      height: 8px;
      overflow: hidden;
      border: 1px solid var(--border-color);
      margin-bottom: 6px;
    }
    .progress-bar-fill {
      background: linear-gradient(90deg, var(--anc-green), var(--anc-gold));
      height: 100%;
      width: 0%;
      transition: width 0.4s ease;
    }
    .progress-label {
      font-size: 11px;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
    }

    .lesson-item {
      padding: 12px 14px;
      border-radius: 8px;
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      margin-bottom: 8px;
      transition: all 0.2s;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .lesson-item:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: var(--border-color);
    }
    .lesson-item.active {
      background: var(--bg-card);
      border-color: var(--anc-gold);
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
    }
    .lesson-num {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: #060d0a;
      border: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      color: var(--text-dim);
      flex-shrink: 0;
    }
    .lesson-item.active .lesson-num {
      background: var(--anc-green);
      color: var(--anc-gold);
      border-color: var(--anc-gold);
    }
    .lesson-item.completed .lesson-num {
      background: var(--anc-green);
      color: #ffffff;
    }
    .lesson-meta h3 {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-main);
      line-height: 1.3;
      margin-bottom: 4px;
    }
    .lesson-meta p {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.3;
    }
    .lesson-tags {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .lesson-tag {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(0, 122, 61, 0.2);
      color: #34d399;
      border: 1px solid rgba(0, 122, 61, 0.4);
    }
    .lesson-tag.vid {
      background: rgba(255, 199, 44, 0.15);
      color: #ffc72c;
      border-color: rgba(255, 199, 44, 0.4);
    }

    /* Main Lesson Viewport */
    main.lesson-viewport {
      padding: 32px 40px;
      overflow-y: auto;
      max-height: calc(100vh - 110px);
    }
    .lesson-header {
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 20px;
    }
    .lesson-badges {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      align-items: center;
    }
    .badge-pill {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--anc-green-dark);
      color: var(--anc-gold);
      border: 1px solid var(--border-gold);
    }
    .lesson-header h2 {
      font-size: 28px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.2;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    .lesson-header p.subtitle {
      font-size: 16px;
      color: var(--text-muted);
    }

    /* Video Player Container */
    .video-card {
      background: #000000;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 32px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    }
    .video-frame-wrap {
      position: relative;
      width: 100%;
      background: #000000;
    }
    video#lessonVideoPlayer {
      width: 100%;
      max-height: 520px;
      display: block;
      background: #000000;
    }
    .player-controls-bar {
      background: #0b1410;
      border-top: 1px solid var(--border-color);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ctrl-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .ctrl-btn:hover {
      background: var(--anc-green);
      color: #ffffff;
      border-color: var(--anc-gold);
    }
    .speed-select {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--anc-gold);
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    /* Content Cards */
    .content-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      margin-bottom: 36px;
    }
    .info-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 24px;
    }
    .info-card h4 {
      font-size: 16px;
      font-weight: 800;
      color: var(--anc-gold);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .info-card p {
      font-size: 14.5px;
      color: var(--text-main);
      margin-bottom: 14px;
      line-height: 1.6;
    }
    .info-card ul {
      margin-left: 20px;
      margin-bottom: 14px;
    }
    .info-card li {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    /* Screenshots Gallery */
    .screenshot-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 14px;
    }
    .screenshot-thumb {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      background: #000;
      cursor: pointer;
      transition: transform 0.2s, border-color 0.2s;
      position: relative;
    }
    .screenshot-thumb:hover {
      transform: translateY(-2px);
      border-color: var(--anc-gold);
    }
    .screenshot-thumb img {
      width: 100%;
      height: 160px;
      object-fit: cover;
      display: block;
    }
    .screenshot-caption {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      background: #0a130e;
      border-top: 1px solid var(--border-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Interactive Quiz Section */
    .quiz-card {
      background: linear-gradient(180deg, #112019 0%, #0d1712 100%);
      border: 1px solid var(--border-gold);
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 40px;
    }
    .quiz-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border-color);
    }
    .quiz-header h3 {
      font-size: 18px;
      font-weight: 800;
      color: var(--anc-gold);
    }
    .question-block {
      margin-bottom: 24px;
      background: rgba(0,0,0,0.25);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 18px;
    }
    .question-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 14px;
    }
    .quiz-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .quiz-option {
      background: #070e0a;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13.5px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .quiz-option:hover {
      border-color: var(--anc-green);
      color: #ffffff;
    }
    .quiz-option.selected {
      border-color: var(--anc-gold);
      background: rgba(255, 199, 44, 0.08);
      color: #ffffff;
    }
    .quiz-option.correct {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      font-weight: 700;
    }
    .quiz-option.wrong {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .quiz-feedback {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      display: none;
    }
    .quiz-submit-btn {
      background: linear-gradient(135deg, var(--anc-gold), var(--anc-gold-dark));
      color: #060d0a;
      border: none;
      padding: 12px 28px;
      font-size: 14px;
      font-weight: 800;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 12px;
    }
    .quiz-submit-btn:hover {
      box-shadow: 0 0 16px rgba(255, 199, 44, 0.5);
      transform: translateY(-1px);
    }

    /* Modal for Image Preview */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal-content {
      max-width: 90vw;
      max-height: 90vh;
      background: var(--bg-card);
      border: 1px solid var(--border-gold);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .modal-content img {
      max-width: 100%;
      max-height: 80vh;
      object-fit: contain;
    }
    .modal-footer {
      padding: 12px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #09120c;
    }

    /* Seat Enrolment Modal */
    .enrol-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
      z-index: 1001;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .enrol-card {
      background: var(--bg-card);
      border: 2px solid var(--anc-gold);
      border-radius: 12px;
      width: 100%;
      max-width: 460px;
      padding: 28px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
    }
    .enrol-card h3 {
      font-size: 20px;
      font-weight: 800;
      color: var(--anc-gold);
      margin-bottom: 8px;
    }
    .enrol-card p {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 14px;
    }
    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-dim);
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .form-group input, .form-group select {
      width: 100%;
      background: #060d0a;
      border: 1px solid var(--border-color);
      color: #ffffff;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 14px;
    }
    .enrol-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }

    /* Responsive */
    @media (max-width: 900px) {
      header.main-header { flex-wrap: wrap; gap: 10px; padding: 10px 16px; }
      .header-links { flex-wrap: wrap; gap: 8px 14px; }
      .top-banner { flex-wrap: wrap; }
      .app-shell {
        grid-template-columns: 1fr;
      }
      aside.sidebar {
        max-height: 320px;
      }
      main.lesson-viewport {
        padding: 20px;
      }
    }
  </style>
</head>
<body>

  <!-- Top Alert Banner -->
  ${isAncops ? `<div class="top-banner">
    <span class="badge">Limited Enrolment</span>
    <span>⚡ 10 Sponsored Student Seats (First-Come, First-Served) — <strong id="seatsCount">${seats.total - seats.claimed} Seats Remaining</strong></span>
    <button onclick="openEnrolModal()">Claim Student Seat</button>
  </div>` : ""}

  <!-- Header Navigation -->
  <header class="main-header">
    <div class="header-brand">
      <svg class="crest-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><clipPath id="cr"><rect width="64" height="64" rx="8"/></clipPath></defs>
        <g clip-path="url(#cr)">
          <rect width="64" height="21.33" fill="#060d0a"/>
          <rect y="21.33" width="64" height="21.33" fill="#007a3d"/>
          <rect y="42.66" width="64" height="21.34" fill="#ffc72c"/>
        </g>
        <circle cx="32" cy="32" r="11" fill="#0b1f2a" stroke="#ffc72c" stroke-width="1.5"/>
        <text x="32" y="36" font-family="system-ui" font-weight="900" font-size="10" fill="#ffc72c" text-anchor="middle">CC</text>
      </svg>
      <div class="brand-titles">
        <h1>${escapeHtml(c.name)} <span class="pill">CEDEC AFRICA</span></h1>
        <p>${escapeHtml(c.tagline)}</p>
      </div>
    </div>
    <div class="header-links">
      <a href="/courses">All Courses (${opts.coursesCount || 1})</a>
      <a href="/guides">How-to Guides</a>
      ${isAncops ? `<a href="https://ancops.cedec.io" target="_blank" rel="noopener">ANC CC Ops Portal ↗</a>
      <a href="https://chat.wevoteanc.cedec.io" target="_blank" rel="noopener">WeVote Chatbot ↗</a>
      <a href="#enroll" class="btn-cta" onclick="openEnrolModal()">Enrol Cadre</a>` : ""}
    </div>
  </header>

  <!-- App Main Shell -->
  <div class="app-shell">
    
    <!-- Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>${isAncops ? "Command Curriculum" : "Course Lessons"}</h2>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="curriculumProgressFill"></div>
        </div>
        <div class="progress-label">
          <span id="progressCompletedText">0 of ${data.lessons.length} Modules Completed</span>
          <span id="progressPercentText">0%</span>
        </div>
      </div>

      <div class="lessons-list" id="lessonsList">
        ${data.lessons.map((l, idx) => `
          <div class="lesson-item ${idx === 0 ? 'active' : ''}" id="lessonTab-${l.id}" onclick="selectLesson('${l.id}')">
            <div class="lesson-num">${l.moduleNumber}</div>
            <div class="lesson-meta">
              <h3>${escapeHtml(l.title)}</h3>
              <p>${escapeHtml(l.subtitle)}</p>
              <div class="lesson-tags">
                <span class="lesson-tag">${escapeHtml(l.badge)}</span>
                ${l.video ? `<span class="lesson-tag vid">▶ Video (${l.duration})</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </aside>

    <!-- Main Lesson Viewport -->
    <main class="lesson-viewport" id="lessonContent">
      <!-- Injected dynamically via JavaScript -->
    </main>

  </div>

  <!-- Screenshot Modal -->
  <div class="modal-overlay" id="imageModal" onclick="closeImageModal()">
    <div class="modal-content" onclick="event.stopPropagation()">
      <img id="modalImg" src="" alt="Interface preview">
      <div class="modal-footer">
        <span id="modalCaption" style="font-size:13px; font-weight:700; color:#ffc72c;"></span>
        <button class="ctrl-btn" onclick="closeImageModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Seat Enrolment Modal -->
  <div class="enrol-modal" id="enrolModal">
    <div class="enrol-card">
      <h3>Enrol for Sponsored Seat</h3>
      <p>Ten fully sponsored seats are allocated for ANC national communicators, provincial spokespersons, and research officers on a strict first-come, first-served basis.</p>
      
      <form id="enrolForm" onsubmit="submitEnrolment(event)">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" id="enrolName" required placeholder="e.g. Comrade K. Mokoena">
        </div>
        <div class="form-group">
          <label>Designated Role</label>
          <select id="enrolRole" required>
            <option value="Communicator / Spokesperson">Communicator / Spokesperson</option>
            <option value="Ops Officer">Ops Officer</option>
            <option value="Rapid-Response Lead">Rapid-Response Lead</option>
            <option value="Fact-Checker / Researcher">Fact-Checker / Researcher</option>
            <option value="Provincial DCIP Coordinator">Provincial DCIP Coordinator</option>
          </select>
        </div>
        <div class="form-group">
          <label>Province / Region</label>
          <select id="enrolRegion" required>
            <option value="National HQ">National HQ (Luthuli House)</option>
            <option value="Gauteng">Gauteng</option>
            <option value="KwaZulu-Natal">KwaZulu-Natal</option>
            <option value="Eastern Cape">Eastern Cape</option>
            <option value="Western Cape">Western Cape</option>
            <option value="Limpopo">Limpopo</option>
            <option value="Mpumalanga">Mpumalanga</option>
            <option value="Free State">Free State</option>
            <option value="North West">North West</option>
            <option value="Northern Cape">Northern Cape</option>
          </select>
        </div>
        <div class="enrol-actions">
          <button type="button" class="ctrl-btn" onclick="closeEnrolModal()">Cancel</button>
          <button type="submit" class="quiz-submit-btn" style="margin-top:0;">Claim Seat</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const CURRICULUM = ${scriptJSON(data)};
    const GUIDE_LINKS = ${scriptJSON(opts.guideLinks || {})};
    const STORE_KEY = ${scriptJSON(storeKey)};
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    let activeLessonId = CURRICULUM.lessons[0].id;
    let completedLessons = [];
    try { completedLessons = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch {}
    let quizSelections = {};

    function updateProgress() {
      const count = completedLessons.length;
      const total = CURRICULUM.lessons.length;
      const pct = Math.round((count / total) * 100);

      document.getElementById("curriculumProgressFill").style.width = pct + "%";
      document.getElementById("progressCompletedText").innerText = count + " of " + total + " Modules Completed";
      document.getElementById("progressPercentText").innerText = pct + "%";

      CURRICULUM.lessons.forEach(l => {
        const tab = document.getElementById("lessonTab-" + l.id);
        if (tab) {
          if (completedLessons.includes(l.id)) {
            tab.classList.add("completed");
          } else {
            tab.classList.remove("completed");
          }
        }
      });
    }

    function selectLesson(id) {
      activeLessonId = id;
      document.querySelectorAll(".lesson-item").forEach(el => el.classList.remove("active"));
      const activeTab = document.getElementById("lessonTab-" + id);
      if (activeTab) activeTab.classList.add("active");

      const lesson = CURRICULUM.lessons.find(l => l.id === id);
      if (!lesson) return;

      renderLesson(lesson);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function renderLesson(l) {
      const viewport = document.getElementById("lessonContent");
      const isCompleted = completedLessons.includes(l.id);

      let videoSection = "";
      if (l.video) {
        videoSection = \`
          <div class="video-card">
            <div class="video-frame-wrap">
              <video id="lessonVideoPlayer" controls poster="/media/posters/\${l.poster || 'ancops-intro.jpg'}" preload="metadata">
                <source src="/media/videos/\${l.video}" type="\${/\.webm$/i.test(l.video) ? 'video/webm' : 'video/mp4'}">
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
            <div class="player-controls-bar">
              <div class="control-group">
                <button class="ctrl-btn" onclick="seekRelative(-5)">« 5s Rewind</button>
                <button class="ctrl-btn" onclick="seekRelative(5)">5s Forward »</button>
              </div>
              <div class="control-group">
                <span style="font-size:12px; color:#94a3b8; font-weight:700;">Speed:</span>
                <select class="speed-select" onchange="changeSpeed(this.value)">
                  <option value="0.75">0.75x</option>
                  <option value="1.0" selected>1.0x (Normal)</option>
                  <option value="1.25">1.25x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2.0">2.0x</option>
                </select>
              </div>
            </div>
          </div>
        \`;
      }

      let screenshotsSection = "";
      if (l.screenshots && l.screenshots.length > 0) {
        screenshotsSection = \`
          <div class="info-card">
            <h4>Interface Screens</h4>
            <p>Screens from the system that this module covers:</p>
            <div class="screenshot-gallery">
              \${l.screenshots.map(s => \`
                <div class="screenshot-thumb" onclick="openImageModal('/media/screenshots/\${s}', '\${s}')">
                  <img src="/media/screenshots/\${s}" alt="\${s}">
                  <div class="screenshot-caption">\${s}</div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      let quizSection = "";
      if (l.quiz && l.quiz.length > 0) {
        quizSection = \`
          <div class="quiz-card">
            <div class="quiz-header">
              <h3>Module Knowledge Check</h3>
              <span class="badge-pill">Passing Score: 75%</span>
            </div>
            <form id="quizForm" onsubmit="submitQuiz(event, '\${l.id}')">
              \${l.quiz.map((q, qIdx) => \`
                <div class="question-block" id="qBlock-\${qIdx}">
                  <div class="question-title">\${qIdx + 1}. \${esc(q.question)}</div>
                  <div class="quiz-options">
                    \${q.options.map((opt, oIdx) => \`
                      <div class="quiz-option" id="opt-\${qIdx}-\${oIdx}" onclick="selectOption(\${qIdx}, \${oIdx})">
                        <span>\${String.fromCharCode(65 + oIdx)}.</span> \${esc(opt)}
                      </div>
                    \`).join('')}
                  </div>
                  <div class="quiz-feedback" id="feedback-\${qIdx}"></div>
                </div>
              \`).join('')}
              <button type="submit" class="quiz-submit-btn">Verify Module Knowledge</button>
            </form>
          </div>
        \`;
      }

      viewport.innerHTML = \`
        <div class="lesson-header">
          <div class="lesson-badges">
            <span class="badge-pill">Module \${l.moduleNumber}</span>
            <span class="badge-pill" style="background:#0b1f2a; border-color:#f2b233;">\${esc(l.badge)}</span>
            <span style="font-size:12px; color:#64748b; margin-left:auto;">Estimated: \${esc(l.duration)}</span>
          </div>
          <h2>\${esc(l.title)}</h2>
          <p class="subtitle">\${esc(l.subtitle)}</p>
        </div>

        \${videoSection}

        <div class="content-grid">
          <div class="info-card">
            <h4>Strategic Context & Overview</h4>
            <p>\${esc(l.overview)}</p>
            <h4>Key Architectural Principles</h4>
            <ul>
              \${(l.keyPoints || []).map(p => \`<li>\${esc(p)}</li>\`).join('')}
            </ul>
          </div>

          <div class="info-card">
            <h4>Standard Operational Procedures</h4>
            <ul>
              \${(l.operationalProcedures || []).map(p => \`<li>\${esc(p)}</li>\`).join('')}
            </ul>
            <h4>Critical Operational Non-Negotiables</h4>
            <ul>
              \${(l.takeaways || []).map(t => \`<li style="color:#ffc72c; font-weight:600;">⚠️ \${esc(t)}</li>\`).join('')}
            </ul>
          </div>

          \${screenshotsSection}

          \${(GUIDE_LINKS[l.id] || []).length ? \`
          <div class="info-card">
            <h4>How-to Guides for This Module</h4>
            <ul>
              \${GUIDE_LINKS[l.id].map(g => \`<li><a href="\${esc(g.href)}" style="color:#ffc72c;">\${esc(g.title)}</a></li>\`).join('')}
            </ul>
          </div>\` : ''}
        </div>

        \${quizSection}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; padding-top:20px; border-top:1px solid var(--border-color);">
          <button class="ctrl-btn" onclick="toggleCompletion('\${l.id}')">
            \${isCompleted ? '✓ Mark as Incomplete' : '✓ Mark Module as Completed'}
          </button>
          <button class="quiz-submit-btn" style="margin-top:0;" onclick="nextLesson()">
            Next Module →
          </button>
        </div>
      \`;

      // Set up video persistence if player exists
      const vid = document.getElementById("lessonVideoPlayer");
      if (vid) {
        const savedPos = localStorage.getItem("ancops_pos_" + l.id);
        if (savedPos) vid.currentTime = parseFloat(savedPos);

        vid.addEventListener("timeupdate", () => {
          if (vid.currentTime > 0) {
            localStorage.setItem("ancops_pos_" + l.id, vid.currentTime);
          }
        });
      }
    }

    function seekRelative(sec) {
      const vid = document.getElementById("lessonVideoPlayer");
      if (vid) {
        vid.currentTime = Math.max(0, vid.currentTime + sec);
      }
    }

    function changeSpeed(val) {
      const vid = document.getElementById("lessonVideoPlayer");
      if (vid) {
        vid.playbackRate = parseFloat(val);
      }
    }

    function selectOption(qIdx, oIdx) {
      quizSelections[qIdx] = oIdx;
      const block = document.getElementById("qBlock-" + qIdx);
      if (block) {
        block.querySelectorAll(".quiz-option").forEach((el, idx) => {
          if (idx === oIdx) el.classList.add("selected");
          else el.classList.remove("selected");
        });
      }
    }

    async function submitQuiz(e, lessonId) {
      e.preventDefault();
      try {
        const res = await fetch("/api/quiz/" + lessonId, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: quizSelections })
        });
        const data = await res.json();

        data.results.forEach((r, idx) => {
          const feedback = document.getElementById("feedback-" + idx);
          const block = document.getElementById("qBlock-" + idx);
          if (feedback && block) {
            feedback.style.display = "block";
            if (r.isCorrect) {
              feedback.style.background = "rgba(16, 185, 129, 0.2)";
              feedback.style.color = "#34d399";
              feedback.innerHTML = "<strong>✓ Correct!</strong> " + esc(r.explanation);
            } else {
              feedback.style.background = "rgba(239, 68, 68, 0.2)";
              feedback.style.color = "#f87171";
              feedback.innerHTML = "<strong>✗ Incorrect.</strong> " + esc(r.explanation);
            }

            block.querySelectorAll(".quiz-option").forEach((opt, oIdx) => {
              if (oIdx === r.correctAnswer) opt.classList.add("correct");
              if (oIdx === r.userAnswer && !r.isCorrect) opt.classList.add("wrong");
            });
          }
        });

        if (data.passed) {
          if (!completedLessons.includes(lessonId)) {
            completedLessons.push(lessonId);
            localStorage.setItem(STORE_KEY, JSON.stringify(completedLessons));
            updateProgress();
          }
          alert("🎉 Congratulations! You scored " + data.scorePercent + "% on this module and passed!");
        } else {
          alert("Knowledge check result: " + data.scorePercent + "%. Review the explanations and retry.");
        }
      } catch (err) {
        alert("Failed to submit quiz: " + err.message);
      }
    }

    function toggleCompletion(id) {
      if (completedLessons.includes(id)) {
        completedLessons = completedLessons.filter(x => x !== id);
      } else {
        completedLessons.push(id);
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(completedLessons));
      updateProgress();
      renderLesson(CURRICULUM.lessons.find(l => l.id === id));
    }

    function nextLesson() {
      const idx = CURRICULUM.lessons.findIndex(l => l.id === activeLessonId);
      if (idx !== -1 && idx < CURRICULUM.lessons.length - 1) {
        selectLesson(CURRICULUM.lessons[idx + 1].id);
      } else {
        alert("🎖️ You have reached the end of " + CURRICULUM.academy.name + "!");
      }
    }

    function openImageModal(src, caption) {
      document.getElementById("modalImg").src = src;
      document.getElementById("modalCaption").innerText = caption;
      document.getElementById("imageModal").style.display = "flex";
    }

    function closeImageModal() {
      document.getElementById("imageModal").style.display = "none";
    }

    function openEnrolModal() {
      document.getElementById("enrolModal").style.display = "flex";
    }

    function closeEnrolModal() {
      document.getElementById("enrolModal").style.display = "none";
    }

    async function submitEnrolment(e) {
      e.preventDefault();
      const name = document.getElementById("enrolName").value;
      const role = document.getElementById("enrolRole").value;
      const region = document.getElementById("enrolRegion").value;

      try {
        const res = await fetch("/api/enrol", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, role, region })
        });
        const data = await res.json();
        if (res.ok) {
          alert("✓ " + data.message);
          document.getElementById("seatsCount").innerText = data.seatsRemaining + " Seats Remaining";
          closeEnrolModal();
        } else {
          alert("Enrolment error: " + data.error);
        }
      } catch (err) {
        alert("Submission failed: " + err.message);
      }
    }

    // Initialize
    updateProgress();
    renderLesson(CURRICULUM.lessons[0]);
  </script>
</body>
</html>`;
}

// Start HTTP server if run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = createApp();
  const server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    console.log(`[academy] ANC CC Ops Academy listening on http://${HOST}:${PORT}`);
    console.log(`[academy] Canonical prod domain: https://academy.cedec.io`);
    console.log(`[academy] Loaded ${curriculum.lessons.length} curriculum modules`);
    console.log(`[academy] Loaded ${courses.length} courses and ${guidesCount(guideSystems)} how-to guides across ${guideSystems.length} systems`);
  });

  process.on("SIGTERM", () => {
    console.log("[academy] SIGTERM received, draining connections...");
    server.close(() => {
      console.log("[academy] Server closed gracefully.");
      process.exit(0);
    });
  });
}

