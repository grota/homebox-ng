import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { useAuth, useSetupRequired } from '../../lib/auth'
import { Button, Field, Input } from '../../ui'

export function SetupPage() {
  const { user, isLoading } = useAuth()
  const { setupRequired, isLoading: setupLoading } = useSetupRequired()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const setup = trpc.auth.setup.useMutation()
  const utils = trpc.useUtils()

  // The setup route is only meaningful before an account exists. Wait for the
  // `setupRequired` check, then: if setup is already complete, go to the sign-in
  // screen (there's conceptually a login to reach); if a user is already signed
  // in, send them home.
  if (isLoading || setupLoading) return null
  if (!setupRequired) return <Navigate to="/login" replace />
  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await setup.mutateAsync({ name, email, password })
    // `auth.setup` does not auto-login, so the admin signs in next. Invalidate
    // `requiresSetup` so the cache reflects the newly created user — the
    // `!setupRequired` guard above then routes to `/login`. Without this the
    // stale `setupRequired: true` cache would make `SetupGate` bounce the user
    // straight back to `/setup`.
    await utils.auth.requiresSetup.invalidate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] mx-auto my-4">
      <h1>Setup</h1>

      <Field label="Name" htmlFor="name">
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={setup.isPending}>
        Create account
      </Button>

      {setup.error && <p role="alert" className="text-text-muted">{setup.error.message}</p>}
    </form>
  )
}
