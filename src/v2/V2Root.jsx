import V2App from './V2App.jsx'
import { V2AuthProvider } from './auth/V2AuthContext.jsx'
import { I18nProvider } from './i18n/I18nContext.jsx'
import './v2-auth.css'
import './v2-app.css'

export default function V2Root() {
  return (
    <I18nProvider>
      <V2AuthProvider><V2App /></V2AuthProvider>
    </I18nProvider>
  )
}
