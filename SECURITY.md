# Security Policy

`works-calendar-engine` is framework-agnostic scheduling logic intended to run
inside third-party pages, sandboxed iframes, web workers, and edge runtimes.
Security of that boundary is a first-class concern — see the "Security &
embeddability" section of the [README](./README.md) for the runtime guarantees
the package commits to (no `eval`, no DOM access, no network, no prototype
pollution surface, Web Crypto only).

## Supported versions

The project is pre-1.0. Security fixes are applied to the latest published
`0.x` minor and released as a new patch version. Older minors are not
backported.

| Version | Supported          |
| ------- | ------------------ |
| latest `0.x` | :white_check_mark: |
| older   | :x:                |

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Report privately via GitHub's
[private vulnerability reporting](https://github.com/WorksCalendar/Engine/security/advisories/new)
("Report a vulnerability" under the repository's Security tab). If you cannot
use that channel, email the maintainer at **natehorst240@gmail.com** with
subject line `SECURITY: works-calendar-engine`.

Please include:

- the affected version(s) and environment (Node / browser / worker / edge),
- a minimal reproduction or proof of concept,
- the impact you believe it has (e.g. incorrect conflict verdict, data
  disclosure, denial of service, prototype pollution).

## What to expect

- **Acknowledgement** within 3 business days.
- **Triage and severity assessment** within 7 business days, using CVSS as a
  guide.
- **Fix or mitigation timeline** communicated after triage. We aim to ship a
  patch for high/critical issues within 30 days of confirmation.
- **Coordinated disclosure**: we will credit reporters (unless anonymity is
  requested) and publish a GitHub Security Advisory once a fix is available.

## Scope

In scope:

- Incorrect security-relevant behavior of the engine itself — e.g. a
  conflict/availability check that can be made to *silently* approve an event
  it should reject, prototype pollution, denial of service via crafted
  recurrence rules or inputs, or tampering with the approval audit chain that
  `verifyAuditChain` fails to detect.

Out of scope:

- Vulnerabilities in host applications that merely consume this library.
- The documented client-only limitation of the audit chain (it is
  tamper-*evident*, not tamper-*proof*, in a browser-only deployment — see
  `src/approvals/auditChain.ts`). Persist and cross-check chain hashes
  server-side for true tamper-evidence.
- Issues requiring a malicious peer dependency (`date-fns`) or a compromised
  build toolchain.
