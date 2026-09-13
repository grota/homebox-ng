import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { RequireAdmin, RequireAuth, SetupGate } from '../lib/auth'
import { AdminPage } from '../features/admin'
import { LoginPage } from '../features/auth/LoginPage'
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage'
import { SetupPage } from '../features/auth/SetupPage'
import { LocationsPage } from '../features/locations/LocationsPage'
import { ItemTypesPage } from '../features/itemTypes/ItemTypesPage'
import { TagsPage } from '../features/tags/TagsPage'
import { ItemsPage } from '../features/items/ItemsPage'
import { ItemDetail } from '../features/items/ItemDetail'
import { SettingsPage } from '../features/settings/SettingsPage'
import { DraftsPage } from '../features/drafts'
import { TrashPage } from '../features/trash'
import { Shell } from './Shell'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SetupGate><LoginPage /></SetupGate>} />
      <Route path="/setup" element={<SetupPage />} />

      {/* The item surface keeps the gates and drops the Shell: it is the one
          authenticated page that is full-screen and nav-less, which is what makes
          it feel like the overlay it replaces without being a dialog (ADR-0005).
          Its own top bar carries the way out. */}
      <Route
        element={
          <SetupGate>
            <RequireAuth>
              <Outlet />
            </RequireAuth>
          </SetupGate>
        }
      >
        <Route path="/items/:id" element={<ItemDetail />} />
      </Route>

      {/* Every other authenticated, first-run-gated route renders inside the shared Shell. */}
      <Route
        element={
          <SetupGate>
            <RequireAuth>
              <Shell />
            </RequireAuth>
          </SetupGate>
        }
      >
        {/* `/` is the way in from the brand link and from every post-login
            redirect, so it lands on the catalog rather than a placeholder.
            `replace` keeps the detour out of the history stack. */}
        <Route path="/" element={<Navigate to="/items" replace />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/types" element={<ItemTypesPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
    <Route path="/trash" element={<TrashPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
      </Route>
    </Routes>
  )
}
