import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The api server spawned by `webServer` runs with cwd `apps/api`, so its
// `DATABASE_PATH: './data/e2e.db'` lands at `apps/api/data/e2e.db`. Reset it
// (plus WAL/SHM and the uploads dir) between runs so `/setup` always sees an
// empty database on first run.
const apiDataDir = path.resolve(__dirname, '../../api/data')

export default async function globalSetup() {
  await rm(path.join(apiDataDir, 'e2e.db'), { force: true })
  await rm(path.join(apiDataDir, 'e2e.db-wal'), { force: true })
  await rm(path.join(apiDataDir, 'e2e.db-shm'), { force: true })
  await rm(path.join(apiDataDir, 'e2e-uploads'), { recursive: true, force: true })
}
