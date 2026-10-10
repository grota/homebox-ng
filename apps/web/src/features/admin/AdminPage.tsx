import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AdminUsersTab } from './AdminUsersTab'
import { AdminSettingsTab } from './AdminSettingsTab'
import { AdminBackupTab } from './AdminBackupTab'
import { AdminSystemTab } from './AdminSystemTab'
import { PageHeader, Tabs } from '../../ui'

export const ADMIN_TABS = ['users', 'settings', 'backup', 'system'] as const
export type AdminTab = (typeof ADMIN_TABS)[number]

const isAdminTab = (value: string | undefined): value is AdminTab => (ADMIN_TABS as readonly string[]).includes(value ?? '')

// The tab is the URL (`/admin/:tab`), not component state: a reload lands on the
// same tab, a tab can be linked to, and Back returns to the previous one —
// switching pushes a history entry rather than replacing it.
export function AdminPage() {
  const { t } = useTranslation()
  const { tab } = useParams()
  const navigate = useNavigate()
  // A mistyped or stale tab goes to the first one rather than to a blank page.
  if (!isAdminTab(tab)) return <Navigate to="/admin/users" replace />

  return (
    <div className="space-y-4 max-w-[64rem] mx-auto">
      <PageHeader title={t('admin.title')} />
      <Tabs
        value={tab}
        onValueChange={(next) => navigate(`/admin/${next}`)}
        items={ADMIN_TABS.map((id) => ({ id, label: t(`admin.tabs.${id}`) }))}
        ariaLabel={t('admin.tabsLabel')}
      >
        {tab === 'users' && <AdminUsersTab />}
        {tab === 'settings' && <AdminSettingsTab />}
        {tab === 'backup' && <AdminBackupTab />}
        {tab === 'system' && <AdminSystemTab />}
      </Tabs>
    </div>
  )
}
