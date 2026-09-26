import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as api from './api.js'
import useBookmarks from './useBookmarks.js'

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listBookmarks: vi.fn(),
  setBookmark: vi.fn(),
}))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useBookmarks', () => {
  it('loads, toggles optimistically, and saves one at a time in tap order', async () => {
    api.listBookmarks.mockResolvedValue({ questionIds: ['q1'] })
    const first = deferred()
    api.setBookmark.mockReturnValueOnce(first.promise).mockResolvedValueOnce({})
    const { result } = renderHook(() => useBookmarks('s1'))
    await waitFor(() => expect(result.current.available).toBe(true))
    expect(result.current.has('q1')).toBe(true)

    act(() => { result.current.toggle('q2') })
    expect(result.current.has('q2')).toBe(true)
    act(() => { result.current.toggle('q2') })
    expect(result.current.has('q2')).toBe(false)
    await act(async () => {})
    expect(api.setBookmark).toHaveBeenCalledTimes(1)
    expect(api.setBookmark).toHaveBeenLastCalledWith('s1', 'q2', true)
    await act(async () => { first.resolve({}) })
    expect(api.setBookmark).toHaveBeenCalledTimes(2)
    expect(api.setBookmark).toHaveBeenLastCalledWith('s1', 'q2', false)
  })

  it('re-reads the server list when a save fails', async () => {
    api.listBookmarks.mockResolvedValueOnce({ questionIds: [] }).mockResolvedValueOnce({ questionIds: ['q9'] })
    api.setBookmark.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useBookmarks('s1'))
    await waitFor(() => expect(result.current.available).toBe(true))
    await act(async () => { await result.current.toggle('q3') })
    await waitFor(() => expect(result.current.has('q9')).toBe(true))
    expect(result.current.has('q3')).toBe(false)
    expect(api.listBookmarks).toHaveBeenCalledTimes(2)
  })

  it('is unavailable when the list cannot be read (free practice off)', async () => {
    api.listBookmarks.mockRejectedValue(new Error('PRACTICE_DISABLED'))
    const { result } = renderHook(() => useBookmarks('s1'))
    await act(async () => {})
    expect(result.current.available).toBe(false)
  })
})
