import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

const RootApplication = lazy(() => import('./v2/V2Root.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
    <BrowserRouter>
        <Suspense fallback={<main style={{ padding: 32 }}>กำลังโหลด ClassOps…</main>}>
            <RootApplication />
        </Suspense>
    </BrowserRouter>,
)
