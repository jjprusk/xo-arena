---
slug: faq
title: FAQ — common questions
category: basics
tags: [faq, troubleshooting, common-issues]
status: PUBLISHED
admin_only: false
---

# FAQ — common questions

This page answers the questions new players ask most. If your specific question isn't here, click "Ask Guide anything…" in the Guide drawer or use the 💬 feedback button.

## Getting started

**How do I get started?** Sign up (top-right), click Quick Play on the home page, and follow the Guide drawer's 7-step onboarding journey. The full first-time walkthrough lives in the "Getting started" doc — that's the single best place to start.

**Where do I begin / I'm new, what should I do first?** Same answer — sign up, then Quick Play, then the Guide. About 30 minutes for the full onboarding.

**Do I have to register to use AI Arena?** No — you can browse the Bot Directory, browse Tournaments, watch the bot-vs-bot demo, and spectate public Tables as a guest. You need an account (free, ~15 seconds to create) to play a game yourself, train a bot, or enter a tournament.

## Account and sign-in

**Do I need to verify my email?** Most of the platform works without verification. Tournament entry requires a verified email; the soft "verify email" banner reminds you. Verification email is sent on signup; you can resend from the banner.

**Can I sign in with Google?** Yes. Pick "Continue with Google" on the sign-in screen.

**I forgot my password.** Use the "Forgot password" link on the sign-in screen. (Better Auth handles the reset flow.)

**Can I change my username?** No — usernames are immutable. You can change your **display name** any time from Profile.

**How do I delete my account?** Profile → Danger Zone → Delete my account. The action removes your user record, owned bots, and tournament history. It's irreversible.

## Bots

**Can I have more than one bot?** Yes, up to your tier limit (Bronze 3, Silver 5, Gold 8, Platinum 15, Diamond unlimited).

**Why won't my bot name save?** Three rules can block it: reserved names (Rusty, Copper, Sterling, Magnus are platform-only); platform profanity filter; uniqueness among bots *you own*. The form will show the specific reason inline.

**My Quick Bot keeps drawing against Magnus / Sterling.** That's expected — Quick Bots use the same minimax engine as the built-in tiers. To actually beat a Master tier you need an ML-trained bot (see "Gym and ML training").

**My bot has no ELO yet.** New bots are **provisional** until they've played several games. Their rating shows but is marked unstable until calibrated.

**I trained a new skill — why is my old skill still listed?** Bots can carry multiple skills (one per game). The new skill becomes your bot's **primary**, but the old one is preserved. Manage them from the bot's profile.

## Tournaments

**Why can't I register?** A few possibilities: registration window is closed; your email isn't verified; the tournament is at capacity.

**My recurring tournament didn't auto-enroll me.** Check Profile → Recurring Tournaments. If you've opted out (`optedOutAt` is set), re-subscribe from the template's page.

**I missed a tournament I was registered for.** Missed counts are tracked but don't penalize you in v1. You can opt out of the template if you don't want it to keep enrolling you.

**Why am I in a "Cup" instead of a real tournament?** Cups (Curriculum Cup, Rookie Cup) are private and Guide-spawned. They don't affect your real ELO or classification. See the "Cups" doc.

## Tables and live play

**The other player isn't moving.** They may be deciding, or they may have disconnected. If they're idle past the warn threshold, the platform may auto-forfeit them.

**Why was my Table abandoned?** Either both seats emptied, or no second player joined within the no-show window. `tableGcService` periodically cleans up stale Tables.

**Can I undo a move?** No. Every move is final once placed.

**Can spectators chat?** Not in v1. Spectators see the board and can leave.

## Credits

**I played but didn't get HPC.** HPC is awarded only when a human plays in the match. Watching a bot-vs-bot demo doesn't pay HPC.

**I trained a bot but didn't get BPC.** BPC is for *bot play* — your bot must actually play against an external opponent. Training itself doesn't pay BPC; the resulting games do.

**Are credits real money?** No. Credits are platform-internal recognition for activity; you cannot buy or cash them out. They unlock tiers and (in future) may gate certain premium surfaces.

**I'm at 0 TC and I can't enter a tournament.** Tournament entry doesn't cost credits in v1. If you can't register, it's something else — check your email verification or the registration window.

## The Guide

**The Guide keeps suggesting I do things. How do I dismiss it?** Click the orb to close the drawer. The orb itself stays visible (it shows your progress); the drawer with prompts only opens when you click the orb.

**I want to restart the journey.** Settings → Guide → Restart journey. This clears your completed-step state. The journey reward only pays the first time, though.

**The reward popup disappeared too fast.** It auto-dismisses after a few seconds. Your TC balance updated; check Profile if you want to verify.

## Notifications

**I'm getting too many emails.** Settings → Event Notification Preferences. Turn off the email column for events you don't care about.

**Push notifications don't work in Safari.** Safari requires AI Arena to be installed as a PWA (Add to Home Screen on iOS / Add to Dock on macOS). Once installed, push works the same as other browsers.

## Performance / quality

**Why is the page slow on first load?** AI Arena lazy-loads the game packages and Gym. The first time you open `/play` or `/gym`, the chunk downloads. Subsequent navigations are instant.

**Replays disappeared.** Casual game replays are retained 90 days by default; tournament replays the same. The final result is kept forever, just not the move-by-move stream.
