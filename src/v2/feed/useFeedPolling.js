import { useEffect, useRef } from 'react'
import { getFeedVersion } from './api.js'

export const FEED_POLL_MS = 20_000

// Class Feed updates (#2439): while the page is visible, ask every ~20 s whether the Section's
// feed changed, and call onChange when it did. A hidden tab does not poll; it checks once as soon
// as it is shown again. A failed check is ignored (the next one retries); a 401/403 stops polling,
// because the caller is no longer a member or no longer signed in, and calls onLost so the page
// can say so instead of looking live.
export function useFeedPolling(sectionId, version, onChange, { intervalMs = FEED_POLL_MS, onLost } = {}) {
  const versionRef = useRef(version)
  const onChangeRef = useRef(onChange)
  const onLostRef = useRef(onLost)
  versionRef.current = version
  onChangeRef.current = onChange
  onLostRef.current = onLost

  useEffect(() => {
    if (!sectionId || version === null || version === undefined) return undefined
    let stopped = false
    let checking = false

    async function check() {
      if (stopped || checking || document.visibilityState !== 'visible') return
      checking = true
      try {
        const result = await getFeedVersion(sectionId)
        if (!stopped && result.version !== versionRef.current) await onChangeRef.current()
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) {
          stopped = true
          onLostRef.current?.(err.status)
        }
      } finally {
        checking = false
      }
    }

    const timer = setInterval(check, intervalMs)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sectionId, intervalMs, version === null || version === undefined])
}
