---
slug: tournament-strategy
title: Tournament strategy — beyond just bot prep
category: tournaments
tags: [tournament, strategy, timing, scouting, etiquette, competition]
status: PUBLISHED
admin_only: false
---

# Tournament strategy — beyond just bot prep

You've trained a competitive bot. Now what's the *strategic* play around tournaments? When to enter, which tournaments to pick, how to think about a series of tournaments, and how to compete well as a member of the community. This doc covers the layer above bot training.

For preparing your bot specifically, see "How to find and enter a tournament" and "Gym workflows" Workflow 6.

## Choosing which tournaments to enter

Not every tournament is worth your bot's slot. Three factors:

### Field strength

The other entrants. Tournament cards show the current capacity ("4/8 filled") but not the bots themselves until you click in. Before registering, click the card and review:

- **The seeded bot list** (for templates with seeded participants). Are they strong? Are they bots you've already faced and beaten?
- **The classification requirement.** A "Rookie+" tournament typically has weaker entrants than an "Amateur+" tournament. Pick tournaments where you're in the top third of the bracket by classification.
- **The current entrants** if you can see them. The Bot Directory will show you their recent games and benchmarks.

**Rule of thumb:** enter tournaments where you're equal-to-stronger than the median entrant. Entering as the underdog can be educational but rarely produces wins.

### Format and bracket

- **OPEN tournaments** fill quickly, run when capacity hits. Good if you want fast results.
- **PLANNED tournaments** have specific start times. Good if you can plan around them.
- **FLASH tournaments** are short-notice. Good for testing your bot quickly; you typically have less time to prep.
- **SINGLE_ELIM** is high-variance — one bad match knocks you out.
- **ROUND_ROBIN** rewards consistency — everyone plays everyone; final standings by total wins.

If you have a strong bot and want a clear win, SINGLE_ELIM. If you want statistically reliable results, ROUND_ROBIN.

### Time investment

Tournaments don't require your direct presence (the bot plays autonomously), but you'll want to be available for spectating and post-game analysis. A 16-entrant single-elim bracket can take 1-2 hours total wall-clock. A 4-entrant cup runs in 15-30 minutes.

For your first tournaments, pick small fields (4-8 entrants) and short formats.

## Timing your entries

When you register affects your prep:

### Last-minute (under 2 hours before start)

You're committing your current trained version. No time for a final session. Good when:

- Your bot is already at your benchmark target.
- The tournament's prize is small and you're not trying to win.
- You want low pressure ("nothing to lose").

### Mid-window (2-24 hours before start)

You have time for a final session. Good when:

- You want to do one final vs-Master pass for tightening.
- You want to set Epsilon min = 0.01 for the last 2,000 episodes.

### Early (1+ days before start)

You can do a full prep cycle: training, benchmark, training, benchmark. Good when:

- This is a high-prize tournament.
- You're trying for a specific classification jump.
- You want to test changes before committing.

**Trade-off:** registering early locks you in. If a better tournament announces in the same window, you can't switch easily (you can't withdraw mid-tournament). Mid-window or late entry preserves optionality.

## Scouting opponents

If the entrants list is visible before the tournament starts:

1. **Click each entrant bot** in the Bot Directory.
2. Check their **recent games** — what algorithm do they play? What's their style?
3. Check their **benchmark history** — what's their estimated ELO?
4. Check their **tournament history** — do they win often? Lose early?

If you see a clearly stronger bot in the field, mentally position them as the "Sterling" — assume they'll reach the semifinals or finals. Plan your path around avoiding them in early rounds (impossible to actually engineer with random seeding, but useful for expectations).

For Cups (Curriculum, Rookie), the seeded bots are known and deterministic — see the Cups doc for the exact compositions.

## Bot preparation strategies

### Algorithm choice for tournament style

The bot-personalities-and-styles doc has the full mapping. Quick summary:

- **One-off tournaments**: Q-Learning is fine. Your bot only sees this opponent set once.
- **Recurring tournaments where opponents repeat**: Policy Gradient. Its stochastic play prevents opponents from learning a counter to you.
- **High-stakes tournaments**: AlphaZero, well-trained. Top ceiling at any opponent level.
- **Defensive play**: SARSA. If you'd rather draw than gamble.

### Final-hardening session

A few hours before any competitive tournament, run:

- **Mode**: vs Minimax, **Master** tier (no curriculum).
- **Episodes**: 2,000-3,000.
- **Epsilon min**: 0.01 (down from default 0.05).
- **Reset ε to 1.0**: ☐ unchecked.

This sharpens the greedy policy against the strongest opponent class. Expect +5 to +15 benchmark ELO.

### What NOT to do right before a tournament

- **Don't change the algorithm.** Switching from Q-Learning to AlphaZero hours before a tournament means an untrained AlphaZero bot enters.
- **Don't experiment with hyperparameters** unless you have time to recover.
- **Don't promote an unbenchmarked version.** Always benchmark before swapping.
- **Don't run a session with Reset ε to 1.0 checked** on an already-trained bot. You'll undo recent learning.

The day before a tournament is for **incremental hardening**, not exploration.

## Multi-tournament campaigns

If you're playing many tournaments over weeks or months, think strategically across them:

### The build-up

Don't enter every tournament available. Use lower-stakes ones to **test changes** in your bot, then enter higher-stakes ones with confirmed-strong versions.

Example campaign:

- **Week 1**: enter a Daily XO recurring tournament with v1 of your bot. See where it places.
- **Week 1 followup**: train v2 with different hyperparameters. Test in another Daily.
- **Week 2**: enter the Weekly Champions tournament with whichever version performed better.
- **Week 2 followup**: train v3 (different algorithm) for diversity. Test in Daily.
- **Week 4**: enter the Monthly Master with your strongest validated version.

### Don't over-iterate

A common mistake: train a v3, lose a tournament with it, train v4, lose, train v5... etc. Each new version costs time. If v3 was solid (benchmark in range, won some games), keep playing it for several tournaments before iterating.

The signal-to-noise ratio in tournament results is low — one bad bracket doesn't mean your bot is bad. Wait for clear evidence (3+ losses against weaker fields) before retraining.

### Classification climb

Tournament classification (Rookie → Amateur → Intermediate → Advanced → Expert) updates based on results. To climb:

- Win tournaments at your current tier.
- Place in the top half consistently.
- Avoid losing to bots clearly weaker than yours.

A natural climb path: subscribe to one daily template, one weekly. Consistent participation moves your classification up one tier every 2-3 months at typical activity levels.

## Etiquette and sportsmanship

AI Arena is a competitive platform but a small community. A few things to keep in mind:

### Don't no-show on purpose

If you've registered and are no longer interested in playing, the proper action is to take the loss — your bot plays the match, may lose, and the bracket continues. No-shows trigger forfeits and may affect your record over time. Auto-forfeit windows are typically 5 minutes.

For recurring tournaments, **unsubscribe** if you don't want to keep participating. It's the clean way to stop.

### Don't exploit timing edge cases

If you discover a way to game the tournament system (e.g., always entering the lowest-skill bot in a high-tier tournament to easy-win the rookie bracket), the community will notice. Admins may also adjust template requirements to prevent it.

The platform is more fun when everyone is trying to compete genuinely.

### Spectate respectfully

There's no spectator chat in v1, but spectator behavior includes:

- Joining mid-match: fine.
- Leaving mid-match: fine; doesn't affect anything.
- Watching multiple matches simultaneously: encouraged (the Tables list shows live tournament matches).

### Bot naming

Reserved names (Rusty, Copper, Sterling, Magnus) and platform profanity are blocked. Beyond that, the platform doesn't gate names heavily. But: a bot name with offensive content can be reported via the Feedback button; admins may rename or sanction.

Use a name that won't embarrass you in a tournament bracket. "Bob the Magnificent" is fine. "[Slur]Master" gets you flagged.

## Reading the bracket UI

When a tournament is in progress, the bracket page shows:

- **Your slot** highlighted (badge or color).
- **Current match** with both bots and the live game.
- **Completed matches** with winners advanced.
- **Pending matches** with TBD entries.

Some symbols/indicators you'll see:

| Symbol/state | Meaning |
|---|---|
| **Filled bracket slot** | Bot is committed; match has a participant. |
| **TBD slot** | Awaiting winner of a prior match. |
| **Live indicator (red dot)** | Match is in progress; click to spectate. |
| **Bot avatar with checkmark** | Bot won its match. |
| **Bot avatar greyed out** | Bot lost; eliminated. |
| **Crown/trophy icon** | Final champion (post-completion). |

The bracket also typically shows the **projected path** — if you win the next two rounds, who you'd face. Useful for scouting.

## When you lose

Losing a tournament is fine. Most users lose more tournaments than they win. The strategic question is what to do *after*:

### Within minutes

Watch the replay of your losing match (or matches). Don't analyze too deeply yet; just look at where the game turned.

### Within hours

Open the replay's defining position in the **Explainability tab** of your bot's skill. What were the Q-values? Did the bot pick a sub-optimal move with confidence? Was the bot's preferred move actually a losing one?

### Within days

If a pattern emerges (your bot keeps losing the same type of game), plan a training session that addresses it. Examples:

- Always losing as O? Run alternating-mode self-play.
- Always losing in fork-heavy positions? Add more vs-Master training.
- Always drawing when you should win? Lower Epsilon min for sharper greedy play.

If no pattern emerges, the losses are noise. Keep playing; statistics will smooth out.

### Within weeks

If your overall win rate at your tournament tier is below 30-40%, you're punching above your weight. Consider:

- Reducing tournament tier (subscribe to easier templates).
- Retraining with a stronger algorithm.
- Taking a break from tournaments and focusing on training.

The platform rewards consistent improvement, not constant participation.

## When you win

Two questions:

### Should you stay at this tier?

If you've won several tournaments at your current classification tier, the platform will likely promote you. You can also seek harder tournaments voluntarily — they have higher prize pools and more competitive opponents.

### Should you change your bot?

Tournament wins are signal that your current bot is at least competitive at this tier. Don't reflexively retrain after a win. Coast on the working version for several more tournaments — your win rate will tell you when it's time to iterate.

A common pattern: train, win, win, win, lose, plateau, retrain. The plateau is the right time to invest.

## Bottom line

Tournament strategy is the meta-game over the meta-game of bot training. Your bot is your tool; tournaments are where you deploy it. Strategic players think about:

- **Tournament selection** — pick where you have an edge.
- **Timing** — register at the right phase of your prep.
- **Multi-tournament arcs** — use lower-stakes to validate; bring your best to higher-stakes.
- **Iteration discipline** — don't retrain after every loss; wait for signal.
- **Etiquette** — the platform is a community; play accordingly.

Combine this with strong bot training and you'll move up the classification ladder steadily. Without it, you'll be technically good but inconsistent.

The full game is at the meta level. Your bot does the moves; you do the strategy.
