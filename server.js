'use strict';
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const pg = require('pg');
const { Pool } = pg;
const path = require('path');

// Return DATE columns as plain strings (e.g. "2026-07-31") to avoid timezone shift
pg.types.setTypeParser(1082, val => val);

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
    'SELECT id, username, display_name, avatar_color, is_admin, can_invite FROM dal_users WHERE id=$1',
    [req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const settings = await pool.query('SELECT * FROM dal_user_settings WHERE user_id=$1', [req.session.userId]);
  res.json({ user: rows[0], settings: settings.rows[0] || {} });
});

// login rate limiting: max 10 attempts per IP per 15 minutes
const loginAttempts = new Map();
function checkLoginLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count <= 10;
}

app.post('/api/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkLoginLimit(ip)) return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM dal_users WHERE username=$1', [username]);
  if (!rows[0]) return res.status(401).json({ error: '帳號或密碼錯誤' });
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: '帳號或密碼錯誤' });
  req.session.userId = rows[0].id;
  const settings = await pool.query('SELECT * FROM dal_user_settings WHERE user_id=$1', [rows[0].id]);
  res.json({
    user: { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, avatar_color: rows[0].avatar_color, is_admin: rows[0].is_admin, can_invite: rows[0].can_invite },
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

// ── Users ─────────────────────────────────────────────────────────────
const canInviteMiddleware = async (req, res, next) => {
  const { rows } = await pool.query('SELECT is_admin, can_invite FROM dal_users WHERE id=$1', [req.session.userId]);
  if (!rows[0] || (!rows[0].is_admin && !rows[0].can_invite)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// admins see all users; can_invite users see only accounts they created
app.get('/api/users', auth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT is_admin, can_invite FROM dal_users WHERE id=$1', [req.session.userId]);
  if (me[0]?.is_admin) {
    const { rows } = await pool.query('SELECT id, username, display_name, avatar_color, is_admin, can_invite, created_by, created_at FROM dal_users ORDER BY id');
    return res.json(rows);
  }
  if (me[0]?.can_invite) {
    const { rows } = await pool.query('SELECT id, username, display_name, avatar_color, is_admin, can_invite, created_by, created_at FROM dal_users WHERE created_by=$1 ORDER BY id', [req.session.userId]);
    return res.json(rows);
  }
  res.json([]);
});

app.post('/api/users', canInviteMiddleware, async (req, res) => {
  const { rows: me } = await pool.query('SELECT is_admin FROM dal_users WHERE id=$1', [req.session.userId]);
  const { username, password, display_name, avatar_color, is_admin } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO dal_users(username,password_hash,display_name,avatar_color,is_admin,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,display_name,avatar_color,is_admin,can_invite',
    [username, hash, display_name, avatar_color || '#2563eb', me[0].is_admin ? !!is_admin : false, req.session.userId]
  );
  const newUser = rows[0];
  const cal = await pool.query(
    "INSERT INTO dal_calendars(name,color,owner_id) VALUES('我的行事曆',$1,$2) RETURNING id",
    [avatar_color || '#2563eb', newUser.id]
  );
  await pool.query('INSERT INTO dal_calendar_members(calendar_id,user_id,role) VALUES($1,$2,$3)',
    [cal.rows[0].id, newUser.id, 'admin']);
  res.json(newUser);
});

app.patch('/api/users/:id', auth, async (req, res) => {
  const uid = parseInt(req.params.id);
  const { rows: me } = await pool.query('SELECT is_admin FROM dal_users WHERE id=$1', [req.session.userId]);
  const { rows: target } = await pool.query('SELECT created_by FROM dal_users WHERE id=$1', [uid]);
  if (!target[0]) return res.status(404).json({ error: 'Not found' });
  // admin can edit anyone; can_invite can only edit their own created users
  const isAdmin = me[0]?.is_admin;
  const isOwner = target[0].created_by === req.session.userId;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Forbidden' });

  const { display_name, avatar_color, is_admin, can_invite, password } = req.body;
  if (display_name !== undefined) await pool.query('UPDATE dal_users SET display_name=$1 WHERE id=$2', [display_name, uid]);
  if (avatar_color !== undefined) await pool.query('UPDATE dal_users SET avatar_color=$1 WHERE id=$2', [avatar_color, uid]);
  if (isAdmin && is_admin !== undefined) await pool.query('UPDATE dal_users SET is_admin=$1 WHERE id=$2', [!!is_admin, uid]);
  if (isAdmin && can_invite !== undefined) await pool.query('UPDATE dal_users SET can_invite=$1 WHERE id=$2', [!!can_invite, uid]);
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE dal_users SET password_hash=$1 WHERE id=$2', [hash, uid]);
  }
  const { rows } = await pool.query('SELECT id,username,display_name,avatar_color,is_admin,can_invite FROM dal_users WHERE id=$1', [uid]);
  res.json(rows[0]);
});

app.delete('/api/users/:id', auth, async (req, res) => {
  const uid = parseInt(req.params.id);
  if (uid === req.session.userId) return res.status(400).json({ error: '無法刪除自己' });
  const { rows: me } = await pool.query('SELECT is_admin FROM dal_users WHERE id=$1', [req.session.userId]);
  const { rows: target } = await pool.query('SELECT created_by FROM dal_users WHERE id=$1', [uid]);
  if (!target[0]) return res.status(404).json({ error: 'Not found' });
  if (!me[0]?.is_admin && target[0].created_by !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
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
      u.display_name as assigned_name, u.avatar_color as assigned_color,
      (SELECT array_agg(tc.date::text) FROM dal_task_completions tc WHERE tc.task_id=t.id) as completed_dates
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

function nextRepeatDate(d, repeatType) {
  const date = new Date(d);
  if (repeatType === 'daily')    date.setDate(date.getDate() + 1);
  if (repeatType === 'weekly')   date.setDate(date.getDate() + 7);
  if (repeatType === 'biweekly') date.setDate(date.getDate() + 14);
  if (repeatType === 'monthly')  date.setMonth(date.getMonth() + 1);
  return date;
}

app.post('/api/tasks', auth, async (req, res) => {
  const { calendar_id, category_id, title, date, end_date, time_hint, repeat_type, repeat_until, assigned_to, notes } = req.body;
  if (!calendar_id || !title) return res.status(400).json({ error: '缺少必填欄位' });
  try {
    const { rows: orderRows } = await pool.query(
      'SELECT COALESCE(MAX(sort_order),0)+1 as next FROM dal_tasks WHERE calendar_id=$1 AND date IS NOT DISTINCT FROM $2',
      [calendar_id, date || null]
    );
    const { rows } = await pool.query(`
      INSERT INTO dal_tasks(calendar_id,created_by,assigned_to,category_id,title,date,end_date,time_hint,sort_order,repeat_type,repeat_until,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [calendar_id, req.session.userId, assigned_to || req.session.userId, category_id || null, title, date || null, end_date || null, time_hint || null, orderRows[0].next, repeat_type || 'none', repeat_until || null, notes || null]);
    const task = rows[0];

    // auto-generate repeat instances
    if (repeat_type && repeat_type !== 'none' && repeat_until && date) {
      const groupId = task.id;
      await pool.query('UPDATE dal_tasks SET repeat_group_id=$1 WHERE id=$1', [groupId]);
      let cur = nextRepeatDate(date, repeat_type);
      const until = new Date(repeat_until);
      while (cur <= until) {
        const ds = cur.toISOString().slice(0,10);
        await pool.query(`
          INSERT INTO dal_tasks(calendar_id,created_by,assigned_to,category_id,title,date,time_hint,sort_order,repeat_type,repeat_until,repeat_group_id,notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [calendar_id, req.session.userId, assigned_to || req.session.userId, category_id || null, title, ds, time_hint || null, 0, repeat_type, repeat_until, groupId, notes || null]);
        cur = nextRepeatDate(cur, repeat_type);
      }
    }

    if (task.category_id) {
      const cat = await pool.query('SELECT name,color FROM dal_categories WHERE id=$1', [task.category_id]);
      task.category_name = cat.rows[0]?.name;
      task.category_color = cat.rows[0]?.color;
    }
    res.json(task);
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    res.status(500).json({ error: '新增任務失敗：' + err.message });
  }
});

app.post('/api/tasks/:id/completion', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { date, completed } = req.body;
  if (!date) return res.status(400).json({ error: '缺少日期' });
  if (completed) {
    await pool.query('INSERT INTO dal_task_completions(task_id,date) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, date]);
  } else {
    await pool.query('DELETE FROM dal_task_completions WHERE task_id=$1 AND date=$2', [id, date]);
  }
  res.json({ ok: true });
});

app.patch('/api/tasks/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, category_id, date, end_date, time_hint, completed, assigned_to, notes, repeat_type, repeat_until, generate_series } = req.body;
  const { rows: cur } = await pool.query('SELECT * FROM dal_tasks WHERE id=$1', [id]);
  if (!cur[0]) return res.status(404).json({ error: 'Not found' });

  let moveCount = cur[0].move_count;
  if (date !== undefined && date !== cur[0].date) moveCount++;

  await pool.query(`UPDATE dal_tasks SET
    title=COALESCE($1,title),
    category_id=CASE WHEN $2::int IS NULL AND $3 THEN NULL ELSE COALESCE($2::int,category_id) END,
    date=CASE WHEN $14=true THEN NULL ELSE COALESCE($4,"date") END,
    end_date=CASE WHEN $6 THEN NULL ELSE COALESCE($5::date,end_date) END,
    time_hint=COALESCE($7,time_hint),
    completed=COALESCE($8,completed),
    completed_at=CASE WHEN $8=true THEN NOW() WHEN $8=false THEN NULL ELSE completed_at END,
    assigned_to=COALESCE($9,assigned_to),
    notes=CASE WHEN $11 THEN $10 ELSE notes END,
    move_count=$12,
    repeat_type=COALESCE($15,repeat_type),
    repeat_until=COALESCE($16::date,repeat_until),
    updated_at=NOW()
    WHERE id=$13`,
    [title, category_id, category_id === null, date || null, end_date || null, end_date === null && end_date !== undefined, time_hint, completed, assigned_to, notes || null, notes !== undefined, moveCount, id, date === null && date !== undefined, repeat_type || null, repeat_until || null]
  );

  // if generate_series=true, rebuild all future instances from this task's date
  if (generate_series && repeat_type && repeat_type !== 'none' && repeat_until) {
    const taskDate = date || cur[0].date;
    const groupId = cur[0].repeat_group_id || id;
    // delete old future instances (keep this one)
    if (cur[0].repeat_group_id) {
      await pool.query('DELETE FROM dal_tasks WHERE repeat_group_id=$1 AND id!=$2', [groupId, id]);
    }
    await pool.query('UPDATE dal_tasks SET repeat_group_id=$1 WHERE id=$2', [groupId, id]);
    let curDate = nextRepeatDate(taskDate, repeat_type);
    const until = new Date(repeat_until);
    while (curDate <= until) {
      const ds = curDate.toISOString().slice(0,10);
      await pool.query(`INSERT INTO dal_tasks(calendar_id,created_by,assigned_to,category_id,title,date,time_hint,sort_order,repeat_type,repeat_until,repeat_group_id,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [cur[0].calendar_id, req.session.userId, cur[0].assigned_to, category_id ?? cur[0].category_id, title || cur[0].title, ds, time_hint ?? cur[0].time_hint, 0, repeat_type, repeat_until, groupId, notes ?? cur[0].notes]);
      curDate = nextRepeatDate(curDate, repeat_type);
    }
  }

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

// delete entire repeat group
app.delete('/api/tasks/group/:groupId', auth, async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { rowCount } = await pool.query('DELETE FROM dal_tasks WHERE repeat_group_id=$1', [groupId]);
  res.json({ deleted: rowCount });
});

// update entire repeat group (title, category, time_hint, notes only — not date)
app.patch('/api/tasks/group/:groupId', auth, async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const { title, category_id, time_hint, notes } = req.body;
  await pool.query(`UPDATE dal_tasks SET
    title=COALESCE($1,title),
    category_id=CASE WHEN $2::int IS NULL AND $3 THEN NULL ELSE COALESCE($2::int,category_id) END,
    time_hint=COALESCE($4,time_hint),
    notes=CASE WHEN $5 THEN $6 ELSE notes END,
    updated_at=NOW()
    WHERE repeat_group_id=$7`,
    [title, category_id, category_id === null, time_hint, notes !== undefined, notes || null, groupId]
  );
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

// ── Task Search ───────────────────────────────────────────────────────
app.get('/api/tasks/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  const { rows: calRows } = await pool.query(
    'SELECT calendar_id FROM dal_calendar_members WHERE user_id=$1', [req.session.userId]
  );
  const calIds = calRows.map(r => r.calendar_id);
  if (!calIds.length) return res.json([]);
  const { rows } = await pool.query(`
    SELECT t.id, t.title, t.date, t.completed, cat.name as category_name
    FROM dal_tasks t
    LEFT JOIN dal_categories cat ON cat.id = t.category_id
    WHERE t.calendar_id = ANY($1) AND t.title ILIKE $2
    ORDER BY t.date DESC NULLS LAST, t.id DESC
    LIMIT 20
  `, [calIds, `%${q.trim()}%`]);
  res.json(rows);
});

// ── Projects ──────────────────────────────────────────────────────────
app.get('/api/projects', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM dal_projects WHERE user_id=$1 AND archived=false ORDER BY sort_order, id',
    [req.session.userId]
  );
  res.json(rows);
});

app.post('/api/projects', auth, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: '缺少名稱' });
  const { rows: orderRows } = await pool.query('SELECT COALESCE(MAX(sort_order),0)+1 as next FROM dal_projects WHERE user_id=$1', [req.session.userId]);
  const { rows } = await pool.query(
    'INSERT INTO dal_projects(user_id,name,color,sort_order) VALUES($1,$2,$3,$4) RETURNING *',
    [req.session.userId, name, color || '#2563eb', orderRows[0].next]
  );
  res.json(rows[0]);
});

app.patch('/api/projects/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, color, archived } = req.body;
  const { rows: check } = await pool.query('SELECT user_id FROM dal_projects WHERE id=$1', [id]);
  if (!check[0] || check[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  if (name !== undefined) await pool.query('UPDATE dal_projects SET name=$1 WHERE id=$2', [name, id]);
  if (color !== undefined) await pool.query('UPDATE dal_projects SET color=$1 WHERE id=$2', [color, id]);
  if (archived !== undefined) await pool.query('UPDATE dal_projects SET archived=$1 WHERE id=$2', [archived, id]);
  const { rows } = await pool.query('SELECT * FROM dal_projects WHERE id=$1', [id]);
  res.json(rows[0]);
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows: check } = await pool.query('SELECT user_id FROM dal_projects WHERE id=$1', [id]);
  if (!check[0] || check[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  await pool.query('DELETE FROM dal_projects WHERE id=$1', [id]);
  res.json({ ok: true });
});

// ── Milestones ────────────────────────────────────────────────────────
app.get('/api/projects/:id/milestones', auth, async (req, res) => {
  const pid = parseInt(req.params.id);
  const { rows: check } = await pool.query('SELECT user_id FROM dal_projects WHERE id=$1', [pid]);
  if (!check[0] || check[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(`
    SELECT m.id, m.project_id, m.title, m.due_date::text as due_date, m.status,
           m.remind_days_before, m.linked_task_id, m.sort_order, m.created_at,
           t.title as linked_task_title, t.completed as linked_task_done
    FROM dal_milestones m
    LEFT JOIN dal_tasks t ON t.id = m.linked_task_id
    WHERE m.project_id=$1
    ORDER BY m.sort_order, m.due_date NULLS LAST, m.id
  `, [pid]);
  res.json(rows);
});

app.post('/api/milestones', auth, async (req, res) => {
  const { project_id, title, due_date, status, remind_days_before, linked_task_id } = req.body;
  if (!project_id || !title) return res.status(400).json({ error: '缺少必填欄位' });
  const { rows: check } = await pool.query('SELECT user_id FROM dal_projects WHERE id=$1', [project_id]);
  if (!check[0] || check[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  const { rows: orderRows } = await pool.query('SELECT COALESCE(MAX(sort_order),0)+1 as next FROM dal_milestones WHERE project_id=$1', [project_id]);
  const { rows } = await pool.query(
    'INSERT INTO dal_milestones(project_id,title,due_date,status,remind_days_before,linked_task_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [project_id, title, due_date || null, status || 'pending', remind_days_before ?? 3, linked_task_id || null, orderRows[0].next]
  );
  res.json(rows[0]);
});

app.patch('/api/milestones/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, due_date, status, remind_days_before, linked_task_id } = req.body;
  const { rows: check } = await pool.query(`
    SELECT p.user_id FROM dal_milestones m JOIN dal_projects p ON p.id=m.project_id WHERE m.id=$1
  `, [id]);
  if (!check[0] || check[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  if (title !== undefined) await pool.query('UPDATE dal_milestones SET title=$1 WHERE id=$2', [title, id]);
  if (due_date !== undefined) await pool.query('UPDATE dal_milestones SET due_date=$1 WHERE id=$2', [due_date || null, id]);
  if (status !== undefined) await pool.query('UPDATE dal_milestones SET status=$1 WHERE id=$2', [status, id]);
  if (remind_days_before !== undefined) await pool.query('UPDATE dal_milestones SET remind_days_before=$1 WHERE id=$2', [remind_days_before, id]);
  if ('linked_task_id' in req.body) await pool.query('UPDATE dal_milestones SET linked_task_id=$1 WHERE id=$2', [linked_task_id || null, id]);
  const { rows } = await pool.query(`
    SELECT m.id, m.project_id, m.title, m.due_date::text as due_date, m.status,
           m.remind_days_before, m.linked_task_id, m.sort_order, m.created_at,
           t.title as linked_task_title, t.completed as linked_task_done
    FROM dal_milestones m LEFT JOIN dal_tasks t ON t.id=m.linked_task_id WHERE m.id=$1
  `, [id]);
  res.json(rows[0]);
});

app.delete('/api/milestones/:id', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows: check } = await pool.query(`
    SELECT p.user_id FROM dal_milestones m JOIN dal_projects p ON p.id=m.project_id WHERE m.id=$1
  `, [id]);
  if (!check[0] || check[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  await pool.query('DELETE FROM dal_milestones WHERE id=$1', [id]);
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

// ── Drug Master ───────────────────────────────────────────────────────

app.get('/api/drugs', auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  const { rows } = await pool.query(
    `SELECT id, name, dosage, unit FROM dal_drug_master
     WHERE name ILIKE $1 ORDER BY name LIMIT 20`,
    [`%${q.trim()}%`]
  );
  res.json(rows);
});

app.post('/api/drugs', auth, async (req, res) => {
  const { name, dosage, unit } = req.body;
  if (!name) return res.status(400).json({ error: '缺少藥名' });
  const existing = await pool.query('SELECT id FROM dal_drug_master WHERE name=$1 AND dosage=$2', [name, dosage || null]);
  if (existing.rows.length) return res.json(existing.rows[0]);
  const { rows } = await pool.query(
    'INSERT INTO dal_drug_master(name,dosage,unit) VALUES($1,$2,$3) RETURNING *',
    [name, dosage || null, unit || null]
  );
  res.json(rows[0]);
});

// ── Prescriptions ─────────────────────────────────────────────────────

app.get('/api/prescriptions', auth, async (req, res) => {
  const uid = req.session.userId;
  const { active } = req.query;
  let q = 'SELECT * FROM dal_prescriptions WHERE user_id=$1';
  if (active === '1') q += ' AND is_active=true';
  q += ' ORDER BY is_active DESC, refill_date ASC NULLS LAST, created_at DESC';
  const { rows } = await pool.query(q, [uid]);
  res.json(rows);
});

app.post('/api/prescriptions', auth, async (req, res) => {
  const uid = req.session.userId;
  const { drug_name, dosage, category_code, category_detail, frequency, recurrence, refill_date, start_date, end_date, notes } = req.body;
  if (!drug_name || !category_code) return res.status(400).json({ error: '缺少必填欄位' });
  await pool.query(
    'INSERT INTO dal_drug_master(name,dosage) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [drug_name, dosage || null]
  );
  const { rows } = await pool.query(
    `INSERT INTO dal_prescriptions(user_id,drug_name,dosage,category_code,category_detail,frequency,recurrence,refill_date,start_date,end_date,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [uid, drug_name, dosage || null, category_code, category_detail || null,
     frequency || [], recurrence || 'daily', refill_date || null, start_date || null, end_date || null, notes || null]
  );
  res.json(rows[0]);
});

app.put('/api/prescriptions/:id', auth, async (req, res) => {
  const uid = req.session.userId;
  const { drug_name, dosage, category_code, category_detail, frequency, recurrence, refill_date, start_date, end_date, notes, is_active } = req.body;
  const { rows } = await pool.query(
    `UPDATE dal_prescriptions SET drug_name=$1,dosage=$2,category_code=$3,category_detail=$4,
     frequency=$5,recurrence=$6,refill_date=$7,start_date=$8,end_date=$9,notes=$10,is_active=$11
     WHERE id=$12 AND user_id=$13 RETURNING *`,
    [drug_name, dosage || null, category_code, category_detail || null,
     frequency || [], recurrence || 'daily', refill_date || null, start_date || null, end_date || null,
     notes || null, is_active ?? true, req.params.id, uid]
  );
  if (!rows.length) return res.status(404).json({ error: '找不到' });
  res.json(rows[0]);
});

app.delete('/api/prescriptions/:id', auth, async (req, res) => {
  const uid = req.session.userId;
  await pool.query('DELETE FROM dal_prescriptions WHERE id=$1 AND user_id=$2', [req.params.id, uid]);
  res.json({ ok: true });
});

// ── Medication Logs ───────────────────────────────────────────────────

app.get('/api/medication-logs', auth, async (req, res) => {
  const uid = req.session.userId;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: '缺少日期' });
  // 處方籤紀錄
  const { rows: rxRows } = await pool.query(`
    SELECT p.id as prescription_id, p.drug_name, p.dosage, p.frequency, p.recurrence,
           p.category_code, p.category_detail,
           ml.taken, ml.id as log_id, false as is_manual
    FROM dal_prescriptions p
    LEFT JOIN dal_medication_logs ml ON ml.prescription_id=p.id AND ml.log_date=$2 AND ml.user_id=$1 AND ml.is_manual=false
    WHERE p.user_id=$1 AND p.is_active=true
      AND (p.start_date IS NULL OR p.start_date <= $2)
      AND (p.end_date IS NULL OR p.end_date >= $2)
    ORDER BY p.created_at
  `, [uid, date]);
  // 手動紀錄
  const { rows: manualRows } = await pool.query(`
    SELECT id, null as prescription_id, manual_drug_name as drug_name, manual_dosage as dosage,
           manual_note, manual_time, log_date, true as taken, true as is_manual
    FROM dal_medication_logs
    WHERE user_id=$1 AND log_date=$2 AND is_manual=true
    ORDER BY id
  `, [uid, date]);
  res.json([...rxRows, ...manualRows]);
});

// 手動紀錄臨時用藥
app.post('/api/medication-logs/manual', auth, async (req, res) => {
  const uid = req.session.userId;
  const { log_date, manual_drug_name, manual_dosage, manual_note, manual_time } = req.body;
  if (!log_date || !manual_drug_name) return res.status(400).json({ error: '缺少必填欄位' });
  const { rows } = await pool.query(
    `INSERT INTO dal_medication_logs(user_id, log_date, taken, is_manual, manual_drug_name, manual_dosage, manual_note, manual_time)
     VALUES($1,$2,true,true,$3,$4,$5,$6) RETURNING *`,
    [uid, log_date, manual_drug_name, manual_dosage || null, manual_note || null, manual_time || null]
  );
  res.json(rows[0]);
});

app.delete('/api/medication-logs/manual/:id', auth, async (req, res) => {
  const uid = req.session.userId;
  await pool.query('DELETE FROM dal_medication_logs WHERE id=$1 AND user_id=$2 AND is_manual=true', [req.params.id, uid]);
  res.json({ ok: true });
});

// 查詢用藥歷史（給歷史頁面用，含每天吃了沒）
app.get('/api/medication-logs/history', auth, async (req, res) => {
  const uid = req.session.userId;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: '缺少日期' });

  // 取得該區間內所有 active 處方，以及它們的服藥紀錄
  const { rows: rxRows } = await pool.query(`
    SELECT
      ml.log_date, ml.taken, ml.is_manual,
      p.drug_name, p.dosage, p.frequency, p.recurrence,
      p.id as prescription_id
    FROM dal_prescriptions p
    CROSS JOIN (
      SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS log_date
    ) dates
    LEFT JOIN dal_medication_logs ml
      ON ml.prescription_id = p.id AND ml.log_date = dates.log_date
      AND ml.user_id = $1 AND ml.is_manual = false
    WHERE p.user_id = $1
      AND (p.start_date IS NULL OR p.start_date <= dates.log_date)
      AND (p.end_date IS NULL OR p.end_date >= dates.log_date)
    ORDER BY dates.log_date, p.created_at
  `, [uid, from, to]);

  // 手動紀錄
  const { rows: manualRows } = await pool.query(`
    SELECT log_date, true as taken, true as is_manual,
           manual_drug_name as drug_name, manual_dosage as dosage,
           manual_note, manual_time, id
    FROM dal_medication_logs
    WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 AND is_manual = true
    ORDER BY log_date, id
  `, [uid, from, to]);

  res.json({ prescriptions: rxRows, manual: manualRows });
});

// 查詢某日期區間的服藥紀錄（給行事曆視圖用）
app.get('/api/medication-logs/range', auth, async (req, res) => {
  const uid = req.session.userId;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: '缺少日期' });
  const { rows } = await pool.query(`
    SELECT p.id as prescription_id, p.drug_name, p.dosage, p.frequency,
           ml.log_date, ml.taken
    FROM dal_prescriptions p
    LEFT JOIN dal_medication_logs ml
      ON ml.prescription_id=p.id AND ml.user_id=$1 AND ml.log_date BETWEEN $2 AND $3
    WHERE p.user_id=$1 AND (
      (p.is_active=true AND (p.start_date IS NULL OR p.start_date <= $3) AND (p.end_date IS NULL OR p.end_date >= $2))
      OR
      EXISTS (SELECT 1 FROM dal_medication_logs ml2 WHERE ml2.prescription_id=p.id AND ml2.user_id=$1 AND ml2.log_date BETWEEN $2 AND $3)
    )
    ORDER BY p.created_at, ml.log_date
  `, [uid, from, to]);
  res.json(rows);
});

app.post('/api/medication-logs', auth, async (req, res) => {
  const uid = req.session.userId;
  const { prescription_id, log_date, taken } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO dal_medication_logs(user_id,prescription_id,log_date,taken)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(user_id,prescription_id,log_date) DO UPDATE SET taken=$4
     RETURNING *`,
    [uid, prescription_id, log_date, taken]
  );
  res.json(rows[0]);
});

// ── Blood Pressure ────────────────────────────────────────────────────

// 取得自己（或被分享給自己的人）的血壓記錄
app.get('/api/bp', auth, async (req, res) => {
  const uid = req.session.userId;
  const { from, to, owner_id } = req.query;
  // 如果指定 owner_id，先確認有分享權限
  let targetId = uid;
  if (owner_id && Number(owner_id) !== uid) {
    const { rows } = await pool.query(
      'SELECT 1 FROM dal_bp_shares WHERE owner_id=$1 AND viewer_id=$2',
      [Number(owner_id), uid]
    );
    if (!rows.length) return res.status(403).json({ error: '無存取權限' });
    targetId = Number(owner_id);
  }
  const conditions = ['user_id=$1'];
  const params = [targetId];
  if (from) { params.push(from); conditions.push(`measured_at >= $${params.length}`); }
  if (to)   { params.push(to);   conditions.push(`measured_at <= $${params.length}::date + interval '1 day'`); }
  const { rows } = await pool.query(
    `SELECT * FROM dal_bp_records WHERE ${conditions.join(' AND ')} ORDER BY measured_at DESC`,
    params
  );
  res.json(rows);
});

// 新增血壓記錄
app.post('/api/bp', auth, async (req, res) => {
  const uid = req.session.userId;
  const { measured_at, systolic, diastolic, pulse, note } = req.body;
  if (!measured_at || !systolic || !diastolic) return res.status(400).json({ error: '缺少必填欄位' });
  const { rows } = await pool.query(
    `INSERT INTO dal_bp_records(user_id,measured_at,systolic,diastolic,pulse,note)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [uid, measured_at, systolic, diastolic, pulse || null, note || null]
  );
  res.json(rows[0]);
});

// 更新血壓記錄
app.put('/api/bp/:id', auth, async (req, res) => {
  const uid = req.session.userId;
  const { measured_at, systolic, diastolic, pulse, note } = req.body;
  const { rows } = await pool.query(
    `UPDATE dal_bp_records SET measured_at=$1,systolic=$2,diastolic=$3,pulse=$4,note=$5
     WHERE id=$6 AND user_id=$7 RETURNING *`,
    [measured_at, systolic, diastolic, pulse || null, note || null, req.params.id, uid]
  );
  if (!rows.length) return res.status(404).json({ error: '找不到記錄' });
  res.json(rows[0]);
});

// 刪除血壓記錄
app.delete('/api/bp/:id', auth, async (req, res) => {
  const uid = req.session.userId;
  await pool.query('DELETE FROM dal_bp_records WHERE id=$1 AND user_id=$2', [req.params.id, uid]);
  res.json({ ok: true });
});

// 取得分享清單
app.get('/api/bp/shares', auth, async (req, res) => {
  const uid = req.session.userId;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_color
     FROM dal_bp_shares s JOIN dal_users u ON u.id=s.viewer_id
     WHERE s.owner_id=$1`,
    [uid]
  );
  res.json(rows);
});

// 新增分享
app.post('/api/bp/shares', auth, async (req, res) => {
  const uid = req.session.userId;
  const { username } = req.body;
  const { rows: found } = await pool.query('SELECT id FROM dal_users WHERE username=$1', [username]);
  if (!found.length) return res.status(404).json({ error: '找不到該帳號' });
  const viewerId = found[0].id;
  if (viewerId === uid) return res.status(400).json({ error: '不能分享給自己' });
  await pool.query(
    'INSERT INTO dal_bp_shares(owner_id,viewer_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [uid, viewerId]
  );
  res.json({ ok: true });
});

// 移除分享
app.delete('/api/bp/shares/:viewer_id', auth, async (req, res) => {
  const uid = req.session.userId;
  await pool.query('DELETE FROM dal_bp_shares WHERE owner_id=$1 AND viewer_id=$2', [uid, req.params.viewer_id]);
  res.json({ ok: true });
});

// 查詢有哪些人把血壓分享給自己
app.get('/api/bp/shared-with-me', auth, async (req, res) => {
  const uid = req.session.userId;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_color
     FROM dal_bp_shares s JOIN dal_users u ON u.id=s.owner_id
     WHERE s.viewer_id=$1`,
    [uid]
  );
  res.json(rows);
});

// ── Init DB & Start ───────────────────────────────────────────────────
async function initDb() {
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(`ALTER TABLE dal_tasks ADD COLUMN IF NOT EXISTS repeat_until DATE`);
  await pool.query(`ALTER TABLE dal_tasks ADD COLUMN IF NOT EXISTS repeat_group_id INTEGER`);
  await pool.query(`ALTER TABLE dal_users ADD COLUMN IF NOT EXISTS can_invite BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE dal_users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES dal_users(id) ON DELETE SET NULL`);
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
  await pool.query(`ALTER TABLE dal_prescriptions ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) DEFAULT 'daily'`);
  await pool.query(`ALTER TABLE dal_medication_logs ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE dal_medication_logs ADD COLUMN IF NOT EXISTS manual_drug_name VARCHAR(200)`);
  await pool.query(`ALTER TABLE dal_medication_logs ADD COLUMN IF NOT EXISTS manual_dosage VARCHAR(100)`);
  await pool.query(`ALTER TABLE dal_medication_logs ADD COLUMN IF NOT EXISTS manual_note TEXT`);
  await pool.query(`ALTER TABLE dal_medication_logs ADD COLUMN IF NOT EXISTS manual_time TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE dal_prescriptions ADD COLUMN IF NOT EXISTS end_date DATE`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dal_task_completions (
    task_id INT NOT NULL REFERENCES dal_tasks(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    PRIMARY KEY (task_id, date)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dal_projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES dal_users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    color VARCHAR(20) DEFAULT '#2563eb',
    archived BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dal_milestones (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES dal_projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'pending',
    remind_days_before INTEGER DEFAULT 3,
    linked_task_id INTEGER REFERENCES dal_tasks(id) ON DELETE SET NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  // prescription_id 本來就是 nullable，不需要額外 migration

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

  // 預載常見慢性病用藥（只在資料表空白時執行）
  const { rows: drugCount } = await pool.query('SELECT COUNT(*) FROM dal_drug_master');
  if (drugCount[0].count === '0') {
    await pool.query(`
      INSERT INTO dal_drug_master(name, dosage, unit) VALUES
      -- 高血壓
      ('脈優錠', '5mg', '顆'),('脈優錠', '10mg', '顆'),
      ('洛活喜', '5mg', '顆'),('洛活喜', '10mg', '顆'),
      ('舒壓寧', '5mg', '顆'),('舒壓寧', '10mg', '顆'),
      ('可悅您', '4mg', '顆'),('可悅您', '8mg', '顆'),
      ('博脈舒', '2.5mg', '顆'),('博脈舒', '5mg', '顆'),
      ('合必爽', '160mg', '顆'),('合必爽', '80mg', '顆'),
      ('亞速止寧', '25mg', '顆'),('亞速止寧', '50mg', '顆'),
      ('倍他心', '5mg', '顆'),('倍他心', '10mg', '顆'),
      ('歐得利', '5mg', '顆'),('歐得利', '10mg', '顆'),
      -- 糖尿病
      ('庫魯化', '500mg', '顆'),('庫魯化', '850mg', '顆'),
      ('二甲雙胍', '500mg', '顆'),('二甲雙胍', '850mg', '顆'),
      ('亞瑪利', '1mg', '顆'),('亞瑪利', '2mg', '顆'),('亞瑪利', '4mg', '顆'),
      ('糖祿', '30mg', '顆'),('糖祿', '60mg', '顆'),
      ('必糖復', '5mg', '顆'),('必糖復', '10mg', '顆'),
      ('捷諾維', '50mg', '顆'),('捷諾維', '100mg', '顆'),
      ('佳糖維', '5mg', '顆'),('佳糖維', '10mg', '顆'),
      -- 高血脂
      ('冠脂妥', '10mg', '顆'),('冠脂妥', '20mg', '顆'),('冠脂妥', '40mg', '顆'),
      ('立普妥', '10mg', '顆'),('立普妥', '20mg', '顆'),('立普妥', '40mg', '顆'),
      ('素果', '10mg', '顆'),('素果', '20mg', '顆'),
      ('美百樂鎮', '10mg', '顆'),('美百樂鎮', '20mg', '顆'),
      ('益脂可', '10mg', '顆'),('益脂可', '145mg', '顆'),
      -- 心臟
      ('脈泰', '10mg', '顆'),('脈泰', '40mg', '顆'),
      ('耐絞寧貼片', '5mg', '貼'),('耐絞寧貼片', '10mg', '貼'),
      ('保心安', '100mg', '顆'),
      ('毛地黃', '0.25mg', '顆'),
      ('可滅嗽', '25mg', '顆'),('可滅嗽', '50mg', '顆'),
      -- 腦血管 / 抗凝血
      ('保栓通', '75mg', '顆'),
      ('阿斯匹靈', '100mg', '顆'),('阿斯匹靈', '325mg', '顆'),
      ('普栓達', '110mg', '顆'),('普栓達', '150mg', '顆'),
      ('拜瑞妥', '10mg', '顆'),('拜瑞妥', '20mg', '顆'),
      -- 腎臟
      ('碳酸鈣', '500mg', '顆'),
      ('愛司特', '25mg', '顆'),('愛司特', '50mg', '顆'),
      ('腎補鈣', '500mg', '顆'),
      -- 肝病
      ('保肝錠', '70mg', '顆'),
      ('肝得健', '', '顆'),
      ('干安能', '100mg', '顆'),
      ('貝樂克', '0.5mg', '顆'),('貝樂克', '1mg', '顆'),
      ('干擾素注射', '3MIU', '支'),
      -- 氣喘／COPD
      ('輔舒酮', '250mcg', '吸'),
      ('氣全寧', '', '吸'),
      ('舒肺樂', '18mcg', '吸'),
      ('思力華', '18mcg', '吸'),
      ('欣流', '5mg', '顆'),('欣流', '10mg', '顆'),
      -- 甲狀腺
      ('甲狀腺素', '50mcg', '顆'),('甲狀腺素', '100mcg', '顆'),
      ('昂特欣', '5mg', '顆'),('昂特欣', '10mg', '顆'),
      -- 痛風
      ('普利樂', '100mg', '顆'),('普利樂', '300mg', '顆'),
      ('福避痛', '40mg', '顆'),('福避痛', '80mg', '顆'),
      ('秋水仙素', '0.5mg', '顆'),
      -- 骨質疏鬆
      ('福善美', '70mg', '顆'),
      ('鈣片', '500mg', '顆'),
      ('維他命D3', '800IU', '顆'),('維他命D3', '1000IU', '顆'),
      -- 安眠 / 焦慮
      ('史帝諾斯', '10mg', '顆'),
      ('樂平片', '5mg', '顆'),('樂平片', '10mg', '顆'),
      ('悠然', '0.5mg', '顆'),('悠然', '1mg', '顆')
    `);
    console.log('✅ 常見慢性病用藥資料已載入');
  }
}

const PORT = process.env.PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => console.log(`🚀 Day and Life 啟動於 http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
