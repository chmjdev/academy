# Course files

The ANC CC Ops course is `data/curriculum.json`. Every other Govtech system has
one course file, `data/courses/<system>.json`, where `<system>` is the same id as
its guide file in `data/guides/`. The academy server loads them at boot and
serves each at `/course/<system>`.

```json
{
  "course": {
    "id": "newt",
    "system": "newt",
    "name": "NEWT Asset Register Course",
    "tagline": "One line: what the learner will be able to do.",
    "summary": "Two or three sentences on the system and who the course is for.",
    "audience": ["Asset manager", "Field verifier"]
  },
  "lessons": [
    {
      "id": "newt-01-orientation",
      "moduleNumber": 1,
      "title": "Lesson title",
      "subtitle": "One line",
      "badge": "Short category, e.g. Foundations",
      "duration": "10 min",
      "video": null,
      "poster": null,
      "screenshots": [],
      "overview": "A paragraph explaining the concept and why it matters.",
      "keyPoints": ["Fact the learner must know", "..."],
      "operationalProcedures": ["1. Step, named as the system labels it.", "2. ..."],
      "takeaways": ["Rule or consequence the learner must not forget"],
      "guides": ["register-an-asset"],
      "quiz": [
        {
          "question": "…?",
          "options": ["A", "B", "C", "D"],
          "correctIndex": 1,
          "explanation": "Why that answer is right."
        }
      ]
    }
  ]
}
```

Rules:

- Everything is written from the system's own source and docs. Where docs and
  code disagree, the code wins.
- `guides` lists ids that exist in `data/guides/<system>.json`.
- Every quiz has exactly 4 options and one correct answer whose position varies
  across questions; wrong options are plausible, never jokes.
- No credentials of any kind (including demo passwords), no server hostnames,
  no IP addresses, no claim that anything is live or deployed, no real
  person's name.
