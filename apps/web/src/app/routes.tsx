import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../lib/auth'
import { LoginPage } from '../features/auth/LoginPage'
import { SetupPage } from '../features/auth/SetupPage'
import { HomePage } from '../features/home/HomePage'
import { LocationsPage } from '../features/locations/LocationsPage'
import { ItemTypesPage } from '../features/itemTypes/ItemTypesPage'
import { TagsPage } from '../features/tags/TagsPage'
import { ItemsPage } from '../features/items/ItemsPage'
import { ItemDetail } from '../features/items/ItemDetail'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
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
