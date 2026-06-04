'use strict';
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new PgSession({ pool, tableName: 'dal_sessions' }),
  secret: process.env.SESSION_SECRET || 'day-and-life-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const auth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
const adminOnly = async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await pool.query('SELECT is_admin FROM dal_users WHERE id=$1', [req.session.userId]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
};

// ── Auth ──────────────────────────────────────────────────────────────
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, display_name, avatar_color, is_admin FROM dal_users WHERE id=$1',
    [req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const settings = await pool.query('SELECT * FROM dal_user_settings WHERE user_id=$1', [req.session.userId]);
  res.json({ user: rows[0], settings: settings.rows[0] || {} });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM dal_users WHERE username=$1', [username]);
  if (!rows[0]) return res.status(401).json({ error: '帳號或密碼錯誤' });
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: '帳號或密碼錯誤' });
  req.session.userId = rows[0].id;
  const settings = await pool.query('SELECT * FROM dal_user_settings WHERE user_id=$1', [rows[0].id]);
  res.json({
    user: { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, avatar_color: rows[0].avatar_color, is_admin: rows[0].is_admin },
    settings: settings.rows[0] || {}
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.patch('/api/me/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  const { rows } = await pool.query('SELECT password_hash FROM dal_users WHERE id=$1', [req.session.userId]);
  const ok = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!ok) return res.status(400).json({ error: '目前密碼錯誤' });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE dal_users SET password_hash=$1 WHERE id=$2', [hash, req.session.userId]);
  res.json({ ok: true });
});

// ── User Settings ─────────────────────────────────────────────────────
app.get('/api/settings', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dal_user_settings WHERE user_id=$1', [req.session.userId]);
  res.json(rows[0] || { theme_accent: '#2563eb', visible_calendar_ids: [] });
});

app.put('/api/settings', auth, async (req, res) => {
  const { theme_accent, visible_calendar_ids } = req.body;
  await pool.query(`
    INSERT INTO dal_user_settings(user_id, theme_accent, visible_calendar_ids)
    VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET theme_accent=$2, visible_calendar_ids=$3
  `, [req.session.userId, theme_accent, visible_calendar_ids]);
  res.json({ ok: true });
});

// ── Users (admin) ─────────────────────────────────────────────────────
app.get('/api/users', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, avatar_color, is_admin, created_at FROM dal_users ORDER BY id');
  res.json(rows);
});

app.post('/api/users', adminOnly, async (req, res) => {
  const { username, password, display_name, avatar_color, is_admin } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO dal_users(username,password_hash,display_name,avatar_color,is_admin) VALUES($1,$2,$3,$4,$5) RETURNING id,username,display_name,avatar_color,is_admin',
    [username, hash, display_name, avatar_color || '#2563eb', !!is_admin]
  );
  const newUser = rows[0];
  // auto-create a default calendar for the new user
  const cal = await pool.query(
    "INSERT INTO dal_calendars(name,color,owner_id) VALUES('我的行事曆',$1,$2) RETURNING id",
    [avatar_color || '#2563eb', newUser.id]
  );
  await pool.query('INSERT INTO dal_calendar_members(calendar_id,user_id,role) VALUES($1,$2,$3)',
    [cal.rows[0].id, newUser.id, 'admin']);
  res.json(newUser);
});

app.patch('/api/users/:id', adminOnly, async (req, res) => {
  const { display_name, avatar_color, is_admin, password } = req.body;
  const uid = parseInt(req.params.id);
  if (display_name !== undefined) await pool.query('UPDATE dal_users SET display_name=$1 WHERE id=$2', [display_name, uid]);
  if (avatar_color !== undefined) await pool.query('UPDATE dal_users SET avatar_color=$1 WHERE id=$2', [avatar_color, uid]);
  if (is_admin !== undefined) await pool.query('UPDATE dal_users SET is_admin=$1 WHERE id=$2', [!!is_admin, uid]);
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE dal_users SET password_hash=$1 WHERE id=$2', [hash, uid]);
  }
  const { rows } = await pool.query('SELECT id,username,display_name,avatar_color,is_admin FROM dal_users WHERE id=$1', [uid]);
  res.json(rows[0]);
});

app.delete('/api/users/:id', adminOnly, async (req, res) => {
  const uid = parseInt(req.params.id);
  if (uid === req.session.userId) return res.status(400).json({ error: '無法刪除自己' });
  await pool.query('DELETE FROM dal_users WHERE id=$1', [uid]);
  res.json({ ok: true });
});

// ── Calendars ─────────────────────────────────────────────────────────
app.get('/api/calendars', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.*, cm.role as my_role,
      (SELECT json_agg(json_build_object('user_id',cm2.user_id,'role',cm2.role,'display_name',u2.display_name,'avatar_color',u2.avatar_color))
       FROM dal_calendar_members cm2 JOIN dal_users u2 ON u2.id=cm2.user_id WHERE cm2.calendar_id=c.id) as members
    FROM dal_calendars c
    JOIN dal_calendar_members cm ON cm.calendar_id=c.id AND cm.user_id=$1
    ORDER BY c.id
  `, [req.session.userId]);
  res.json(rows);
});

app.post('/api/calendars', auth, async (req, res) => {
  const { name, color } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO dal_calendars(name,color,owner_id) VALUES($1,$2,$3) RETURNING *',
    [name, color || '#2563eb', req.session.userId]
  );
  await pool.query('INSERT INTO dal_calendar_members(calendar_id,user_id,role) VALUES($1,$2,$3)', [rows[0].id, req.session.userId, 'admin']);
  res.json(rows[0]);
});

app.patch('/api/calendars/:id', auth, async (req, res) => {
  const cid = parseInt(req.params.id);
  const { name, color } = req.body;
  const role = await pool.query('SELECT role FROM dal_calendar_members WHERE calendar_id=$1 AND user_id=$2', [cid, req.session.userId]);
  if (!role.rows[0] || role.rows[0].role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  if (name) await pool.query('UPDATE dal_calendars SET name=$1 WHERE id=$2', [name, cid]);
  if (color) await pool.query('UPDATE dal_calendars SET color=$1 WHERE id=$2', [color, cid]);
  const { rows } = await pool.query('SELECT * FROM dal_calendars WHERE id=$1', [cid]);
  res.json(rows[0]);
});

app.delete('/api/calendars/:id', auth, async (req, res) => {
  const cid = parseInt(req.params.id);
  const { rows } = await pool.query('SELECT owner_id FROM dal_calendars WHERE id=$1', [cid]);
  if (!rows[0] || rows[0].owner_id !== req.session.userId) return res.status(403).json({ error: '只有建立者可以刪除' });
  await pool.query('DELETE FROM dal_calendars WHERE id=$1', [cid]);
  res.json({ ok: true });
});

app.post('/api/calendars/:id/members', auth, async (req, res) => {
  const cid = parseInt(req.params.id);
  const { user_id, role } = req.body;
  const myRole = await pool.query('SELECT role FROM dal_calendar_members WHERE calendar_id=$1 AND user_id=$2', [cid, req.session.userId]);
  if (!myRole.rows[0] || myRole.rows[0].role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  await pool.query(
    'INSERT INTO dal_calendar_members(calendar_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [cid, user_id, role || 'member']
  );
  res.json({ ok: true });
});

app.delete('/api/calendars/:cid/members/:uid', auth, async (req, res) => {
  const cid = parseInt(req.params.cid);
  const uid = parseInt(req.params.uid);
  const myRole = await pool.query('SELECT role FROM dal_calendar_members WHERE calendar_id=$1 AND user_id=$2', [cid, req.session.userId]);
  if (!myRole.rows[0] || myRole.rows[0].role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  await pool.query('DELETE FROM dal_calendar_members WHERE calendar_id=$1 AND user_id=$2', [cid, uid]);
  res.json({ ok: true });
});

// ── Categories ────────────────────────────────────────────────────────
app.get('/api/categories', auth, async (req, res) => {
  const { calendar_id } = req.query;
  let q = `SELECT cat.* FROM dal_categories cat
    JOIN dal_calendar_members cm ON cm.calendar_id=cat.calendar_id AND cm.user_id=$1`;
  const params = [req.session.userId];
  if (calendar_id) { q += ' WHERE cat.calendar_id=$2'; params.push(parseInt(calendar_id)); }
  q += ' ORDER BY cat.calendar_id, cat.sort_order, cat.id';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

app.post('/api/categories', auth, async (req, res) => {
  const { calendar_id, name, color } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO dal_categories(calendar_id,name,color) VALUES($1,$2,$3) RETURNING *',
    [calendar_id, name, color || '#2563eb']
  );
  res.json(rows[0]);
});

app.patch('/api/categories/:id', auth, async (req, res) => {
  const { name, color } = req.body;
  const id = parseInt(req.params.id);
  if (name !== undefined) await pool.query('UPDATE dal_categories SET name=$1 WHERE id=$2', [name, id]);
  if (color !== undefined) await pool.query('UPDATE dal_categories SET color=$1 WHERE id=$2', [color, id]);
  const { rows } = await pool.query('SELECT * FROM dal_categories WHERE id=$1', [id]);
  res.json(rows[0]);
});

app.delete('/api/categories/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM dal_categories WHERE id=$1', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ── Tasks ─────────────────────────────────────────────────────────────
app.get('/api/inbox', auth, async (req, res) => {
  const { calendar_ids } = req.query;
  const ids = (calendar_ids || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.json([]);
  const { rows } = await pool.query(`
    SELECT t.*, cat.name as category_name, cat.color as category_color
    FROM dal_tasks t
    LEFT JOIN dal_categories cat ON cat.id=t.category_id
    WHERE t.calendar_id = ANY($1) AND t.date IS NULL
    ORDER BY t.sort_order, t.id
  `, [ids]);
  res.json(rows);
});

app.get('/api/tasks', auth, async (req, res) => {
  const { calendar_ids, date_from, date_to } = req.query;
  const ids = (calendar_ids || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.json([]);
  const { rows } = await pool.query(`
    SELECT t.*, cat.name as category_name, cat.color as category_color,
      u.display_name as assigned_name, u.avatar_color as assigned_color
    FROM dal_tasks t
    LEFT JOIN dal_categories cat ON cat.id=t.category_id
    LEFT JOIN dal_users u ON u.id=t.assigned_to
    WHERE t.calendar_id = ANY($1)
      AND t.date <= $3
      AND COALESCE(t.end_date, t.date) >= $2
    ORDER BY t.date, t.sort_order, t.id
  `, [ids, date_from, date_to]);
  res.json(rows);
});

app.post('/api/tasks', auth, async (req, res) => {
  const { calendar_id, category_id, title, date, end_date, time_hint, repeat_type, assigned_to, notes } = req.body;
  const { rows: orderRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order),0)+1 as next FROM dal_tasks WHERE calendar_id=$1 AND date IS NOT DISTINCT FROM $2',
    [calendar_id, date || null]
  );
  const { rows } = await pool.query(`
    INSERT INTO dal_tasks(calendar_id,created_by,assigned_to,category_id,title,date,end_date,time_hint,sort_order,repeat_type,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
  `, [calendar_id, req.session.userId, assigned_to || req.session.userId, category_id || null, title, date || null, end_date || null, time_hint || null, orderRows[0].next, repeat_type || 'none', notes || null]);
  const task = rows[0];
  if (task.category_id) {
    const cat = await pool.query('SELECT name,color FROM dal_categories WHERE id=$1', [task.category_id]);
    task.category_name = cat.rows[0]?.name;
    task.category_color = cat.rows[0]?.color;
  }
  res.json(task);
});

app.patch('/api/tasks/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, category_id, date, end_date, time_hint, completed, assigned_to, notes } = req.body;
  const { rows: cur } = await pool.query('SELECT * FROM dal_tasks WHERE id=$1', [id]);
  if (!cur[0]) return res.status(404).json({ error: 'Not found' });

  let moveCount = cur[0].move_count;
  if (date !== undefined && date !== cur[0].date) moveCount++;

  // $1=title $2=cat_id $3=cat_null $4=date $5=end_date $6=end_date_null $7=time_hint $8=completed $9=assigned_to $10=notes $11=notes_provided $12=moveCount $13=id
  await pool.query(`UPDATE dal_tasks SET
    title=COALESCE($1,title),
    category_id=CASE WHEN $2::int IS NULL AND $3 THEN NULL ELSE COALESCE($2::int,category_id) END,
    date=CASE WHEN $14=true THEN NULL ELSE COALESCE($4,date) END,
    end_date=CASE WHEN $6 THEN NULL ELSE COALESCE($5::date,end_date) END,
    time_hint=COALESCE($7,time_hint),
    completed=COALESCE($8,completed),
    completed_at=CASE WHEN $8=true THEN NOW() WHEN $8=false THEN NULL ELSE completed_at END,
    assigned_to=COALESCE($9,assigned_to),
    notes=CASE WHEN $11 THEN $10 ELSE notes END,
    move_count=$12,
    updated_at=NOW()
    WHERE id=$13`,
    [title, category_id, category_id === null, date || null, end_date || null, end_date === null && end_date !== undefined, time_hint, completed, assigned_to, notes || null, notes !== undefined, moveCount, id, date === null && date !== undefined]
  );

  const { rows } = await pool.query(`
    SELECT t.*, cat.name as category_name, cat.color as category_color
    FROM dal_tasks t LEFT JOIN dal_categories cat ON cat.id=t.category_id WHERE t.id=$1
  `, [id]);
  res.json(rows[0]);
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM dal_tasks WHERE id=$1', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// one-time migration: create default calendar for users who don't have one
app.post('/api/admin/fix-missing-calendars', auth, async (req, res) => {
  const { rows: ur } = await pool.query('SELECT is_admin FROM dal_users WHERE id=$1', [req.session.userId]);
  if (!ur[0]?.is_admin) return res.status(403).json({ error: 'admin only' });
  const { rows: users } = await pool.query(`
    SELECT u.id, u.display_name, u.avatar_color FROM dal_users u
    WHERE NOT EXISTS (SELECT 1 FROM dal_calendar_members cm WHERE cm.user_id=u.id)
  `);
  for (const u of users) {
    const cal = await pool.query(
      "INSERT INTO dal_calendars(name,color,owner_id) VALUES('我的行事曆',$1,$2) RETURNING id",
      [u.avatar_color || '#2563eb', u.id]
    );
    await pool.query('INSERT INTO dal_calendar_members(calendar_id,user_id,role) VALUES($1,$2,$3)',
      [cal.rows[0].id, u.id, 'admin']);
  }
  res.json({ fixed: users.length });
});

// one-time migration: fix task dates shifted by timezone bug (adds 1 day to all tasks)
app.post('/api/admin/fix-task-dates', auth, async (req, res) => {
  const { rows: ur } = await pool.query('SELECT is_admin FROM dal_users WHERE id=$1', [req.session.userId]);
  if (!ur[0]?.is_admin) return res.status(403).json({ error: 'admin only' });
  const { rows } = await pool.query(
    "UPDATE dal_tasks SET date = date + INTERVAL '1 day' RETURNING id"
  );
  res.json({ fixed: rows.length });
});

app.post('/api/tasks/reorder', auth, async (req, res) => {
  const { ordered_ids } = req.body;
  for (let i = 0; i < ordered_ids.length; i++) {
    await pool.query('UPDATE dal_tasks SET sort_order=$1 WHERE id=$2', [i, ordered_ids[i]]);
  }
  res.json({ ok: true });
});

// ── Daily Notes ───────────────────────────────────────────────────────
app.get('/api/notes', auth, async (req, res) => {
  const { calendar_id, date_from, date_to } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM dal_daily_notes WHERE calendar_id=$1 AND date BETWEEN $2 AND $3',
    [calendar_id, date_from, date_to]
  );
  res.json(rows);
});

app.put('/api/notes', auth, async (req, res) => {
  const { calendar_id, date, content } = req.body;
  await pool.query(`
    INSERT INTO dal_daily_notes(calendar_id,date,content) VALUES($1,$2,$3)
    ON CONFLICT(calendar_id,date) DO UPDATE SET content=$3, updated_at=NOW()
  `, [calendar_id, date, content]);
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  const { calendar_ids, year, month } = req.query;
  const ids = (calendar_ids || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.json([]);
  const dateFrom = `${year}-${String(month).padStart(2,'0')}-01`;
  const dateTo = new Date(year, month, 0).toISOString().slice(0, 10);

  const { rows } = await pool.query(`
    SELECT
      COALESCE(cat.name,'未分類') as category_name,
      COALESCE(cat.color,'#9e9e99') as category_color,
      COUNT(*) as total,
      COUNT(*) FILTER(WHERE t.completed) as completed,
      AVG(t.move_count) as avg_moves
    FROM dal_tasks t
    LEFT JOIN dal_categories cat ON cat.id=t.category_id
    WHERE t.calendar_id = ANY($1) AND t.date BETWEEN $2 AND $3
    GROUP BY cat.name, cat.color
    ORDER BY total DESC
  `, [ids, dateFrom, dateTo]);
  res.json(rows);
});

// ── Init DB & Start ───────────────────────────────────────────────────
async function initDb() {
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  // ensure dal_sessions exists (connect-pg-simple schema)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dal_sessions (
      sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS IDX_dal_sessions_expire ON dal_sessions(expire)`);
  // migrations
  await pool.query(`ALTER TABLE dal_tasks ADD COLUMN IF NOT EXISTS end_date DATE`);
  await pool.query(`ALTER TABLE dal_tasks ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE dal_tasks ALTER COLUMN date DROP NOT NULL`);

  const { rows } = await pool.query('SELECT COUNT(*) FROM dal_users');
  if (rows[0].count === '0') {
    const hash = await bcrypt.hash('admin1234', 10);
    const u = await pool.query(
      "INSERT INTO dal_users(username,password_hash,display_name,avatar_color,is_admin) VALUES('admin',$1,'管理員','#2563eb',true) RETURNING id",
      [hash]
    );
    const cal = await pool.query(
      "INSERT INTO dal_calendars(name,color,owner_id) VALUES('工作','#2563eb',$1) RETURNING id",
      [u.rows[0].id]
    );
    await pool.query('INSERT INTO dal_calendar_members(calendar_id,user_id,role) VALUES($1,$2,$3)', [cal.rows[0].id, u.rows[0].id, 'admin']);
    await pool.query('INSERT INTO dal_categories(calendar_id,name,color) VALUES($1,$2,$3),($1,$4,$5),($1,$6,$7)',
      [cal.rows[0].id, '會議', '#7c3aed', '內容製作', '#16a34a', '行政事務', '#ea580c']);
    console.log('✅ 初始帳號 admin / admin1234 已建立');
  }
}

const PORT = process.env.PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => console.log(`🚀 Day and Life 啟動於 http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
