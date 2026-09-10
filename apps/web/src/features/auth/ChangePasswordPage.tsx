import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input } from '../../ui'

// Forced password-change screen. Shown to a user whose `auth.me` returns
// `mustChangePassword: true` (a newly-created/invited account, or one whose
// password an admin reset). The route guard fills the other half of the flow:
// if the flag is ever cleared (change succeeded, or a non-forced user landed
// here directly), we bounce home so the user is never trapped on a form that no
// longer applies.
export function ChangePasswordPage() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const navigate = useNavigate()

  const changePassword = trpc.auth.changePassword.useMutation()
  const utils = trpc.useUtils()

  // Exit guard: a cleared or never-set flag means the form does not apply, so
  // redirect instead of stranding the user. This also re-fires after a
  // successful change — `invalidate` re-reads `me` as `mustChangePassword:
  // false`, and the declarative `Navigate` takes over from the explicit
  // `navigate('/')` in `handleSubmit`.
  if (!user?.mustChangePassword) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await changePassword.mutateAsync({ current, next })
    // Invalidate `auth.me` so `useAuth` re-reads `mustChangePassword: false`;
    // `changePassword` already reset the flag server-side.
    await utils.auth.me.invalidate()
    navigate('/')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] my-4">
      <h1>Change password</h1>

      <Field label="Current password" htmlFor="current-password">
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>

      <Field label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={changePassword.isPending}>
        Change password
      </Button>

      {changePassword.error && <p role="alert" className="text-text-muted">{changePassword.error.message}</p>}
    </form>
  )
}
