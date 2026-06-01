-- Day and Life Schema（前綴 dal_ 避免與同資料庫其他 app 衝突）

CREATE TABLE IF NOT EXISTS dal_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  avatar_color VARCHAR(20) DEFAULT '#2563eb',
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dal_calendars (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#2563eb',
  owner_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dal_calendar_members (
  calendar_id INTEGER REFERENCES dal_calendars(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',
  PRIMARY KEY (calendar_id, user_id)
);

CREATE TABLE IF NOT EXISTS dal_categories (
  id SERIAL PRIMARY KEY,
  calendar_id INTEGER REFERENCES dal_calendars(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#2563eb',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dal_tasks (
  id SERIAL PRIMARY KEY,
  calendar_id INTEGER REFERENCES dal_calendars(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES dal_users(id),
  assigned_to INTEGER REFERENCES dal_users(id),
  category_id INTEGER REFERENCES dal_categories(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  date DATE NOT NULL,
  time_hint VARCHAR(10),
  sort_order INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  repeat_type VARCHAR(20) DEFAULT 'none',
  move_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dal_daily_notes (
  id SERIAL PRIMARY KEY,
  calendar_id INTEGER REFERENCES dal_calendars(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  content TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(calendar_id, date)
);

CREATE TABLE IF NOT EXISTS dal_user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES dal_users(id) ON DELETE CASCADE,
  theme_accent VARCHAR(20) DEFAULT '#2563eb',
  visible_calendar_ids INTEGER[] DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS dal_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS dal_sessions_expire_idx ON dal_sessions(expire);
