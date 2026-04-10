# Notification Bus — Implementation Plan

> **Status: DRAFT — Requirements not yet closed**
>
> This document is a placeholder. No design decisions should be recorded here
> until the requirements document (`notification_bus_requirements.md`) is
> signed off. Items below are stubs only.

---

## Prerequisites

- [ ] Requirements document closed and approved
- [ ] Open questions in requirements resolved
- [ ] Affected systems identified and owners confirmed

---

## Design Decisions

*To be filled in after requirements are closed.*

---

## Schema Changes

*To be filled in after requirements are closed.*

---

## Service Changes

*To be filled in after requirements are closed.*

---

## Migration & Rollout

*To be filled in after requirements are closed.*

---

## Open Design Items

Items that arose during requirements discussion and need resolution before
design can proceed. Add items here as they come up.

| # | Item | Raised | Decision | Status |
|---|---|---|---|---|
| 1 | Challenge expiry timeout | Requirements discussion | 60 seconds | Closed |
| 2 | Buddy list — one-way follow or mutual? | Requirements discussion | Mutual — requires friend request flow | Closed |
| 3 | SMS provider | Requirements discussion | TBD — schema placeholder only, no provider selected | Closed |
| 4 | Email sender identity | Requirements discussion | `noreply@aiarena.callidity.com`, env-var configurable (`EMAIL_FROM`) | Closed |
| 5 | `readAt` vs `deliveredAt` | Requirements discussion | Track both | Closed |
| 6 | Scheduler ownership | Requirements discussion | Embedded in backend; modular with no direct backend imports so extraction is a deploy change not a rewrite | Closed |
| 7 | Cohort fan-out at scale | Requirements discussion | Individual socket rooms now; revisit at ~10k concurrent users with Redis room broadcasts | Closed |

---

## Testing Plan

*To be filled in after requirements are closed.*

---

## Rollout Checklist

*To be filled in after requirements are closed.*
