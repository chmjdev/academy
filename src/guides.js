import fs from "node:fs";
import path from "node:path";

// How-to guide library: one JSON file per Govtech system in data/guides/.
// The shape is documented in data/guides/SCHEMA.md.

export const SYSTEM_ORDER = [
  "ancops", "abiatda", "iafrp", "gaecm", "newt",
  "basimo", "opsystem", "opsystemcore", "peacekeeper", "policeops"
];

export function validateSystem(sys, file) {
  const errors = [];
  const where = file || sys?.id || "guide file";
  if (!sys || typeof sys !== "object") return [`${where}: not an object`];
  for (const key of ["id", "name", "summary"]) {
    if (typeof sys[key] !== "string" || !sys[key].trim()) errors.push(`${where}: missing "${key}"`);
  }
  if (!Array.isArray(sys.guides) || sys.guides.length === 0) {
    errors.push(`${where}: "guides" must be a non-empty array`);
    return errors;
  }
  const seen = new Set();
  sys.guides.forEach((g, i) => {
    const at = `${where} guide ${i + 1}`;
    if (typeof g.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(g.id)) errors.push(`${at}: id must be kebab-case`);
    else if (seen.has(g.id)) errors.push(`${at}: duplicate id "${g.id}"`);
    seen.add(g.id);
    if (typeof g.title !== "string" || !g.title.trim()) errors.push(`${at}: missing title`);
    if (!Array.isArray(g.steps) || g.steps.length === 0 || g.steps.some(s => typeof s !== "string" || !s.trim())) {
      errors.push(`${at}: steps must be a non-empty array of strings`);
    }
  });
  return errors;
}

export function loadGuides(dir) {
  const systems = [];
  const errors = [];
  if (!fs.existsSync(dir)) return { systems, errors };
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    let sys;
    try {
      sys = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (e) {
      errors.push(`${file}: invalid JSON (${e.message})`);
      continue;
    }
    const problems = validateSystem(sys, file);
    if (problems.length) {
      errors.push(...problems);
      continue;
    }
    systems.push(sys);
  }
  const rank = id => {
    const i = SYSTEM_ORDER.indexOf(id);
    return i === -1 ? SYSTEM_ORDER.length : i;
  };
  systems.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  return { systems, errors };
}

export function guidesIndex(systems) {
  return systems.map(s => ({
    id: s.id,
    name: s.name,
    fullName: s.fullName || "",
    category: s.category || "",
    summary: s.summary,
    surfaces: s.surfaces || [],
    guidesCount: s.guides.length,
    guides: s.guides.map(g => ({ id: g.id, title: g.title, level: g.level || "", role: g.role || "" }))
  }));
}

export function guidesCount(systems) {
  return systems.reduce((n, s) => n + s.guides.length, 0);
}

// JSON embedded in a <script> must not be able to close the element.
export function scriptJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderGuidesUI(systems, academy) {
  const total = guidesCount(systems);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>How-to Guides · ${academy.name}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root {
      --green: #007a3d; --green-dark: #004d26; --gold: #ffc72c; --navy: #0b1f2a;
      --bg: #060d0a; --surface: #0e1a14; --card: #14241d; --border: #213d31;
      --text: #f8fafc; --muted: #94a3b8; --dim: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; }
    body { min-height: 100vh; overflow-x: hidden; }
    a { color: var(--gold); }
    header { background: rgba(11,31,42,0.97); border-bottom: 2px solid var(--green); position: sticky; top: 0; z-index: 10; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    header .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    header .brand img { width: 36px; height: 36px; flex-shrink: 0; }
    header h1 { font-size: 17px; font-weight: 800; white-space: nowrap; }
    header p { font-size: 12px; color: var(--muted); }
    header nav { display: flex; gap: 16px; }
    header nav a { color: var(--muted); text-decoration: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
    header nav a:hover, header nav a.on { color: var(--gold); }
    .shell { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: calc(100vh - 64px); }
    aside { background: var(--surface); border-right: 1px solid var(--border); padding: 18px 14px; overflow-y: auto; max-height: calc(100vh - 64px); position: sticky; top: 64px; }
    aside input { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 6px; font-size: 14px; margin-bottom: 14px; }
    aside h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--gold); margin: 4px 4px 10px; }
    .sys-link { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; color: var(--text); text-decoration: none; margin-bottom: 4px; }
    .sys-link:hover { background: rgba(255,255,255,0.03); border-color: var(--border); }
    .sys-link.on { background: var(--card); border-color: var(--gold); }
    .sys-link b { font-size: 14px; }
    .sys-link small { display: block; font-size: 11px; color: var(--muted); }
    .count { font-size: 11px; font-weight: 800; color: var(--gold); background: var(--bg); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; flex-shrink: 0; }
    main { padding: 28px 36px 60px; min-width: 0; }
    .crumbs { font-size: 13px; color: var(--dim); margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px; }
    .crumbs a { color: var(--muted); text-decoration: none; }
    .crumbs a:hover { color: var(--gold); }
    h2.title { font-size: 26px; font-weight: 800; line-height: 1.25; margin-bottom: 6px; overflow-wrap: anywhere; }
    p.lead { color: var(--muted); font-size: 15px; margin-bottom: 18px; max-width: 760px; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
    .pill { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(0,122,61,0.2); color: #34d399; border: 1px solid rgba(0,122,61,0.45); white-space: nowrap; }
    .pill.gold { background: rgba(255,199,44,0.12); color: var(--gold); border-color: rgba(255,199,44,0.4); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
    .grid > * { min-width: 0; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px; text-decoration: none; color: var(--text); display: block; transition: border-color .15s, transform .15s; }
    a.card:hover { border-color: var(--gold); transform: translateY(-1px); }
    .card h3 { font-size: 16px; font-weight: 800; margin-bottom: 4px; overflow-wrap: anywhere; }
    .card p { font-size: 13px; color: var(--muted); }
    .card p.clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .card .meta { margin-top: 10px; font-size: 12px; color: var(--dim); }
    .panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px 22px; margin-bottom: 18px; }
    .panel h4 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--gold); margin-bottom: 10px; }
    .panel ul { margin-left: 20px; }
    .panel li { margin-bottom: 6px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
    ol.steps { list-style: none; counter-reset: s; }
    ol.steps li { counter-increment: s; position: relative; padding: 0 0 14px 44px; font-size: 15px; color: var(--text); overflow-wrap: anywhere; }
    ol.steps li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 8px; background: var(--green); color: var(--gold); font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; }
    .result { border-left: 3px solid #10b981; }
    .trouble dt { font-weight: 700; font-size: 14px; margin-top: 8px; }
    .trouble dd { color: var(--muted); font-size: 14px; margin-left: 0; }
    .sources { font-size: 12px; color: var(--dim); }
    .sources code { color: var(--muted); overflow-wrap: anywhere; }
    .pager { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
    .pager a { color: var(--gold); text-decoration: none; font-weight: 700; font-size: 14px; }
    .empty { color: var(--muted); padding: 30px 0; }
    .note { font-size: 12px; color: var(--dim); margin-top: 26px; max-width: 760px; }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      aside { position: static; max-height: none; border-right: none; border-bottom: 1px solid var(--border); }
      #sysList { display: flex; flex-wrap: wrap; gap: 6px; }
      .sys-link { margin-bottom: 0; padding: 6px 10px; border-color: var(--border); }
      .sys-link b { font-size: 13px; }
      .sys-link small { display: none; }
      main { padding: 20px 16px 48px; }
      header { padding: 10px 16px; }
      h2.title { font-size: 22px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <img src="/favicon.svg" alt="">
      <div>
        <h1>How-to Guides</h1>
        <p>${academy.name}</p>
      </div>
    </div>
    <nav>
      <a href="/">All Courses</a>
      <a href="/guides" class="on">How-to Guides</a>
    </nav>
  </header>
  <div class="shell">
    <aside>
      <input id="q" type="search" placeholder="Search ${total} guides…" aria-label="Search guides">
      <h2>Systems</h2>
      <div id="sysList"></div>
    </aside>
    <main id="view"></main>
  </div>
  <script>
    const LIBRARY = ${scriptJSON(systems)};
    const ACADEMY_NAME = ${scriptJSON(academy.name)};
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const view = document.getElementById("view");
    const q = document.getElementById("q");

    function route() {
      const parts = location.pathname.replace(/^\\/guides\\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      return { sys: parts[0] || null, guide: parts[1] || null };
    }
    function go(href) { history.pushState(null, "", href); render(); window.scrollTo({ top: 0 }); }
    document.addEventListener("click", e => {
      const a = e.target.closest("a[data-nav]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(a.getAttribute("href"));
    });
    window.addEventListener("popstate", render);
    q.addEventListener("input", render);

    function sidebar(active) {
      document.getElementById("sysList").innerHTML = LIBRARY.map(s =>
        '<a data-nav class="sys-link' + (s.id === active ? ' on' : '') + '" href="/guides/' + esc(s.id) + '">' +
          '<span><b>' + esc(s.name) + '</b><small>' + esc(s.category || s.fullName || "") + '</small></span>' +
          '<span class="count">' + s.guides.length + '</span></a>'
      ).join("");
    }

    function guideCard(s, g) {
      return '<a data-nav class="card" href="/guides/' + esc(s.id) + '/' + esc(g.id) + '">' +
        '<h3>' + esc(g.title) + '</h3><p>' + esc(g.goal || "") + '</p>' +
        '<div class="meta">' + esc(s.name) + (g.role ? ' · ' + esc(g.role) : '') + (g.level ? ' · ' + esc(g.level) : '') + '</div></a>';
    }

    function renderSearch(term) {
      const t = term.toLowerCase();
      const hits = [];
      LIBRARY.forEach(s => s.guides.forEach(g => {
        const hay = [s.name, s.fullName, g.title, g.goal, g.role, (g.steps || []).join(" ")].join(" ").toLowerCase();
        if (hay.includes(t)) hits.push(guideCard(s, g));
      }));
      view.innerHTML = '<h2 class="title">Search</h2><p class="lead">' + hits.length + ' guide' + (hits.length === 1 ? '' : 's') + ' match “' + esc(term) + '”.</p>' +
        (hits.length ? '<div class="grid">' + hits.join("") + '</div>' : '<p class="empty">No guide matches. Try a system name or a task, such as “import” or “report”.</p>');
    }

    function renderHome() {
      const total = LIBRARY.reduce((n, s) => n + s.guides.length, 0);
      view.innerHTML = '<h2 class="title">How-to guides for every Govtech system</h2>' +
        '<p class="lead">' + total + ' step-by-step guides across ' + LIBRARY.length + ' systems. Pick a system, then the task you need to do.</p>' +
        '<div class="grid">' + LIBRARY.map(s =>
          '<a data-nav class="card" href="/guides/' + esc(s.id) + '"><h3>' + esc(s.name) + '</h3>' +
          (s.fullName ? '<p style="color:var(--text)">' + esc(s.fullName) + '</p>' : '') +
          '<p class="clamp">' + esc(s.summary) + '</p><div class="meta">' + s.guides.length + ' guides' + (s.category ? ' · ' + esc(s.category) : '') + '</div></a>'
        ).join("") + '</div>' +
        '<p class="note">Each guide is written from the system\\'s own source code and documentation and lists the files it came from. A guide describes how the system is used; it does not say which environments are available to you. Your administrator issues access.</p>';
    }

    function renderSystem(s) {
      const groups = {};
      s.guides.forEach(g => { const k = g.level || "Guides"; (groups[k] = groups[k] || []).push(g); });
      const order = ["Basic", "Intermediate", "Advanced"].filter(k => groups[k]).concat(Object.keys(groups).filter(k => !["Basic", "Intermediate", "Advanced"].includes(k)));
      view.innerHTML = '<div class="crumbs"><a data-nav href="/guides">All systems</a><span>›</span><span>' + esc(s.name) + '</span></div>' +
        '<h2 class="title">' + esc(s.fullName ? s.name + ' — ' + s.fullName : s.name) + '</h2>' +
        '<p class="lead">' + esc(s.summary) + '</p>' +
        '<div class="pills">' + (s.surfaces || []).map(x => '<span class="pill">' + esc(x) + '</span>').join("") +
          (s.audience || []).map(x => '<span class="pill gold">' + esc(x) + '</span>').join("") + '</div>' +
        (s.gettingAccess ? '<div class="panel"><h4>Getting access</h4><p style="color:var(--muted);font-size:14px">' + esc(s.gettingAccess) + '</p></div>' : '') +
        order.map(k => '<h4 style="color:var(--gold);font-size:13px;text-transform:uppercase;letter-spacing:.6px;margin:22px 0 10px">' + esc(k) + '</h4><div class="grid">' + groups[k].map(g => guideCard(s, g)).join("") + '</div>').join("");
    }

    function renderGuide(s, g) {
      const i = s.guides.indexOf(g);
      const prev = s.guides[i - 1], next = s.guides[i + 1];
      const list = (title, items) => items && items.length ? '<div class="panel"><h4>' + title + '</h4><ul>' + items.map(x => '<li>' + esc(x) + '</li>').join("") + '</ul></div>' : '';
      view.innerHTML = '<div class="crumbs"><a data-nav href="/guides">All systems</a><span>›</span><a data-nav href="/guides/' + esc(s.id) + '">' + esc(s.name) + '</a><span>›</span><span>Guide ' + (i + 1) + ' of ' + s.guides.length + '</span></div>' +
        '<h2 class="title">' + esc(g.title) + '</h2>' +
        (g.goal ? '<p class="lead">' + esc(g.goal) + '</p>' : '') +
        '<div class="pills"><span class="pill gold">' + esc(s.name) + '</span>' + (g.role ? '<span class="pill">' + esc(g.role) + '</span>' : '') + (g.level ? '<span class="pill">' + esc(g.level) + '</span>' : '') + '</div>' +
        list("Before you start", g.before) +
        '<div class="panel"><h4>Steps</h4><ol class="steps">' + g.steps.map(x => '<li>' + esc(x) + '</li>').join("") + '</ol></div>' +
        (g.result ? '<div class="panel result"><h4>When it worked</h4><p style="font-size:14px">' + esc(g.result) + '</p></div>' : '') +
        (g.troubleshooting && g.troubleshooting.length ? '<div class="panel"><h4>If something goes wrong</h4><dl class="trouble">' + g.troubleshooting.map(t => '<dt>' + esc(t.problem) + '</dt><dd>' + esc(t.fix) + '</dd>').join("") + '</dl></div>' : '') +
        (g.sources && g.sources.length ? '<p class="sources">Written from ' + g.sources.map(x => '<code>' + esc(x) + '</code>').join(", ") + '.</p>' : '') +
        '<div class="pager" style="margin-top:20px">' +
          (prev ? '<a data-nav href="/guides/' + esc(s.id) + '/' + esc(prev.id) + '">← ' + esc(prev.title) + '</a>' : '<span></span>') +
          (next ? '<a data-nav href="/guides/' + esc(s.id) + '/' + esc(next.id) + '">' + esc(next.title) + ' →</a>' : '') +
        '</div>';
      document.title = g.title + " · " + s.name + " · How-to Guides";
    }

    function render() {
      const r = route();
      const s = LIBRARY.find(x => x.id === r.sys);
      sidebar(s ? s.id : null);
      document.title = "How-to Guides · " + ACADEMY_NAME;
      const term = q.value.trim();
      if (term) return renderSearch(term);
      if (!LIBRARY.length) { view.innerHTML = '<p class="empty">No guides are loaded.</p>'; return; }
      if (!s) return r.sys ? (view.innerHTML = '<p class="empty">No system called “' + esc(r.sys) + '”. <a data-nav href="/guides">All systems</a></p>') : renderHome();
      if (!r.guide) return renderSystem(s);
      const g = s.guides.find(x => x.id === r.guide);
      if (!g) { view.innerHTML = '<p class="empty">No such guide in ' + esc(s.name) + '. <a data-nav href="/guides/' + esc(s.id) + '">All ' + esc(s.name) + ' guides</a></p>'; return; }
      renderGuide(s, g);
    }
    render();
  </script>
</body>
</html>`;
}
