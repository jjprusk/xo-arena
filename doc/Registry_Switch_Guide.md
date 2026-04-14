<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Game Registry Switch Guide

> How game packages are loaded, published, and how to switch between loading paths.

---

## Two Loading Paths

The platform supports two ways to load a game:

### 1. Bundled path (current)

The game is aliased into the platform's Vite build and emitted as a separate chunk at build time.

```js
// landing/vite.config.js
alias: {
  '@callidity/game-xo': resolve(__dirname, '../packages/game-xo/src/index.js'),
}

// PlayPage.jsx
const XOGame = lazy(() => import('@callidity/game-xo'))
```

**Pros:** Zero runtime latency, shared React instance, works without network.  
**Cons:** Adding a new game requires a platform rebuild and redeploy.

### 2. URL import path (future — Phase 7)

The game is loaded from an external URL at runtime, enabling third-party games without platform rebuilds.

```js
// PlayPage.jsx
const XOGame = lazy(() => import(/* @vite-ignore */ 'https://games.callidity.dev/game-xo@1.0.0/index.js'))
```

**Requires:** A shared React instance across the platform and game bundle (see section below).  
**Status:** Architecture validated. Importmap implementation deferred to Phase 7.

---

## Publishing to GitHub Packages

Packages live under the `@callidity` npm scope on GitHub Packages (`https://npm.pkg.github.com`).

### One-time setup: cross-org publish token

Publishing from `jjprusk/xo-arena` to the `callidity` GitHub org requires a PAT — `GITHUB_TOKEN` is scoped to the source repo only.

1. In GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained**
2. Create a token scoped to the `callidity` org with **Read and Write** on *Packages*
3. In `jjprusk/xo-arena` → **Settings → Secrets → Actions**, add secret: `CALLIDITY_NPM_TOKEN`
4. Update `.github/workflows/publish-packages.yml` to use `CALLIDITY_NPM_TOKEN`:

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.CALLIDITY_NPM_TOKEN }}
```

### Triggering a publish

**Manual (any branch):**
1. GitHub → Actions → "Publish packages" → Run workflow
2. Optional: specify a single package (e.g. `game-xo`) to avoid publishing others

**Automatic:**
Triggered on push to `main` when any file under `packages/sdk/**` or `packages/game-xo/**` changes.

### Version bump before publish

Increment the version in `packages/game-xo/package.json` before triggering (GitHub Packages rejects duplicate versions):

```bash
# In packages/game-xo/
npm version patch   # 1.0.0 → 1.0.1
# or
npm version minor   # 1.0.0 → 1.1.0
```

---

## Installing a published package

Add `.npmrc` to any project that needs to install `@callidity/*`:

```
@callidity:registry=https://npm.pkg.github.com
```

Then install normally:

```bash
npm install @callidity/game-xo
npm install @callidity/sdk
```

Reading from GitHub Packages requires a token with `read:packages`. For CI:

```yaml
- uses: actions/setup-node@v4
  with:
    registry-url: https://npm.pkg.github.com
    scope: '@callidity'
env:
  NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # works for jjprusk/xo-arena packages
  # Use CALLIDITY_NPM_TOKEN for callidity/* packages
```

---

## The React Shared-Instance Requirement (URL path)

When a game is loaded via URL import, it must use **the same React instance** as the platform. Two React instances break hooks (`useState`, `useEffect`, etc.) because `ReactCurrentDispatcher.current` — the fiber registry — is owned by the platform's React, but the game's hooks reference its own copy.

### Solution: Import Maps

Declare React as a shared URL in the platform's `index.html`:

```html
<script type="importmap">
{
  "imports": {
    "react":     "https://esm.sh/react@19.0.0",
    "react-dom": "https://esm.sh/react-dom@19.0.0"
  }
}
</script>
```

Both the platform bundle and the game bundle must mark React as external and import it from the same URL. The platform's Vite config would need `build.rollupOptions.external: ['react', 'react-dom']` for this to work in production.

**This is the Phase 7 implementation target.**

### Game bundle build config (when URL path is implemented)

```js
// packages/game-xo/vite.config.js
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: 'game-xo',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'react-dom'],
    },
  },
})
```

The output `game-xo.js` will have `import React from 'react'` which resolves via importmap at runtime.

---

## Switching a Game from Bundled → Registry

When a game is stable and published to the registry:

1. Remove the Vite alias from `landing/vite.config.js`
2. Remove the `packages/game-xo` volume mount from `docker-compose.yml` (dev only)
3. In `package.json`: replace `"@callidity/game-xo": "*"` with a pinned version
4. Ensure importmap is in place (Phase 7)
5. Change PlayPage import to URL-based dynamic import

Until Phase 7 importmap work is done, all first-party games use the bundled path.
