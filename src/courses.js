import fs from "node:fs";
import path from "node:path";

// Courses: the ANC CC Ops course is data/curriculum.json; every other Govtech
// system has data/courses/<system>.json (shape in data/courses/SCHEMA.md).

export const ANCOPS_COURSE_ID = "ancops";
export const ACADEMY_NAME = "Govtech Academy";

export function validateCourse(c, file) {
  const errors = [];
  const where = file || c?.course?.id || "course file";
  if (!c?.course || typeof c.course.id !== "string" || typeof c.course.name !== "string") {
    return [`${where}: missing course.id or course.name`];
  }
  if (!Array.isArray(c.lessons) || c.lessons.length === 0) return [`${where}: "lessons" must be a non-empty array`];
  const seen = new Set();
  c.lessons.forEach((l, i) => {
    const at = `${where} lesson ${i + 1}`;
    if (typeof l.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(l.id)) errors.push(`${at}: id must be kebab-case`);
    else if (seen.has(l.id)) errors.push(`${at}: duplicate id "${l.id}"`);
    seen.add(l.id);
    if (typeof l.title !== "string" || !l.title) errors.push(`${at}: missing title`);
    (l.quiz || []).forEach((q, qi) => {
      if (!Array.isArray(q.options) || q.options.length < 2 || !Number.isInteger(q.correctIndex) ||
          q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        errors.push(`${at} question ${qi + 1}: options/correctIndex invalid`);
      }
    });
  });
  return errors;
}

// Returns courses in display order, the ANC CC Ops course first. Each entry is
// { id, system, name, tagline, summary, audience, academy, lessons }, where
// `academy` is the header block the course page renders.
export function loadCourses(curriculum, dir, systemOrder = []) {
  const errors = [];
  const ancops = {
    id: ANCOPS_COURSE_ID,
    system: "ancops",
    name: curriculum.academy.name,
    tagline: curriculum.academy.tagline,
    summary: curriculum.academy.hero_description || curriculum.academy.tagline,
    audience: [],
    academy: curriculum.academy,
    lessons: curriculum.lessons
  };
  const others = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
      let c;
      try {
        c = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      } catch (e) {
        errors.push(`${file}: invalid JSON (${e.message})`);
        continue;
      }
      const problems = validateCourse(c, file);
      if (c?.course?.id === ANCOPS_COURSE_ID) problems.push(`${file}: course id "${ANCOPS_COURSE_ID}" is reserved for curriculum.json`);
      if (problems.length) {
        errors.push(...problems);
        continue;
      }
      const meta = c.course;
      others.push({
        id: meta.id,
        system: meta.system || meta.id,
        name: meta.name,
        tagline: meta.tagline || "",
        summary: meta.summary || "",
        audience: meta.audience || [],
        academy: { name: meta.name, tagline: meta.tagline || meta.name },
        lessons: c.lessons
      });
    }
  }
  const rank = id => {
    const i = systemOrder.indexOf(id);
    return i === -1 ? systemOrder.length : i;
  };
  others.sort((a, b) => rank(a.system) - rank(b.system) || a.name.localeCompare(b.name));
  // A lesson id must be unique across courses: the quiz API looks lessons up by id.
  const allIds = new Set(ancops.lessons.map(l => l.id));
  const courses = [ancops];
  for (const c of others) {
    const clash = c.lessons.find(l => allIds.has(l.id));
    if (clash) {
      errors.push(`course ${c.id}: lesson id "${clash.id}" is already used by another course`);
      continue;
    }
    c.lessons.forEach(l => allIds.add(l.id));
    courses.push(c);
  }
  return { courses, errors };
}

export function findLesson(courses, lessonId) {
  for (const c of courses) {
    const lesson = c.lessons.find(l => l.id === lessonId);
    if (lesson) return { course: c, lesson };
  }
  return null;
}

export function coursesIndex(courses) {
  return courses.map(c => ({
    id: c.id,
    system: c.system,
    name: c.name,
    tagline: c.tagline,
    summary: c.summary,
    audience: c.audience,
    lessonsCount: c.lessons.length,
    videosCount: c.lessons.filter(l => l.video).length,
    lessons: c.lessons.map(l => ({ id: l.id, moduleNumber: l.moduleNumber, title: l.title }))
  }));
}
