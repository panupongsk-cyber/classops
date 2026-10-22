import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getFeedVersion } from './api.js'
import { useFeedPolling } from './useFeedPolling.js'

vi.mock('./api.js', () => ({ getFeedVersion: vi.fn() }))

let visibility = 'visible'
beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  getFeedVersion.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

test('refreshes only when the version changes, every interval while visible', async () => {
  getFeedVersion.mockResolvedValue({ version: 'v1' })
  const onChange = vi.fn()
  renderHook(() => useFeedPolling('S1', 'v1', onChange, { intervalMs: 1000 }))
  await tick(1000)
  expect(getFeedVersion).toHaveBeenCalledWith('S1')
  expect(onChange).not.toHaveBeenCalled()
  getFeedVersion.mockResolvedValue({ version: 'v2' })
  await tick(1000)
  expect(onChange).toHaveBeenCalledTimes(1)
})

test('a hidden tab does not poll, and checks once when shown again', async () => {
  getFeedVersion.mockResolvedValue({ version: 'v2' })
  const onChange = vi.fn()
  visibility = 'hidden'
  renderHook(() => useFeedPolling('S1', 'v1', onChange, { intervalMs: 1000 }))
  await tick(5000)
  expect(getFeedVersion).not.toHaveBeenCalled()
  visibility = 'visible'
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(getFeedVersion).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledTimes(1)
})

test('a failed check is retried; losing access stops polling', async () => {
  const onChange = vi.fn()
  renderHook(() => useFeedPolling('S1', 'v1', onChange, { intervalMs: 1000 }))
  getFeedVersion.mockRejectedValueOnce(new Error('offline'))
  await tick(1000)
  getFeedVersion.mockRejectedValueOnce(Object.assign(new Error('FORBIDDEN'), { status: 403 }))
  await tick(1000)
  await tick(5000)
  expect(getFeedVersion).toHaveBeenCalledTimes(2)
  expect(onChange).not.toHaveBeenCalled()
})

test('nothing polls before the first load, and unmounting stops it', async () => {
  getFeedVersion.mockResolvedValue({ version: 'v1' })
  const { rerender, unmount } = renderHook(({ v }) => useFeedPolling('S1', v, vi.fn(), { intervalMs: 1000 }), { initialProps: { v: null } })
  await tick(3000)
  expect(getFeedVersion).not.toHaveBeenCalled()
  rerender({ v: 'v1' })
  await tick(1000)
  expect(getFeedVersion).toHaveBeenCalledTimes(1)
  unmount()
  await tick(5000)
  expect(getFeedVersion).toHaveBeenCalledTimes(1)
})
