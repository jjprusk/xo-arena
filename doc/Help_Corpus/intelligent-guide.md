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

- **Guide orb** — a 44x44 circular button with an animated progress ring, top-right of the header. It pulses amber when you have an urgent next step and blue when you're idle. The ring fills as you complete journey steps.
- **Guide drawer** — opens when you click the orb. A right-side slide-in panel (320px on desktop, full-width on mobile) showing your current step, a checklist of past steps, and a notification feed. Close it with Escape, by clicking the backdrop, or by clicking the orb again.

The drawer contains an **"Ask Guide anything…"** input — this is the Learnable Help chat (Sprint 2 onward).

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
| 2 | Hook | Watch bots battle | Watch a demo Table for the watch threshold (~2 min) |
| 3 | Curriculum | Create your bot | Bot creation wizard completes |
| 4 | Curriculum | Train your bot | Quick Bot tier bump or ML training run completes |
| 5 | Curriculum | Spar your bot | Spar match completes (any outcome) |
| 6 | Curriculum | Register for a tournament | Tournament registration with your bot |
| 7 | Curriculum → Specialize | Complete your first tournament | Tournament reaches a final position for you |

Step triggers are **server-detected**. The client never posts "I completed step 3" — instead, the action itself (training finishing, tournament closing) fires the journey-step credit.

## Rewards

Completing Hook (step 2) pays **+20 TC**. Completing Curriculum (step 7) pays **+50 TC**. Both amounts are admin-tunable in SystemConfig (`guide.rewards.hookComplete` and `guide.rewards.curriculumComplete`).

A **Reward Popup** appears when a phase completes — a celebration toast naming the reward. The popup auto-dismisses after a few seconds or on click.

## Guest mode

You can play through the Hook phase **without an account**. Guest progress is stored in `localStorage` under `guideGuestJourney`. When you sign up, the platform calls `POST /api/v1/guide/guest-credit` (idempotent) and credits any Hook steps you completed as a guest — so the +20 TC reward survives the signup transition.

## Specialize phase

Once step 7 is done you enter Specialize. The Guide drawer shows a celebration state and the next-step prompts stop. The platform's full feature surface (recurring tournaments, multi-skill bots, advanced training algorithms, leaderboards) opens up. The Guide is still available if you want to ask questions, but it no longer pushes you.

This is intentional: the Guide is training wheels, not a permanent overlay.

## Restarting or skipping

You can restart the journey from Settings → Guide (clears completed-step state). Skipping individual steps isn't possible by design — the journey is short and each step builds a real skill or unlocks a real reward.

## Why a journey?

AI Arena's wider goal is to teach machine-learning concepts through play. The journey is the smallest path that takes you from "huh, a board game?" to "I have my own bot in a tournament" — which is the moment most people understand what the platform is *for*. Without that path, the surface is too wide; with it, every user reaches the same "aha" within a single session.
