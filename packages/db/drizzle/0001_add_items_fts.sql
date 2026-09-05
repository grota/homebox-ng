CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED,
  name,
  description,
  tags,
  custom_fields,
  type_name,
  location_path,
  tokenize = 'unicode61 remove_diacritics 2'
);
