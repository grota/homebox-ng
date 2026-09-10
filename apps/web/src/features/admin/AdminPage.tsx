import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminUsersTab } from './AdminUsersTab'
import { AdminSettingsTab } from './AdminSettingsTab'
import { AdminBackupTab } from './AdminBackupTab'
import { AdminSystemTab } from './AdminSystemTab'
import { PageHeader, Tabs } from '../../ui'

export type AdminTab = 'users' | 'settings' | 'backup' | 'system'

export function AdminPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AdminTab>('users')
  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'users', label: t('admin.tabs.users') },
    { id: 'settings', label: t('admin.tabs.settings') },
    { id: 'backup', label: t('admin.tabs.backup') },
    { id: 'system', label: t('admin.tabs.system') },
  ]
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.title')} />
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={tabs}
      >
        {tab === 'users' && <AdminUsersTab />}
        {tab === 'settings' && <AdminSettingsTab />}
        {tab === 'backup' && <AdminBackupTab />}
        {tab === 'system' && <AdminSystemTab />}
      </Tabs>
    </div>
  )
}
