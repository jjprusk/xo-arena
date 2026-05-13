---
slug: intelligent-guide
title: The Intelligent Guide
category: basics
tags: [onboarding, guide, journey, hook, curriculum, specialize]
status: PUBLISHED
admin_only: false
---

# The Intelligent Guide

The Intelligent Guide is AI Arena's onboarding companion. It walks you through a structured 7-step journey from your first game to your first tournament, then steps back and lets you specialize on your own.

## Where the Guide lives

The Guide has two surfaces that work together:

- **Guide orb** — a 44×44 circular button with an animated progress ring, top-right of the header. The ring fills as you complete journey steps. It pulses amber when you have an urgent next step and blue when idle. A red badge counts unread urgent items (e.g., "3 cards waiting" in Specialize).
- **Guide panel** — appears at right. During **Hook and Curriculum**, the panel is **always visible** as the primary onboarding surface (it's not really "a drawer you open" during the journey — it's the home base). In **Specialize**, the panel transforms into a tabbed interface with **What's Next** (recommendation cards) and **Shortcuts** (a SlotGrid of common actions). The SlotGrid is **hidden during Hook and Curriculum** — it unlocks when you complete step 7.

The panel contains an **"Ask Guide anything…"** input — this is the Learnable Help chat.

## The three phases

| Phase | What it does | Steps |
|---|---|---|
| **Hook** | First contact: prove the platform is fun in 3 minutes. | 1–2 |
| **Curriculum** | Build the muscle: create a bot, train it, spar, enter a tournament. | 3–6 |
| **Specialize** | Step back. The platform opens up; the Guide goes quiet. | Step 7 done |

Phase derivation is **purely server-side** (`deriveCurrentPhase()` in `journeyService.js`). The client never decides phase; it just renders whatever the server reports.

## The seven steps

| # | Phase | Step | Trigger |
|---|---|---|---|
| 1 | Hook | Play your first game | Complete one PvAI game (any outcome) |
| 2 | Hook | Watch bots battle | Watch a demo Table for **≥2 minutes OR to completion**, whichever comes first |
| 3 | Curriculum | Create your bot | Bot creation wizard completes |
| 4 | Curriculum | Train your bot | Quick Bot tier bump or ML training run completes |
| 5 | Curriculum | Spar your bot | Spar match completes (any outcome) |
| 6 | Curriculum | Register for a tournament | Tournament registration with your bot |
| 7 | Curriculum → Specialize | Complete your first tournament | Tournament reaches a final position for you |

Step triggers are **server-detected**. The client never posts "I completed step 3" — instead, the action itself (training finishing, tournament closing) fires the journey-step credit.

## Rewards

Completing Hook (step 2) pays **+20 TC**. Completing Curriculum (step 7) pays **+50 TC**. Both amounts are admin-tunable in SystemConfig (`guide.rewards.hookComplete` and `guide.rewards.curriculumComplete`).

A **Reward Popup** appears whenever any reward fires:

- Phase completions: `guide:hook_complete` → +20 TC, `guide:curriculum_complete` → +50 TC.
- **Discovery rewards** (one-shot, idempotent): first real tournament win (+25 TC), first Specialize action (+10 TC), first non-default algorithm (+10 TC), first template clone (+10 TC). Each fires its own popup with the reason and amount.

The popup auto-dismisses after a few seconds or on click. Your TC balance updates immediately.

## Guest mode

You can play through the Hook phase **without an account**. Guest progress is stored in `localStorage` under `guideGuestJourney`. When you sign up, the platform calls `POST /api/v1/guide/guest-credit` (idempotent) and credits any Hook steps you completed as a guest — so the +20 TC reward survives the signup transition.

## Specialize phase

Once step 7 is done you enter Specialize. The Guide panel transforms:

- **What's Next** tab — recommendation cards (Competitor, Trainer, Explorer buckets) suggest next moves tailored to your archetype. Dismissing a card **suppresses it for 7 days**; a replacement appears in the same view. Dismissal is forgiveness, not punishment — the card returns after the grace.
- **Shortcuts** tab — the SlotGrid of quick actions (start training, find a tournament, etc.) unlocks now. Hidden during the journey.

The platform's full feature surface (recurring tournaments, multi-skill bots, advanced algorithms, leaderboards) opens up. The Guide doesn't push you anymore, just suggests.

**Inactivity nudge** — if you go 14 days without taking a Specialize action, a `guide:notification` event fires and the orb pulses for 30 seconds; if ignored for another 2 minutes, a non-modal slide-in panel appears from the bottom. This is the only automatic attention-grab in v1 — no emails, no forced modals.

## Restarting or skipping

You can restart the journey from Settings → Guide (clears completed-step state). Skipping individual steps isn't possible by design — the journey is short and each step builds a real skill or unlocks a real reward.

## Why a journey?

AI Arena's wider goal is to teach machine-learning concepts through play. The journey is the smallest path that takes you from "huh, a board game?" to "I have my own bot in a tournament" — which is the moment most people understand what the platform is *for*. Without that path, the surface is too wide; with it, every user reaches the same "aha" within a single session.
