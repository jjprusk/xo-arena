# Browser Support Plan — E2E Coverage Expansion

## Goal

Catch cross-browser regressions (layout, CSS, input, media, gestures) on Chrome,
Edge, Firefox, Safari, iOS Safari, and Android Chrome without blowing up suite
runtime.

## Recommendation — two tiers

### Tier 1 — full suite on `chromium` only (no change)

All specs in `e2e/tests/**` continue to run under one project (`chromium`).
These tests exercise product flows end-to-end and are already serialized via
`workers: 1` due to shared backend state (community bot, socket.io
namespace). Adding browsers here multiplies runtime by N with low marginal
signal — most failures would be the same functional bugs repeated.

### Tier 2 — smoke suite fans out across 5 projects

`e2e/tests/smoke.spec.js` already runs on every deploy against staging/prod
(see `/stage` workflow). It's short (~30 s) and exercises only the critical
surfaces — the right place to pay for cross-browser coverage.

Add these projects to `e2e/playwright.config.js`, gated to smoke only:

| Project | Device preset | Engine | Covers |
|---|---|---|---|
| `chromium` | `Desktop Chrome` | Blink | Desktop Chrome |
| `edge` | `Desktop Edge` + `channel: 'msedge'` | Blink (real Edge) | Desktop Edge |
| `firefox` | `Desktop Firefox` | Gecko | Desktop Firefox |
| `webkit` | `Desktop Safari` | WebKit | Desktop Safari (engine-accurate) |
| `mobile-chrome` | `Pixel 7` | Blink + touch + mobile viewport | Android Chrome (emulated) |
| `mobile-safari` | `iPhone 14` | WebKit + touch + mobile viewport | iOS Safari (engine-accurate) |

Expected smoke runtime: ~2–3 min wall-clock (6× projects, parallelizable
since smoke has no shared-state contention). Runs on every `/stage` — if any
project fails, promotion stops.

## Config shape

```js
// e2e/playwright.config.js
projects: [
  // Full suite — chromium only
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
    testIgnore: ['**/stress.spec.js', '**/smoke.spec.js'],
  },
  { name: 'stress', use: { ...devices['Desktop Chrome'] }, testMatch: ['**/stress.spec.js'] },

  // Smoke — fans out
  { name: 'smoke-chromium',     testMatch: ['**/smoke.spec.js'], use: { ...devices['Desktop Chrome'] } },
  { name: 'smoke-edge',         testMatch: ['**/smoke.spec.js'], use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  { name: 'smoke-firefox',      testMatch: ['**/smoke.spec.js'], use: { ...devices['Desktop Firefox'] } },
  { name: 'smoke-webkit',       testMatch: ['**/smoke.spec.js'], use: { ...devices['Desktop Safari'] } },
  { name: 'smoke-mobile-chrome',testMatch: ['**/smoke.spec.js'], use: { ...devices['Pixel 7'] } },
  { name: 'smoke-mobile-safari',testMatch: ['**/smoke.spec.js'], use: { ...devices['iPhone 14'] } },
],
```

`/stage` runs `npx playwright test smoke` — drop `--project=chromium` so all
six smoke projects execute. For local debugging, target one via
`--project=smoke-webkit`.

## One-time setup

```bash
npx playwright install --with-deps chromium firefox webkit msedge
```

Add to the e2e container's Dockerfile and CI setup. WebKit and Firefox
binaries are ~250 MB combined; Edge reuses the system install on macOS.

## Tradeoffs / limits

- **WebKit ≠ real iOS Safari.** Playwright's WebKit is the upstream engine
  without iOS-specific quirks (StoreKit, viewport meta edge cases, home-screen
  PWA behavior, input accessory view). Catches ~90 % of rendering bugs;
  misses device-specific bugs.
- **Emulated Android ≠ real Android Chrome.** Pixel 7 preset is Chromium
  (Blink) with mobile viewport + touch events — not the actual Android
  browser. Catches layout/touch bugs; misses GPU-path and Android-Chrome
  update-cycle bugs.
- **No real device.** If we hit a bug that only repros on a physical
  device (rare), we need a service — BrowserStack Live or Sauce Labs.

## Future step (only if needed)

Wire BrowserStack as a sixth smoke target, gated to production deploys only
(cost). Playwright has first-party BrowserStack support via
`@playwright/test-browserstack` or a simple `wsEndpoint:` launch option. Defer
until we hit a bug the emulators don't catch.

## Spec hygiene requirements

Specs that only work on one engine must opt out explicitly — don't rely on
the smoke expansion silently skipping them:

```js
test.skip(({ browserName }) => browserName === 'webkit', 'Chrome-only DevTools path')
```

Specs should avoid Chrome-specific APIs in assertions (e.g.
`navigator.userAgentData`, `chrome.*`) and avoid selectors that depend on
default Chrome rendering (e.g. scrollbar widths, font fallbacks).

## Rollout

1. Add the six smoke projects to `playwright.config.js`.
2. Install WebKit/Firefox/Edge binaries locally and in CI.
3. Run smoke locally against staging on all six — fix anything that breaks.
4. Ship; `/stage` automatically picks up the expanded matrix.
5. Revisit BrowserStack if a real-device bug lands that the matrix misses.
