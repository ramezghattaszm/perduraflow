'use client'

import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@perduraflow/app/lib/query-client'
import { restoreSession } from '@perduraflow/app/lib/session'
import { setTokenStore } from '@perduraflow/app/lib/token-store'
import { initI18n } from '@perduraflow/app/i18n'
import { webTokenStore } from '../src/lib/web-token-store'

// Register the web token store (presence cookie) and i18n once on the client.
setTokenStore(webTokenStore)
initI18n()

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void restoreSession()
  }, [])
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
