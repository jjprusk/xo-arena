// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.8 — feature-flag fetch hook.
 *
 * Reads `/api/v1/config/features` once per mount and caches the
 * result. The endpoint exposes per-feature booleans sourced from
 * SystemConfig so admins can flip them without a redeploy.
 *
 * v1 flags:
 *   - trainingAdvancedKnobs: when true, non-admin users see the
 *     gym TrainTab "Advanced" disclosure. Admins always see it
 *     regardless of this flag (handled in the calling component).
 *
 * Failures are swallowed and the hook reports `{}` — the caller's
 * default-off behavior (knobs hidden) is the safe fallback.
 */
import { useEffect, useState } from 'react'

const FEATURES_URL = '/api/v1/config/features'

export function useFeatures() {
  const [features, setFeatures] = useState({})
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(FEATURES_URL, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : {}))
      .then(json => {
        if (!cancelled) setFeatures(json && typeof json === 'object' ? json : {})
      })
      .catch(() => { if (!cancelled) setFeatures({}) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { features, loading }
}
