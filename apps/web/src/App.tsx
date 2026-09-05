import { AppProviders } from './app/AppProviders'
import { AppRoutes } from './app/routes'

export default function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  )
}
