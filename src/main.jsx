import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'

const useV2Auth = import.meta.env.VITE_AUTH_MODE === 'v2'
const RootApplication = lazy(() => useV2Auth ? import('./v2/V2Root.jsx') : import('./LegacyRoot.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
    <BrowserRouter>
        <Suspense fallback={<main style={{ padding: 32 }}>กำลังโหลด ClassOps…</main>}>
            <RootApplication />
        </Suspense>
    </BrowserRouter>,
)
