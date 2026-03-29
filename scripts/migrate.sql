-- Create entity analysis tables (idempotent)

CREATE TABLE IF NOT EXISTS repo_entity_approaches (
  id                serial PRIMARY KEY,
  repo_id           integer NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  language          text NOT NULL,
  approach          text NOT NULL,
  confidence        text NOT NULL,
  signals           jsonb NOT NULL DEFAULT '[]',
  detected_at       timestamp NOT NULL DEFAULT now(),
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repo_entity_approaches_repo_approach_uniq
  ON repo_entity_approaches (repo_id, language, approach);

CREATE INDEX IF NOT EXISTS repo_entity_approaches_repo_id_idx
  ON repo_entity_approaches (repo_id);

CREATE TABLE IF NOT EXISTS repo_entities (
  id                  serial PRIMARY KEY,
  repo_id             integer NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name                text NOT NULL,
  normalized_name     text NOT NULL,
  source_approach_id  integer REFERENCES repo_entity_approaches(id) ON DELETE SET NULL,
  entity_type         text NOT NULL,
  confidence          text NOT NULL,
  primary_sources     jsonb NOT NULL DEFAULT '[]',
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repo_entities_repo_normalized_name_uniq
  ON repo_entities (repo_id, normalized_name);

CREATE INDEX IF NOT EXISTS repo_entities_repo_id_idx
  ON repo_entities (repo_id);

CREATE INDEX IF NOT EXISTS repo_entities_repo_entity_type_idx
  ON repo_entities (repo_id, entity_type);

CREATE TABLE IF NOT EXISTS repo_entity_fields (
  id                serial PRIMARY KEY,
  entity_id         integer NOT NULL REFERENCES repo_entities(id) ON DELETE CASCADE,
  name              text NOT NULL,
  normalized_name   text NOT NULL,
  data_type         text NOT NULL,
  native_type       text,
  is_nullable       text,
  is_primary_key    text NOT NULL DEFAULT 'false',
  is_foreign_key    text NOT NULL DEFAULT 'false',
  is_unique         text NOT NULL DEFAULT 'false',
  default_value     text,
  ordinal_position  integer,
  metadata          jsonb,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repo_entity_fields_entity_normalized_name_uniq
  ON repo_entity_fields (entity_id, normalized_name);

CREATE INDEX IF NOT EXISTS repo_entity_fields_entity_id_idx
  ON repo_entity_fields (entity_id);

CREATE TABLE IF NOT EXISTS repo_entity_relationships (
  id                  serial PRIMARY KEY,
  repo_id             integer NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_entity_id    integer NOT NULL REFERENCES repo_entities(id) ON DELETE CASCADE,
  target_entity_id    integer REFERENCES repo_entities(id) ON DELETE SET NULL,
  target_entity_name  text NOT NULL,
  relationship_type   text NOT NULL,
  source_field        text,
  target_field        text,
  metadata            jsonb,
  created_at          timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repo_entity_relationships_uniq
  ON repo_entity_relationships (repo_id, source_entity_id, target_entity_name, relationship_type);

CREATE INDEX IF NOT EXISTS repo_entity_relationships_repo_id_idx
  ON repo_entity_relationships (repo_id);

CREATE INDEX IF NOT EXISTS repo_entity_relationships_source_entity_id_idx
  ON repo_entity_relationships (source_entity_id);

CREATE INDEX IF NOT EXISTS repo_entity_relationships_target_entity_id_idx
  ON repo_entity_relationships (target_entity_id);
