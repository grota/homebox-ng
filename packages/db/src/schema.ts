import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn, SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Phase-1 core tables. SQLite via better-sqlite3 + Drizzle.
// Object keys are camelCase (the JS surface used by the app layer); the SQL
// table/column names stay snake_case (the 2nd argument to each column builder).
// Timestamps are INTEGER Unix-epoch *milliseconds* (`timestamp_ms` mode →
// JS `Date`). Booleans are stored as 0/1 but surfaced as JS booleans.
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const locations: SQLiteTableWithColumns<any> = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id').references((): AnySQLiteColumn => locations.id),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemTypes = sqliteTable('item_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemTypeFields = sqliteTable('item_type_fields', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemTypeId: integer('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  fieldType: text('field_type', {
    enum: ['text', 'number', 'currency', 'date', 'boolean', 'url'],
  }).notNull(),
  required: integer('required', { mode: 'boolean' }).default(false),
  config: text('config', { mode: 'json' }),
  sortOrder: integer('sort_order').default(0),
})

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  quantity: integer('quantity').notNull().default(1),
  unit: text('unit'),
  itemTypeId: integer('item_type_id').notNull().references(() => itemTypes.id),
  locationId: integer('location_id').references(() => locations.id),
  createdBy: integer('created_by').notNull().references(() => users.id),
  published: integer('published', { mode: 'boolean' }).notNull().default(true),
  // Trash (ADR-0004). A timestamp rather than a boolean because the trash page shows
  // *when*, and a boolean cannot. Null means "not trashed", so every existing row is
  // already correct and no backfill is needed.
  trashedAt: integer('trashed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemCustomFieldValues = sqliteTable(
  'item_custom_field_values',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id').notNull().references(() => itemTypeFields.id, { onDelete: 'cascade' }),
    value: text('value'),
  },
  (t) => [index('idx_icfv_field_id').on(t.fieldId), index('idx_icfv_item_id').on(t.itemId)]
)

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const userSettings = sqliteTable('user_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: text('language').notNull().default('en'),
  locale: text('locale').notNull().default('en-US'),
  themeMode: text('theme_mode', { enum: ['auto', 'light', 'dark'] }).notNull().default('auto'),
  lightThemeId: text('light_theme_id').notNull().default('light-default'),
  darkThemeId: text('dark_theme_id').notNull().default('dark-default'),
  // How this user reads the catalog list. A per-user preference rather than an
  // instance setting. `relevance` is deliberately absent: it is a consequence of
  // searching, not a preference, and with no search term there is no rank for it
  // to mean. As with `theme_mode`, the `enum` constrains the TS type only — the
  // stored value is validated by zod on the wire.
  itemsSort: text('items_sort', {
    enum: ['createdAt:desc', 'createdAt:asc', 'updatedAt:desc', 'updatedAt:asc', 'name:asc', 'name:desc'],
  })
    .notNull()
    .default('createdAt:desc'),
  // How many rows a page of a paged list holds (the catalog, the drafts, the
  // trash) — per-user for the same reason as `items_sort`. The literal default
  // and range mirror `DEFAULT_ITEMS_PER_PAGE` / `ITEMS_PER_PAGE_MIN|MAX` in
  // `@homebox/shared`, which is what the wire validates against; this package
  // depends on no other workspace package, so the numbers are spelled out here
  // as `items_sort`'s list already is.
  itemsPerPage: integer('items_per_page').notNull().default(20),
  // Whether a move-to-trash asks first. Off by default: the trash is recoverable
  // (ADR-0004), so asking is the opt-in, not the default.
  confirmTrash: integer('confirm_trash', { mode: 'boolean' }).notNull().default(false),
  // Whether the photo dialogs skip their save-as step and save with its
  // defaults. On by default: picking a photo is one dialog rather than two
  // unless the user opts into the second one.
  skipSaveDialog: integer('skip_save_dialog', { mode: 'boolean' }).notNull().default(true),
})

export const instanceSettings = sqliteTable('instance_settings', {
  id: integer('id').primaryKey(), // fixed row id = 1
  maxUploadMb: integer('max_upload_mb').notNull().default(10),
  detectionProvider: text('detection_provider', { enum: ['local', 'google', 'openai'] })
    .notNull().default('google'),
  detectionConfig: text('detection_config', { mode: 'json' }),
})

export const itemTags = sqliteTable(
  'item_tags',
  {
    itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] })]
)

export const images = sqliteTable('images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  originalPath: text('original_path').notNull(),
  editedPath: text('edited_path'),
  thumbPath: text('thumb_path').notNull(),
  width: integer('width'),
  height: integer('height'),
  format: text('format'),
  sizeBytes: integer('size_bytes'),
  sortOrder: integer('sort_order'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false),
})

// ---------------------------------------------------------------------------
// FTS5 search index. A Drizzle `sqliteTable` models the columns so the query
// builder can `select`/`insert`/`delete` against it, but the table itself is a
// SQLite **virtual** table — `item_id` is stored `UNINDEXED`, and the
// `MATCH`/`rank`/`snippet` concerns stay in raw `sql`. Created by migration
// `0001_add_items_fts.sql` (Drizzle cannot generate a VIRTUAL TABLE).
// ---------------------------------------------------------------------------
export const itemsFts = sqliteTable('items_fts', {
  itemId: integer('item_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  tags: text('tags').notNull(),
  customFields: text('custom_fields').notNull(),
  typeName: text('type_name').notNull(),
  locationPath: text('location_path').notNull(),
})
