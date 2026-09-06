import { Route, Routes } from 'react-router-dom'
import { RequireAdmin, RequireAuth, SetupGate } from '../lib/auth'
import { AdminPage } from '../features/admin'
import { LoginPage } from '../features/auth/LoginPage'
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage'
import { SetupPage } from '../features/auth/SetupPage'
import { HomePage } from '../features/home/HomePage'
import { LocationsPage } from '../features/locations/LocationsPage'
import { ItemTypesPage } from '../features/itemTypes/ItemTypesPage'
import { TagsPage } from '../features/tags/TagsPage'
import { ItemsPage } from '../features/items/ItemsPage'
import { ItemDetail } from '../features/items/ItemDetail'
import { SettingsPage } from '../features/settings/SettingsPage'
import { Shell } from './Shell'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SetupGate><LoginPage /></SetupGate>} />
      <Route path="/setup" element={<SetupPage />} />

      {/* Authenticated, first-run-gated routes all render inside the shared Shell. */}
      <Route
        element={
          <SetupGate>
            <RequireAuth>
              <Shell />
            </RequireAuth>
          </SetupGate>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/types" element={<ItemTypesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/:id" element={<ItemDetail />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
      </Route>
    </Routes>
  )
}
