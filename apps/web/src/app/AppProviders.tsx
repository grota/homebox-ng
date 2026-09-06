import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc, trpcClient } from '../api/trpc'
import { SettingsProvider } from '../lib/settings/SettingsProvider'

const queryClient = new QueryClient()

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <BrowserRouter>
          <SettingsProvider>{children}</SettingsProvider>
        </BrowserRouter>
      </trpc.Provider>
    </QueryClientProvider>
  )
}
