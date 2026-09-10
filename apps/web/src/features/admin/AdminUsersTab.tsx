import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import type { Role } from '@homebox/shared'
import { Button, Card, Field, Input, Select } from '../../ui'

// A generated one-time value for the "reset password" action. Reuse the create
// flow's temp-password banner so the admin can copy it to the user.
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

// Admin-only user management: list users, invite a new user (surfacing the
// one-time temp password the create response flags via `mustChangePassword`),
// change roles, force a password reset, and delete.
export function AdminUsersTab() {
  const utils = trpc.useUtils()
  const { t } = useTranslation()
  const { data: users, isLoading } = trpc.users.list.useQuery()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [tempPassword, setTempPassword] = useState<{ userId: number; name: string; password: string } | null>(null)

  const create = trpc.users.create.useMutation()
  const update = trpc.users.update.useMutation()
  const remove = trpc.users.delete.useMutation()

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const created = await create.mutateAsync({ name, email, password, role })
    setTempPassword({ userId: created.id, name: created.name, password })
    setName('')
    setEmail('')
    setPassword('')
    setRole('user')
    await utils.users.list.invalidate()
  }

  const changeRole = (id: number, next: Role) =>
    update.mutate({ id, role: next }, { onSuccess: () => void utils.users.list.invalidate() })

  const resetPassword = async (id: number) => {
    const u = users?.find((x) => x.id === id)
    const newPassword = generateTempPassword()
    await update.mutateAsync({ id, password: newPassword })
    setTempPassword({ userId: id, name: u?.name ?? 'user', password: newPassword })
    await utils.users.list.invalidate()
  }

  const deleteUser = (id: number) =>
    remove.mutate({ id }, { onSuccess: () => void utils.users.list.invalidate() })

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('admin.users.title')}</h2>

      <form className="flex flex-col gap-3 max-w-[30rem]" onSubmit={handleCreate}>
        <Field label={t('admin.users.name')} htmlFor="admin-user-name">
          <Input
            id="admin-user-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label={t('admin.users.email')} htmlFor="admin-user-email">
          <Input
            id="admin-user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label={t('admin.users.tempPassword')} htmlFor="admin-user-password">
          <Input
            id="admin-user-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <Field label={t('admin.users.role')} htmlFor="admin-user-role">
          <Select
            id="admin-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={create.isPending} className="w-fit">
          {t('admin.users.create')}
        </Button>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>

      {tempPassword && (
        <Card className="max-w-[30rem]">
          <p>{t('admin.users.shareTempPassword', { name: tempPassword.name })}</p>
          <p className="font-mono font-semibold" data-testid="temp-password">{tempPassword.password}</p>
        </Card>
      )}

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="space-y-2">
          {(users ?? []).map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-4 max-w-[30rem]">
              <span>{u.name} · {u.role}</span>
              <span className="flex gap-2">
                {u.role === 'user' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => changeRole(u.id, 'admin')}
                  >
                    {t('admin.users.makeAdmin')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => changeRole(u.id, 'user')}
                  >
                    {t('admin.users.makeUser')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void resetPassword(u.id)}
                >
                  {t('admin.users.resetPassword')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => deleteUser(u.id)}
                >
                  {t('admin.users.remove')}
                </Button>
              </span>
            </li>
          ))}
          {(users ?? []).length === 0 && <li>{t('admin.users.empty')}</li>}
        </ul>
      )}
    </div>
  )
}
