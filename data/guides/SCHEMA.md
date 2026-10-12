# How-to guide files

One JSON file per Govtech system, `data/guides/<system>.json`. The academy server
loads every `*.json` in this directory at boot and serves it at `/guides`.

Every step is written from the system's own source and documentation, and each
guide names the files it was written from in `sources`. A guide describes what
the code and docs say the system does; it is not evidence that any stage is
deployed or running.

```json
{
  "id": "newt",
  "name": "NEWT",
  "fullName": "Statutory Asset Management & CIDMS Register",
  "category": "Public finance",
  "summary": "One or two sentences: what the system is for and who uses it.",
  "audience": ["Asset manager", "Auditor"],
  "surfaces": ["Web console", "Desktop app", "Android app", "REST API", "CLI"],
  "gettingAccess": "How a user is given access, in words. Never a password, key, token, PIN or gate key.",
  "sources": ["README.md", "docs/USER_GUIDE.md"],
  "guides": [
    {
      "id": "register-an-asset",
      "title": "Register a new asset",
      "goal": "What the user will have achieved.",
      "role": "Who does this (a role the system defines), or \"Any signed-in user\".",
      "level": "Basic | Intermediate | Advanced",
      "before": ["Prerequisite, if any"],
      "steps": [
        "Imperative step, naming the screen, menu, button or command as the system labels it.",
        "..."
      ],
      "result": "What the user sees when it worked.",
      "troubleshooting": [
        { "problem": "Symptom the user sees", "fix": "What to do" }
      ],
      "sources": ["src/pages/Assets.tsx", "docs/USER_GUIDE.md"]
    }
  ]
}
```

Rules for every file:

- No credentials of any kind: no passwords (demo ones included), API keys,
  tokens, PINs, gate keys or htpasswd usernames.
- No hostnames of servers or IP addresses. Public product URLs from the
  system's own manifest may be named.
- No claim that something is live, deployed or verified.
- UI labels are quoted as the code renders them.
