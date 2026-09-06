import { Route, Routes } from 'react-router-dom'
import { RequireAuth, SetupGate } from '../lib/auth'
import { LoginPage } from '../features/auth/LoginPage'
import { SetupPage } from '../features/auth/SetupPage'
import { HomePage } from '../features/home/HomePage'
import { LocationsPage } from '../features/locations/LocationsPage'
import { ItemTypesPage } from '../features/itemTypes/ItemTypesPage'
import { TagsPage } from '../features/tags/TagsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { ItemsPage } from '../features/items/ItemsPage'
import { ItemDetail } from '../features/items/ItemDetail'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SetupGate><LoginPage /></SetupGate>} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/"
        element={
          <SetupGate>
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          </SetupGate>
        }
      />
      <Route
        path="/locations"
        element={
          <RequireAuth>
            <LocationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/types"
        element={
          <RequireAuth>
            <ItemTypesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tags"
        element={
          <RequireAuth>
            <TagsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/items"
        element={
          <RequireAuth>
            <ItemsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/items/:id"
        element={
          <RequireAuth>
            <ItemDetail />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
