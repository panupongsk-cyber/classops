import V2App from './V2App.jsx'
import { V2AuthProvider } from './auth/V2AuthContext.jsx'
import './v2-auth.css'

export default function V2Root() {
  return <V2AuthProvider><V2App /></V2AuthProvider>
}
