import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listBookmarks, setBookmark } from './api.js'

// The caller's bookmarked question ids in this Section (PS-TASK-20260925-770), with a toggle.
// Optimistic; saves run one at a time in tap order (so an on-off double tap ends as shown), and on
// failure the server's list is re-read.
export default function useBookmarks(sectionId) {
  const [ids, setIds] = useState(() => new Set())
  const [available, setAvailable] = useState(false) // false while loading, or when free practice is off
  const chain = useRef(Promise.resolve())
  const reload = useCallback(() => listBookmarks(sectionId)
    .then((r) => { setIds(new Set(r.questionIds)); setAvailable(true) })
    .catch(() => setAvailable(false)), [sectionId])
  useEffect(() => { reload() }, [reload])
  const toggle = useCallback(async (questionId) => {
    const on = !ids.has(questionId)
    setIds((current) => {
      const next = new Set(current)
      if (on) next.add(questionId); else next.delete(questionId)
      return next
    })
    const run = chain.current.then(() => setBookmark(sectionId, questionId, on))
    chain.current = run.catch(() => {})
    try {
      await run
    } catch {
      reload()
    }
  }, [ids, sectionId, reload])
  return useMemo(() => ({ has: (id) => ids.has(id), toggle, size: ids.size, available }), [ids, toggle, available])
}
