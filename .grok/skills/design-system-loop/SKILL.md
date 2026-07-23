---
name: design-system-loop
description: >
  Design-system registry loop (produce → consume → feedback → re-add) for startist-ui
  and product apps (Pentou). Use when working on @startist, shadcn registry, UI primitives,
  theme tokens, re-add after API fixes, or cross-repo producer/consumer handoff.
  Slash: /design-system-loop. Canonical body lives in skills/design-system-loop/ (repo root).
---

# design-system-loop (Grok entry)

**Canonical skill path (always load this first):**

`skills/design-system-loop/SKILL.md`

Then load only the reference needed for the current phase:

| Phase | File |
| --- | --- |
| PRODUCE (true source / startist-ui) | `skills/design-system-loop/references/produce-brief.md` |
| CONSUME (product app) | `skills/design-system-loop/references/consume-checklist.md` |
| FEEDBACK + RE-ADD | `skills/design-system-loop/references/feedback-and-readd.md` |
| Dual-agent / cross-repo handoff | `skills/design-system-loop/references/cross-agent-handoff.md` |

Do not duplicate rules here. If the files above are missing, stop and tell the user the project skill is not checked out.
