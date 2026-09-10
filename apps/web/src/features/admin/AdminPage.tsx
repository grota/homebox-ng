import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminUsersTab } from './AdminUsersTab'
import { AdminSettingsTab } from './AdminSettingsTab'
import { AdminBackupTab } from './AdminBackupTab'
import { AdminSystemTab } from './AdminSystemTab'

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
      <h1>{t('admin.title')}</h1>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={`px-3 py-1.5 border-b-2 ${tab === x.id ? 'border-accent text-accent' : 'border-transparent'}`}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <AdminUsersTab />}
      {tab === 'settings' && <AdminSettingsTab />}
      {tab === 'backup' && <AdminBackupTab />}
      {tab === 'system' && <AdminSystemTab />}
    </div>
  )
}
