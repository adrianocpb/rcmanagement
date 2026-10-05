/**
 * Migrations versionadas. Cada entrada é aplicada uma única vez, em ordem, e registrada em
 * schema_migrations. Para evoluir o banco, adicione uma nova entrada ao final — nunca altere
 * uma migration já aplicada.
 */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '001_initial',
    sql: `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE sectors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE statuses (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  color                TEXT    NOT NULL DEFAULT '#64748b',
  position             INTEGER NOT NULL DEFAULT 0,
  is_default           INTEGER NOT NULL DEFAULT 0, -- status sugerido para novas tarefas
  is_start_status      INTEGER NOT NULL DEFAULT 0, -- entrar nele preenche data de início real
  is_completion_status INTEGER NOT NULL DEFAULT 0, -- entrar nele preenche data de conclusão real
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);
CREATE INDEX idx_statuses_position ON statuses(position);

CREATE TABLE epics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  okr         TEXT,
  owner_id    INTEGER REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'planejado'
              CHECK (status IN ('planejado', 'em_andamento', 'concluido', 'cancelado')),
  start_date  TEXT,
  end_date    TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE outcomes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_id         INTEGER NOT NULL REFERENCES epics(id),
  name            TEXT    NOT NULL,
  description     TEXT,
  owner_id        INTEGER REFERENCES users(id),
  status          TEXT    NOT NULL DEFAULT 'planejado'
                  CHECK (status IN ('planejado', 'em_andamento', 'concluido', 'cancelado')),
  start_date      TEXT,
  target_date     TEXT,
  indicator_name  TEXT,
  indicator_unit  TEXT,
  baseline_value  REAL,
  target_value    REAL,
  current_value   REAL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX idx_outcomes_epic ON outcomes(epic_id);

CREATE TABLE tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT    NOT NULL,
  description         TEXT,
  notes               TEXT,
  sector_id           INTEGER NOT NULL REFERENCES sectors(id),
  requester_id        INTEGER NOT NULL REFERENCES users(id),
  assignee_id         INTEGER NOT NULL REFERENCES users(id),
  epic_id             INTEGER REFERENCES epics(id),
  outcome_id          INTEGER REFERENCES outcomes(id),
  status_id           INTEGER NOT NULL REFERENCES statuses(id),
  priority            TEXT    NOT NULL DEFAULT 'media'
                      CHECK (priority IN ('baixa', 'media', 'alta', 'urgente')),
  estimated_hours     REAL,
  planned_start_date  TEXT,              -- YYYY-MM-DD
  planned_end_date    TEXT,              -- YYYY-MM-DD
  started_at          TEXT,              -- instante UTC: data de início real
  completed_at        TEXT,              -- instante UTC: data de conclusão real
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT    NOT NULL,  -- instante UTC: data de criação (imutável)
  updated_at          TEXT    NOT NULL,
  deleted_at          TEXT               -- exclusão lógica
);
CREATE INDEX idx_tasks_status       ON tasks(status_id);
CREATE INDEX idx_tasks_assignee     ON tasks(assignee_id);
CREATE INDEX idx_tasks_requester    ON tasks(requester_id);
CREATE INDEX idx_tasks_sector       ON tasks(sector_id);
CREATE INDEX idx_tasks_epic         ON tasks(epic_id);
CREATE INDEX idx_tasks_outcome      ON tasks(outcome_id);
CREATE INDEX idx_tasks_created_at   ON tasks(created_at);
CREATE INDEX idx_tasks_completed_at ON tasks(completed_at);
CREATE INDEX idx_tasks_planned_end  ON tasks(planned_end_date);

CREATE TABLE task_status_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status_id INTEGER REFERENCES statuses(id), -- NULL = criação da tarefa
  to_status_id   INTEGER NOT NULL REFERENCES statuses(id),
  changed_by     INTEGER REFERENCES users(id),
  changed_at     TEXT    NOT NULL
);
CREATE INDEX idx_history_task      ON task_status_history(task_id, changed_at);
CREATE INDEX idx_history_to_status ON task_status_history(to_status_id, changed_at);
`,
  },
  {
    // Priorização ICE: Impacto, Confiança e Facilidade (1–10). O ICE score é calculado pelo próprio
    // banco (coluna gerada = impacto × confiança × facilidade) e fica nulo enquanto faltar algum fator.
    id: '002_ice_score',
    sql: `
ALTER TABLE tasks ADD COLUMN ice_impact     INTEGER CHECK (ice_impact BETWEEN 1 AND 10);
ALTER TABLE tasks ADD COLUMN ice_confidence INTEGER CHECK (ice_confidence BETWEEN 1 AND 10);
ALTER TABLE tasks ADD COLUMN ice_ease       INTEGER CHECK (ice_ease BETWEEN 1 AND 10);
ALTER TABLE tasks ADD COLUMN ice_score      INTEGER GENERATED ALWAYS AS (ice_impact * ice_confidence * ice_ease) VIRTUAL;

ALTER TABLE outcomes ADD COLUMN ice_impact     INTEGER CHECK (ice_impact BETWEEN 1 AND 10);
ALTER TABLE outcomes ADD COLUMN ice_confidence INTEGER CHECK (ice_confidence BETWEEN 1 AND 10);
ALTER TABLE outcomes ADD COLUMN ice_ease       INTEGER CHECK (ice_ease BETWEEN 1 AND 10);
ALTER TABLE outcomes ADD COLUMN ice_score      INTEGER GENERATED ALWAYS AS (ice_impact * ice_confidence * ice_ease) VIRTUAL;
`,
  },
];
