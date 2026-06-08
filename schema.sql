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

-- 藥品主檔（共用，越用越完整）
CREATE TABLE IF NOT EXISTS dal_drug_master (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  dosage VARCHAR(100),
  unit VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dal_drug_master_name_idx ON dal_drug_master(name);

-- 個人處方籤
CREATE TABLE IF NOT EXISTS dal_prescriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  drug_name VARCHAR(200) NOT NULL,
  dosage VARCHAR(100),
  category_code VARCHAR(50) NOT NULL,
  category_detail VARCHAR(200),
  frequency TEXT[] DEFAULT '{}',
  refill_date DATE,
  start_date DATE,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dal_prescriptions_user_idx ON dal_prescriptions(user_id);

-- 每日服藥紀錄
CREATE TABLE IF NOT EXISTS dal_medication_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  prescription_id INTEGER REFERENCES dal_prescriptions(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  taken BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, prescription_id, log_date)
);
CREATE INDEX IF NOT EXISTS dal_medication_logs_user_date_idx ON dal_medication_logs(user_id, log_date);

-- 血壓記錄
CREATE TABLE IF NOT EXISTS dal_bp_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  systolic INTEGER NOT NULL,
  diastolic INTEGER NOT NULL,
  pulse INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dal_bp_records_user_time_idx ON dal_bp_records(user_id, measured_at DESC);

-- 血壓分享（owner 分享給 viewer，唯讀）
CREATE TABLE IF NOT EXISTS dal_bp_shares (
  owner_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  viewer_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_id, viewer_id)
);
