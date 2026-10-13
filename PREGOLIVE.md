# PREGOLIVE — Govtech Academy

Production is `https://academy.cedec.io` hosted exclusively on the **ANC CC Ops Production server, `102.201.48.82` (ancopsprod)**.
Service Port: `3155`.
Branding: African National Congress (ANC) and CEDEC Africa Digital Governance.

## 1. Verified Architecture

| Component | State |
| --- | --- |
| Domain Authority | `academy.cedec.io` registered in `URLList.yaml` on port 3155 |
| Server Placement | `ancopsprod` (`102.201.48.82`) registered in `remote.conf` |
| Curriculum | 15 comprehensive modules based on the official ANC CC Ops User Guide |
| Video Player & Media | 9 high-definition videos with 206 Range streaming, 24 retina screenshots, posters |
| Quizzes & Certification | Per-module interactive knowledge checks with score tracking and certificate validation |
| Enrolment Management | 10 sponsored student seats with live first-come first-served tracker |
| Isolation & Security | Loopback-bound (`127.0.0.1:3155`), zero external npm runtime dependencies |

## 2. Release Sign-Off
- `"released": true` in `jcds.config`
- All tests pass via `npm test`
- `jcds standards` compliant
