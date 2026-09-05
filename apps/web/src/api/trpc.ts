import { createTRPCReact, httpBatchLink } from '@trpc/react-query'
import type { AppRouter } from '@homebox/api'

// Typed tRPC hooks for the whole app. `AppRouter` is the router type re-exported
// by the already-built `@homebox/api` package.
export const trpc = createTRPCReact<AppRouter>()

// The client used by `TrpcProvider`. `credentials: 'include'` is required so the
// httpOnly `session` cookie set by the backend is sent on every request.
export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
    }),
  ],
})
