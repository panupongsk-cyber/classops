import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

export default function LegacyRoot() {
  return <AuthProvider><App /></AuthProvider>
}
