import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <div>
      <h1>Homebox</h1>
      <nav>
        <Link to="/items">Items</Link>
        <Link to="/locations">Locations</Link>
        <Link to="/types">Item types</Link>
        <Link to="/tags">Tags</Link>
        <Link to="/settings">Settings</Link>
      </nav>
    </div>
  )
}
