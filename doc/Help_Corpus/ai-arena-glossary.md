---
slug: ai-arena-glossary
title: AI Arena glossary — terminology reference
category: basics
tags: [glossary, terminology, reference, definitions]
status: PUBLISHED
admin_only: false
---

# AI Arena glossary

Reinforcement learning has a lot of jargon, and AI Arena has its own platform-specific terms on top. This is the one-stop reference. Terms are alphabetical; cross-references are bold.

## A

**Action** — A move the bot can make from the current state. In tic-tac-toe, an action is "place my mark on cell N". The set of valid actions changes with the board state (you can only play in empty cells).

**Activity tier** — A public rating reflecting your platform participation: Bronze → Silver → Gold → Platinum → Diamond. Calculated from your **TC**, **HPC**, and **BPC** balances. Gates how many **bots** you can own and how big a **training session** you can run. See "Activity tiers and ranking".

**Algorithm** — The learning method a **skill** uses: Q-Learning, SARSA, Monte Carlo, Policy Gradient, DQN, or AlphaZero. You pick the algorithm when you create a skill.

**AlphaZero** — A neural-network **algorithm** that combines **MCTS** (Monte Carlo Tree Search) with a policy network and a value network. The strongest learning method on AI Arena; also the slowest per **episode**.

**Auto-Tuner** — A Gym tab that automatically **sweeps** hyperparameters (α, γ, ε decay) and finds the best configuration for a tabular **algorithm**. Useful when a bot plateaus.

## B

**Batch** — In DQN, the number of past experiences sampled from the **replay buffer** per gradient update. Default 32.

**Benchmark** — A standardized **evaluation** of a trained bot against the five **minimax** tiers (Random / Easy / Medium / Tough / Hard). Produces a **win rate** per tier and an estimated **ELO**.

**BotSkill** — The platform's database name for a **skill**. A `BotSkill` row records the bot, the game, the algorithm, and the trained weights.

**BPC** (Bot Play Credits) — One of three platform credits. Earned +1 to a bot owner when their **bot** plays against an external opponent. See "Credits".

**Bracket** — The structure of a tournament: who plays whom in each round. AI Arena supports SINGLE_ELIM and ROUND_ROBIN brackets.

**Brain** — Older term for **skill**; replaced when multi-game multi-skill bots shipped. If you see "Brain" anywhere, mentally substitute "skill".

## C

**Checkpoint** — A mid-training snapshot of a skill's weights, saved at regular intervals. Stored in the Gym's Checkpoints tab so you can roll back a session that went sideways.

**Convergence** — When a skill's training updates stop producing meaningful improvement. The Q-values (or network weights) have settled; running more **episodes** of the same **algorithm** won't help.

**Cup** — A special tournament tied to the Intelligent Guide journey: Curriculum Cup (4 entrants) at step 6, Rookie Cup (8 entrants) post-graduation. Cups are private, excluded from public rankings, and GC'd after 30 days.

**Curriculum** — A vs-Minimax training mode where the opponent's tier auto-advances (novice → master) once your bot wins 65% of the last 100 games. The smart way to train against deterministic opponents.

**Curriculum phase** — The middle phase of the Intelligent Guide journey: steps 3-6. Covers bot creation, training, spar, tournament registration.

## D

**Decay** — The schedule by which **epsilon** falls from its starting value to its floor over training. Three options: Exponential, Linear, Cosine.

**Demo Table** — A bot-vs-bot match created automatically for Hook step 2. Private to you, GC'd after a few minutes.

**Discount factor** — See **gamma**.

**DQN** (Deep Q-Network) — A neural-network **algorithm** that approximates Q-values with a small MLP. Uses a **replay buffer** and a **target network** for stability.

## E

**ELO** — A numeric rating reflecting your bot's competitive strength. Each game updates ELO; wins against stronger bots are worth more. Public.

**Episode** — One complete game played during training. The bot makes moves until the game ends, then the **algorithm** updates its values based on the outcome.

**Epsilon (ε)** — The probability the bot picks a random move instead of its current best move during training. High ε early = explore; low ε late = exploit. See "Bot training concepts".

**Epoch** — Sometimes used loosely for **episode**; AI Arena prefers "episode" for clarity. In some ML contexts an epoch is a full pass through a dataset — but RL doesn't have a fixed dataset, so the term is awkward.

**Evaluation** — The Gym tab that runs **benchmarks** and **head-to-head** matches. Produces an objective score for a trained skill.

**Exploitation** — Taking the bot's currently-best-known action. Opposite of **exploration**. Controlled by **epsilon**.

**Explainability** — A Gym tab that visualizes what the bot has learned: per-position value estimates, move probabilities, attention. Use it to debug.

**Exploration** — Trying random or non-optimal actions to discover new information. Opposite of **exploitation**.

## F

**Fork** — A move that creates two simultaneous winning threats. The opponent can only block one — the other wins next move. The key offensive tactic in tic-tac-toe.

## G

**Gamma (γ)** — The **discount factor**. Controls how much the bot values future rewards versus immediate ones. γ=0.9 standard for tic-tac-toe (short games); γ=0.99 for AlphaZero. See "Bot training concepts".

**Greedy** — Always picking the action with the highest estimated value. Same as **exploitation**. At ε=0, the policy is fully greedy.

**Gym** — The bot training studio. Eight tabs: Train, Analytics, Evaluation, Explainability, Checkpoints, Sessions, Export, Rules. See "Gym and ML training".

## H

**Head-to-head (H2H)** — Two bots play each other directly to measure relative strength. Better signal than benchmarks for comparing candidate models.

**Hook phase** — The first phase of the Intelligent Guide journey: steps 1-2. Covers playing a game and watching a demo.

**HPC** (Human Play Credits) — One of three platform credits. Earned +1 per human game played. See "Credits".

**Hyperparameter** — A setting you pick before training (learning rate α, decay schedule, network architecture). Different from a model's **weights**, which the bot learns. The **Auto-Tuner** automatically sweeps hyperparameters.

## I

**Inference** — Using a trained bot to play games (with ε=0, no learning). Opposite of **training**.

## J

**Job** — See **TrainingJob**.

## L

**Learning rate (α)** — How aggressively the bot updates its values each step. 0.3 for tabular, 0.001 for neural. Hardcoded in the Train tab; sweepable in **Auto-Tuner** for tabular.

## M

**Magnus** — The strongest built-in bot. Plays perfect minimax. Cannot be beaten; only drawn.

**MCTS** (Monte Carlo Tree Search) — A search algorithm that builds a tree of possible future positions, weighted by simulated outcomes. Core component of **AlphaZero**.

**Minimax** — A deterministic game-playing algorithm that searches the game tree assuming both players play optimally. The basis for all built-in bots (Rusty/Copper/Sterling/Magnus). Also the algorithm used by **Quick Bots**.

**MLP** (Multi-Layer Perceptron) — A simple type of neural network with one or more fully-connected hidden layers. **DQN** uses an MLP.

**Monte Carlo** — A tabular **algorithm** that learns from complete episode outcomes (rather than step-by-step). Slow but unbiased.

## N

**Neural network** — A function approximator built from layers of weighted connections. AI Arena's **DQN** and **AlphaZero** use small neural networks (MLPs).

## O

**Off-policy** — Updates the value estimate using the *greedy* next action regardless of what's actually played. **Q-Learning** is off-policy. Tends to converge faster than on-policy.

**On-policy** — Updates the value estimate using the action *actually taken*. **SARSA** is on-policy. Tends to learn a more conservative policy.

## P

**Policy** — The bot's strategy: a mapping from state to action (or distribution over actions). Some algorithms learn a policy explicitly (**Policy Gradient**, **AlphaZero**); others derive it from a value function (**Q-Learning**).

**Policy Gradient** — A tabular **algorithm** that learns action preferences (a softmax distribution) instead of action values. Produces unpredictable play.

**PUCT** — The exploration constant in **MCTS** that decides which tree branch to expand next. AlphaZero default 1.5.

**Pruned** — A training-job status: the run completed but the weights have been deleted because it exceeded the **version history** retention limit (default 5 per skill). Pruning is irreversible.

## Q

**Q-Learning** — A tabular **algorithm** that learns Q-values (state-action values) via temporal-difference updates. The recommended starting algorithm on AI Arena.

**Q-value** — An estimate of "how good is taking action A from state S". A Q-table maps every (state, action) pair to a Q-value.

**Quick Bot** — A minimax-based bot you create in one click with a chosen tier (Novice / Intermediate / Advanced / Master). No actual learning happens — it's a tier-bump.

## R

**Random opponent** — A built-in benchmark opponent that picks any valid move uniformly. A trained skill should beat Random 85%+.

**Replay** — A move-by-move recording of a completed game. Viewable from `/replay/:id`. Default retention 90 days.

**Replay buffer** — A circular memory in **DQN** that stores past experiences for random mini-batch sampling. Breaks temporal correlation and stabilizes training. Default size 10,000 experiences.

**Reward** — The numeric signal the bot learns from. In AI Arena's tic-tac-toe: +1 for a win, -1 for a loss, 0 for a draw. Propagated backward through the game's moves via **gamma**.

**Rookie Cup** — An 8-entrant **cup** that follows the Curriculum Cup. Includes Sterling seeded to the opposite bracket arm. The first real test of a trained skill.

**Rusty / Copper / Sterling / Magnus** — The four built-in bot personas, mapping to minimax tiers Novice / Intermediate / Advanced / Master.

## S

**SARSA** — A tabular **algorithm** named for State-Action-Reward-State-Action. On-policy variant of Q-Learning. Conservative play.

**Self-play** — A training mode where the bot plays both sides simultaneously. Best for tabular methods; the only mode for **AlphaZero**.

**Session** — A bounded run of training **episodes** for a single skill. The full recipe for an algorithm is typically 3-4 sessions of 3,000-10,000 episodes each.

**Skill** — The bot's AI model for a specific game: an **algorithm** + trained weights. A bot can carry multiple skills (one per game).

**Spar** — A casual training match between your bot and a built-in opponent (Rusty/Copper/Sterling). Part of Curriculum step 5. Retained 30 days.

**Specialize phase** — The third and final Intelligent Guide phase: post-step-7. The platform's full feature surface opens up; the Guide steps back.

**State** — The current configuration of the game. For tic-tac-toe, the 9-cell board with X's, O's, and empties. Bots learn values per state.

**SystemConfig** — The admin-tunable knobs that control platform behavior (journey rewards, reward amounts, cup retention, etc.). Edited at `/admin`.

## T

**Tabular** — An **algorithm** that uses an explicit table mapping states to values, rather than a neural network. Q-Learning, SARSA, Monte Carlo, Policy Gradient are tabular. Browser-trained; XO-only.

**Target network** — A second copy of the **DQN** Q-network whose weights are synced periodically. Provides stable bootstrapped target values during training.

**TC** (Tournament Credits) — One of three platform credits. Earned from journey milestones and tournament wins. Weighted 5× in the activity-tier score.

**Temperature** — In **AlphaZero**, controls how the move is sampled from MCTS visit counts. 1.0 = proportional sampling, 0.1 = near-deterministic. Lower temperature late in training.

**TrainingJob** — The platform record for a server-side neural training run. States: QUEUED → RUNNING → COMPLETED (or FAILED, CANCELLED, PRUNED). Visible in the Sessions tab.

**Tournament classification** — A separate ladder from activity tier, reflecting competitive results: Rookie → Amateur → Intermediate → Advanced → Expert.

## V

**Value function** — An estimate of "how good is this state". The value of state S, denoted V(S), is the expected total reward from S onward. **AlphaZero**'s value network learns V directly.

**Version** — A completed training run is stored as a version of the corresponding **skill**. The Sessions tab shows version history. Max 5 versions retained per skill by default; older are **pruned**.

**vs Minimax** — A training mode where the bot plays a deterministic minimax opponent at a chosen tier. Use after self-play has bootstrapped the Q-table.

## W

**Weights** — The numeric parameters a **neural network** learns. **Tabular** methods don't have weights in the same sense — they have Q-values in a table.

**Win rate** — The fraction of games won. Often reported per-opponent in benchmarks: vs Random, vs Easy, vs Medium, vs Tough, vs Hard.

---

If a term you're looking for isn't here, ask the Guide directly ("what does X mean?") — that's what the help chat is for. If you think a term should be in this glossary, send a Feedback note.
