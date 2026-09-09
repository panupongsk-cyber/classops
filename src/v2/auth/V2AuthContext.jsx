import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiRequest, apiUrl } from './api.js'

const V2AuthContext = createContext(null)

export function V2AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest('/api/auth/me')
      setUser(result.user)
      return result.user
    } catch (error) {
      if (error.status !== 401) throw error
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setUser(null)).finally(() => setLoading(false))
  }, [refresh])

  const value = useMemo(() => ({
    user,
    loading,
    refresh,
    async logout() {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      setUser(null)
    },
    startGoogleLogin() {
      window.location.assign(apiUrl('/api/auth/google'))
    },
  }), [loading, refresh, user])

  return <V2AuthContext.Provider value={value}>{children}</V2AuthContext.Provider>
}

export function useV2Auth() {
  const context = useContext(V2AuthContext)
  if (!context) throw new Error('useV2Auth must be used inside V2AuthProvider')
  return context
}
