import { useState } from 'react'
import { NavLink, Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/items', key: 'items' },
  { to: '/locations', key: 'locations' },
  { to: '/types', key: 'types' },
  { to: '/tags', key: 'tags' },
  { to: '/settings', key: 'settings' },
  { to: '/drafts', key: 'drafts' },
  { to: '/trash', key: 'trash' },
]

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `px-3 py-1.5 rounded-md text-sm no-underline ${isActive ? 'bg-accent text-accent-contrast' : 'text-text hover:bg-surface-raised'}`
}

// Responsive site shell for authenticated pages: a fixed header with a brand
// link and a horizontal nav at `md:` and up, collapsing to a hamburger drawer
// below `md:`. Renders the routed page via <Outlet/>.
export function Shell() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  const close = () => setOpen(false)

  const adminNav = user?.role === 'admin' ? [{ to: '/admin', key: 'admin' }] : []
  const items = [...navItems, ...adminNav]

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold text-lg no-underline text-text">{t('app.title')}</Link>
          {/* Horizontal nav, hidden below md. */}
          <nav className="hidden md:flex gap-1">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>{t(`nav.${item.key}`)}</NavLink>
            ))}
          </nav>
          {/* Hamburger, shown below md only. */}
          <button
            type="button"
            data-testid="drawer-toggle"
            className="md:hidden px-2 py-1 rounded border border-border bg-bg text-text"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
        </div>

        {/* Drawer (below md only). */}
        {open && (
          <nav className="md:hidden flex flex-col gap-1 px-4 pb-3" data-testid="drawer-nav">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={close}>
                {t(`nav.${item.key}`)}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      {/* Full width, and **each page declares its own measure**. A catalogue grid
          and a location tree want the room that a 1152px column threw away — on a
          1880px window that was ~730px of empty margin — while a form wants a
          readable line length. So the measure lives on the page that needs it
          (`max-w-[30rem] mx-auto` and friends), not here, where one number applied
          to everything and could only ever be wrong for most of it. */}
      <main className="w-full px-4 py-6" data-testid="content">
        <Outlet />
      </main>
    </div>
  )
}
