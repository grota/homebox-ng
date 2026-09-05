import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn, SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Phase-1 core tables. SQLite via better-sqlite3 + Drizzle.
// Object names are camelCase; SQL table/column names are snake_case.
// Timestamps are INTEGER Unix-epoch *milliseconds* (`timestamp_ms` mode →
// JS `Date`). Booleans are stored as 0/1 but surfaced as JS booleans.
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').notNull().unique(),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const locations: SQLiteTableWithColumns<any> = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parent_id: integer('parent_id').references((): AnySQLiteColumn => locations.id),
  name: text('name').notNull(),
  description: text('description'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemTypes = sqliteTable('item_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemTypeFields = sqliteTable('item_type_fields', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  item_type_id: integer('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  field_type: text('field_type', {
    enum: ['text', 'number', 'currency', 'date', 'boolean', 'url'],
  }).notNull(),
  required: integer('required', { mode: 'boolean' }).default(false),
  config: text('config', { mode: 'json' }),
  sort_order: integer('sort_order').default(0),
})

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  quantity: integer('quantity').notNull().default(1),
  unit: text('unit'),
  item_type_id: integer('item_type_id').notNull().references(() => itemTypes.id),
  location_id: integer('location_id').references(() => locations.id),
  created_by: integer('created_by').notNull().references(() => users.id),
  published: integer('published', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemCustomFieldValues = sqliteTable('item_custom_field_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  item_id: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  field_id: integer('field_id').notNull().references(() => itemTypeFields.id, { onDelete: 'cascade' }),
  value: text('value'),
})

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  color: text('color'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const itemTags = sqliteTable(
  'item_tags',
  {
    item_id: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    tag_id: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.item_id, t.tag_id] })]
)

export const images = sqliteTable('images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  item_id: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  original_path: text('original_path').notNull(),
  edited_path: text('edited_path'),
  thumb_path: text('thumb_path').notNull(),
  width: integer('width'),
  height: integer('height'),
  format: text('format'),
  size_bytes: integer('size_bytes'),
  sort_order: integer('sort_order'),
  is_primary: integer('is_primary', { mode: 'boolean' }).default(false),
})
