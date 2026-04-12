# XO Arena — UI Peer Review Brief

> **Give this document to a reviewing AI along with screenshots of each surface.**
> The reviewer should navigate the staging site, screenshot each screen, and fill in the
> findings section at the bottom.

---

## What You're Reviewing

**XO Arena** is a competitive Tic-Tac-Toe platform with two distinct visual identities:

| Site | URL | Visual Theme |
|---|---|---|
| Main app | https://xo-frontend-staging.fly.dev | AI Arena — Colosseum imagery, slate-blue palette |
| Landing page | https://xo-landing-staging.fly.dev | XO.AIArena — mountain background, teal/blue palette |

The app has **light and dark modes**. Review both where possible — toggle via the sun/moon icon in the top nav.

The tech stack is React + Tailwind + CSS custom properties (design tokens). The UI must work on **desktop and mobile** — this is a hard requirement.

---

## Test Accounts

### Unregistered / Guest
Simply visit the site without signing in. You will see the guest experience.

### Registered User (pre-verified)
| Field | Value |
|---|---|
| URL | https://xo-frontend-staging.fly.dev |
| Email | `xo-review@mailinator.com` |
| Password | `XoReview2026!` |
| Status | Email verified, account active |

Sign in via the "Sign In" button — use **Email** tab, not a social provider.

---

## Review Surfaces (in order)

Work through these surfaces top to bottom. For each one: screenshot it, then evaluate it against the criteria below.

### 1. Landing Page (unregistered)
- Visit https://xo-landing-staging.fly.dev
- Check: hero section, nav, CTA buttons, About, FAQ sections
- Resize to mobile (375px wide)

### 2. Landing → App transition
- Click "Play Now" or "Sign In" from the landing page
- Does the handoff feel seamless? Does the visual identity shift make sense?

### 3. Sign-in / Sign-up modal
- On the main app (https://xo-frontend-staging.fly.dev), trigger the auth modal
- Check: email + password form, social login buttons, toggle between sign in / sign up
- Check: error states (wrong password, invalid email format)
- Check on mobile

### 4. Guest welcome experience
- Visit the main app without signing in
- Note what a guest can and cannot do
- Is the "register to get full access" prompt clear without being pushy?
- Is there a welcome modal or guide prompt for first-time visitors?

### 5. First login / Onboarding (Journey)
- Sign in with the test account
- The Guide panel (robot icon, top right or bottom-right on mobile) should appear
- Open the Guide — there should be a Journey card with onboarding steps
- Work through the journey steps — are they clear? Is progress visible?
- Check the Guide panel layout on both desktop and mobile

### 6. Main lobby / Home
- After login, what is the primary screen?
- Is the main CTA (start a game) obvious?
- Check: navigation, header, any announcements or notifications
- Check dark mode

### 7. Gameplay — PvP
- Start a PvP game (find an opponent or use the AI opponent option)
- Play a full game to completion
- Check: board layout, move highlighting, win/draw/loss states, score display
- Check on mobile — are touch targets adequate? Is the board usable?

### 8. Guide Panel
- Open the Guide panel (robot orb icon)
- Check: notification stack, online users strip, Journey card, quick-action slots
- Toggle edit mode (gear icon) — can you add/remove slots?
- Does the panel animate in/out smoothly?
- On mobile: does it appear as a bottom sheet?

### 9. Settings Page
- Navigate to Settings (profile menu → Settings)
- Check all sections: profile, preferences, notifications (new), guide button toggle
- The **Notifications** section is brand new — evaluate it carefully:
  - Are the grouped toggles (Tournaments / Matches / Achievements / System) clear?
  - Is "Always On" labeling for system-critical events understandable?
  - Is the two-column (In-App / Email) layout readable on mobile?

### 10. Tournament pages
- Navigate to Tournaments
- Check the tournament list, any registration flow, and tournament detail page
- Is it clear how to register? What happens when no tournaments are active?

### 11. Profile page
- Visit your own profile
- Check: stats display, ELO/rating, game history

### 12. Mobile audit (dedicated pass)
Do a dedicated mobile pass at 375px width across:
- Nav / header
- Guide panel (should be bottom sheet)
- Settings page (especially the new Notifications section)
- Any modals or popups

---

## Review Criteria

For each surface, evaluate against **all five dimensions**:

### A. Visual Consistency
- Do colors, spacing, and typography match across pages?
- Are CSS design tokens used consistently (not hardcoded hex values)?
- Are dark and light modes both complete — no missing backgrounds, invisible text, or broken borders?
- Are icons sized consistently? (Icon-only buttons should be ≥1.4rem)
- Does the per-site visual identity hold? (Colosseum/slate-blue for main app; mountain/teal for landing — never mixed)

### B. UX / Flow
- Is it obvious what the user should do next on each screen?
- Are empty states handled? (no tournaments active, no game history, etc.)
- Are loading states visible?
- Are error messages clear and actionable?
- Is the onboarding journey (Guide → Journey card) self-explanatory for a brand new user?
- Does the guest-to-registered transition feel smooth?

### C. Mobile
- Are touch targets ≥44px for interactive elements?
- Does the layout reflow correctly at 375px? No horizontal overflow.
- Is the Guide panel a bottom sheet on mobile?
- Are forms usable with a mobile keyboard (no elements hidden behind the keyboard)?
- Is text legible without pinching?

### D. Accessibility
- Do interactive elements have visible focus styles?
- Are buttons and icon-only controls labeled (`aria-label`)?
- Is color contrast adequate (WCAG AA: 4.5:1 for normal text)?
- Can key flows be navigated by keyboard alone (Tab, Enter, Escape)?
- Are modals focus-trapped (focus stays inside the modal while it's open)?

### E. Code / Component Quality
_(Only if you have access to the React source — skip if reviewing screenshots only)_
- Are props typed and documented where non-obvious?
- Are inline styles used only where CSS variables or Tailwind classes are insufficient?
- Are components appropriately sized — no 400-line monoliths?
- Is state management appropriate — local state vs. store?

---

## Onboarding Focus

Give extra attention to these two onboarding journeys:

### Unregistered user
1. Lands on landing page → what is the first thing they understand about the product?
2. Navigates to main app → what do they see? Is the value prop clear?
3. Guest welcome — is there a modal or prompt? Is it helpful or intrusive?
4. How easy is it to find the sign-up path?
5. Is there anything that would confuse or frustrate a first-time visitor?

### Registered user (first login)
1. After sign-in, where do they land?
2. Is the Guide / Journey visible without hunting for it?
3. Are the journey steps ordered logically — do they teach the app progressively?
4. Is there a clear "graduation" moment when onboarding is done?
5. What's the first game experience like — is matchmaking obvious?

---

## Output Format

Return your findings in this structure:

```
## Summary
One paragraph overall impression.

## Critical Issues (blockers)
- [Surface] [Device] Description — what breaks or confuses

## Polish Issues (should fix)
- [Surface] [Device] Description

## Nice-to-Haves
- [Surface] Description

## Per-Surface Notes
### 1. Landing Page
[findings]
### 2. Landing → App transition
[findings]
... (one section per surface)

## Onboarding Assessment
### Unregistered user journey
[findings]
### Registered user journey
[findings]

## Accessibility Findings
[findings]

## Mobile Findings
[findings]

## Positive Highlights
Things that work well and should be kept as-is.
```

---

## Context for the Reviewer

- This is an **alpha-stage product** — some features are stubbed or behind feature flags.
- The **notification preferences** section in Settings is brand new — pay close attention.
- The **Guide panel** is a core UX surface — it's how users navigate onboarding and quick actions.
- **Admin pages are out of scope** — don't review `/admin` routes.
- **Known limitation:** The help/chat input in the Guide panel is intentionally hidden (not yet implemented).
- If you encounter a feature that seems incomplete or confusing, flag it — don't assume it's intentional.
