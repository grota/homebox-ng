import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input } from '../../ui'

export function LoginPage() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const navigate = useNavigate()

  const login = trpc.auth.login.useMutation()
  const utils = trpc.useUtils()

  // An already-signed-in user whose account is forced to change its password
  // must not rest on the sign-in form — send them straight to the change screen
  // (e.g. when they reload `/login` while the `mustChangePassword` flag is set).
  useEffect(() => {
    if (user?.mustChangePassword) navigate('/change-password')
  }, [user, navigate])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const result = await login.mutateAsync({ email, password })
    // The login response sets the session cookie. Run the `auth.me` query and
    // *await* it so the cache holds the freshly-authenticated user before we
    // navigate; otherwise `RequireAuth` reads the stale cached `null` and bounces
    // straight back to `/login`. We `fetch` rather than `invalidate` because on
    // `/login` the `auth.me` query is NOT active, so `invalidate` would only mark
    // it stale without refetching (leaving the user stranded on `/login`).
    await utils.auth.me.fetch()
    // `settings.get` is observed by the always-mounted SettingsProvider, so after
    // login we invalidate it (it's active → refetches) to apply the user's
    // persisted theme/locale/language without a reload; `auth.me` used `fetch`
    // because on /login that query is NOT active, but settings.get IS.
    await utils.settings.get.invalidate()
    setSignedIn(true)
    // A forced password-change account is routed to the change screen instead of
    // home; the `changePassword` form's exit guard (plus the invalidate in its
    // success handler) bounces the user back to `/` once the flag is cleared.
    if (result.mustChangePassword) {
      navigate('/change-password')
    } else {
      navigate('/')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] my-4">
      <h1>Sign in</h1>

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={login.isPending}>
        Sign in
      </Button>

      {login.error && <p role="alert" className="text-danger">{login.error.message}</p>}
      {signedIn && <p>Signed in</p>}
    </form>
  )
}
