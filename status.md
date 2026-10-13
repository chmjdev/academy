# Status — Govtech Academy

Living record of verified architecture, live capabilities, and deployment state for `academy.cedec.io`.

## Current State (Verified 2026-10-04)

- **Domain**: `https://academy.cedec.io`
- **Host**: `ancopsprod` (`102.201.48.82`)
- **Port**: `3155`
- **Curriculum**: 15 complete modules covering the full ANC Campaign Communications Command Centre platform.
- **Media Engine**: Native HTTP Range (206) media streaming for 9 dedicated campaign operation walkthrough videos.
- **Interface Gallery**: 24 Retina UI screenshots indexed and linked per module.
- **Evaluation**: 15 interactive lesson quizzes with immediate feedback and scoring.
- **Enrolment**: 10 student seats on a first-come, first-served basis.

## How-to guides and South African narration (local, 2026-10-12)

Changed in this checkout, not deployed. Nothing below has been checked against `academy.cedec.io`.

- **How-to guide library** at `/guides` (`/guides/<system>/<guide>` deep links; `/api/guides`, `/api/guides/<system>[/<guide>]`). It holds 155 guides across 10 Govtech systems: ancops 20, abiatda 16, iafrp 16, gaecm 16, newt 15, basimo 16, opsystem 16, opsystemcore 8, peacekeeper 16, policeops 16.
  - Each system is one file, `data/guides/<system>.json`, in the shape set out in `data/guides/SCHEMA.md`.
  - The guides were written from each system's own source and docs, read-only. Each guide lists the files it came from.
  - The server skips any file that fails validation and logs why. `/healthz` reports `guideSystems` and `guidesCount`.
  - The tests reject a guide file containing an IP address, an email address or key material.
- **Narration re-voiced** in a native South African English voice: ElevenLabs "Katlego – Warm & educational". This covers the 8 narrated MP4s; the login walkthrough `.webm` has no audio.
  - The original narration was transcribed with word timestamps, and each sentence was re-voiced and placed at its original start time.
  - Intro and DCIP were spoken slightly faster so they keep their original length. Drift against the picture is 3 s or less.
  - A transcript of every new file matches its original script (word match 0.976–1.000).
  - Working files are in `~/Documents/ElevenLabs/academy-revoice/`. The originals are in git history.
- **Courses for every Govtech system** at `/courses` and `/course/<system>` (`/api/courses`, `/api/courses/<id>`). There are 10 courses, 82 modules, and a knowledge check in every module:
  - ANC CC Ops (`data/curriculum.json`, 15 modules, still served at `/`)
  - abiatda 9, iafrp 9, gaecm 9, newt 9, peacekeeper 8, policeops 9, opsystemcore 6, opsystem 5, basimo 3 (`data/courses/<system>.json`, shape in `data/courses/SCHEMA.md`)
  - Each module links the how-to guides for the tasks it teaches. Progress is kept per course in the browser.
  - The seat banner and ANC links appear only on the ANC CC Ops course.
- **ANC CC Ops course corrected against the ancops code** (`origin/main` d0d4998). Corrections:
  - The 16 roles in `src/auth/accounts.ts`.
  - Email-only sign-in.
  - The gate's three certifications as the gate window names them, and the actions that skip the gate (Counter Active Playbook dispatch, DCIP hub dispatch, one-to-one WhatsApp replies).
  - The real rebuttal stage marks (+15/+30/+60/+90/+118).
  - Feature defaults: only Facebook ads is off by default.
  - Ward, candidate and manifesto counts from `seed/*.json`.
  - Full-text retrieval rather than vector embeddings.
  - Marketing and legal claims the code does not implement were removed.
- `scripts/generate_curriculum.py` was removed. Its lessons were hard-coded, so re-running it would have reverted the corrected course. `data/curriculum.json` is now the source.
- **basimo and opsystem have narrow courses.** Full courses were stopped twice each by an automated safety check. The courses written instead cover only accountable use and leave out every monitoring, collection and missing-person feature:
  - opsystem: install, sign in as yourself, team and devices, evidence custody, the incident lifecycle, and AI output under human review.
  - basimo: navigation, officer provisioning and the audit trail, and the desktop app.
- **Guides corrected 2026-10-12, after course writing re-read the code:**
  - ancops: Investigations, Wards, Manifestos, DCIP and the WhatsApp bot are on by default.
  - opsystem: "✓ SEAL VERIFIED" is unconditional; a fresh device opens as the built-in super-user profile; AI AUTO-FILL defaults; KEEP ACTIVE records nothing; REACTIVATE keeps the original 48-hour clock; CONTAIN & LOCK has no confirmation and the core still accepts evidence.
  - opsystemcore: the page-fetch guard does not cover the 172.16–172.31 range.


## Renamed to Govtech Academy (2026-10-13)

- The site is **Govtech Academy**, and `/healthz` reports `"academy": "Govtech Academy"`.
- The ANC material is now the **ANC CC Ops Course**, one of the ten courses.
- `/` and `/courses` are the course catalogue. The ANC course is at `/course/ancops`, and old `/lesson/...` links answer 301 to it.
- The crest reads "GA". The domain, port, service name and colours are unchanged.
