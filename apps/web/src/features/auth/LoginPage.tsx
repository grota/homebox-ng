import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { trpc } from '../../api/trpc'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const navigate = useNavigate()

  const login = trpc.auth.login.useMutation()
  const utils = trpc.useUtils()

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await login.mutateAsync({ email, password })
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
    navigate('/')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] my-4">
      <h1>Sign in</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        />
      </div>

      <button
        type="submit"
        disabled={login.isPending}
        className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
      >
        Sign in
      </button>

      {login.error && <p role="alert" className="text-text-muted">{login.error.message}</p>}
      {signedIn && <p>Signed in</p>}
    </form>
  )
}
