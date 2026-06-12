'use strict';

function renderApp() {
  updateSidebar();
  const content = document.getElementById('main-content');
  if (S.view === 'month') renderMonthView(content);
  else if (S.view === 'week') renderWeekView(content);
  else if (S.view === 'day') renderDayView(content);
  else if (S.view === 'stats') renderStatsView(content);
  else if (S.view === 'health') { initHealth(); return; }
  updateHeaderTitle();
}

function updateHeaderTitle() {
  const el = document.getElementById('header-title');
  const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
  if (S.view === 'month' || S.view === 'stats') {
    el.textContent = `${y}年 ${MONTHS_ZH[m]}`;
  } else if (S.view === 'week') {
    const ws = getWeekStart(S.cursor);
    const we = addDays(ws, 6);
    const fmt = d => `${d.getMonth()+1}月${d.getDate()}日`;
    el.textContent = `${ws.getFullYear()}年 ${fmt(ws)} — ${fmt(we)}`;
  } else {
    el.textContent = `${y}年${m+1}月${S.cursor.getDate()}日（${['日','一','二','三','四','五','六'][S.cursor.getDay()]}）`;
  }
}

function updateSidebar() {
  const list = document.getElementById('cal-list');
  list.innerHTML = '';
  for (const cal of S.calendars) {
    const checked = S.visibleCalIds.includes(cal.id);
    const div = document.createElement('div');
    div.className = 'cal-item';
    div.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleCalendar(${cal.id}, this.checked)"/>
      <span class="color-dot" style="background:${cal.color}"></span>
      <span class="cal-name" title="${cal.name}">${cal.name}</span>
      <div class="cal-actions">
        <button class="btn-icon" style="font-size:13px" onclick="openEditCalendar(${cal.id})" title="編輯">✎</button>
        <button class="btn-icon" style="font-size:13px;color:#ef4444" onclick="deleteCalendar(${cal.id})" title="刪除">✕</button>
      </div>`;
    list.appendChild(div);
  }

  const avatar = document.getElementById('sidebar-avatar');
  const name = document.getElementById('sidebar-name');
  if (S.user) {
    avatar.textContent = (S.user.display_name || S.user.username)[0].toUpperCase();
    avatar.style.background = S.user.avatar_color || S.themeAccent;
    name.textContent = S.user.display_name || S.user.username;
  }
}

// ── Month View ──────────────────────────────────────────────────────
function renderMonthView(container) {
  const today = new Date();
  const year = S.cursor.getFullYear(), month = S.cursor.getMonth() + 1;
  const { start, end } = getMonthRange(year, month);

  let html = '<div class="month-view">';
  let cur = new Date(start);

  while (cur <= end) {
    const weekStart = new Date(cur);
    html += '<div class="week-block">';

    // Week header (day names + date numbers)
    html += '<div class="week-header">';
    for (let d = 0; d < 7; d++) {
      const day = addDays(weekStart, d);
      const isToday = isSameDate(day, today);
      const otherMonth = day.getMonth() + 1 !== month;
      const dayNum = day.getDate();
      const dayName = WEEKDAYS_ZH[d];
      const hol = S.holidays[fmtDate(day)];
      const holLabel = hol?.description ? `<span style="display:block;font-size:9px;color:${hol.isHoliday?'#e53e3e':'var(--text3)'}; overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${escHtml(hol.description)}</span>` : '';
      html += `<div class="week-header-cell${isToday?' today':''}${otherMonth?' other-month':''}${hol?.isHoliday?' holiday':''}" >
        <span class="day-num" data-date="${fmtDate(day)}">${dayNum}</span>
        <span style="display:block;font-size:10px;color:var(--text3)">${dayName}</span>
        ${holLabel}
      </div>`;
    }
    html += '</div>';

    // Week body (task columns)
    html += '<div class="week-body">';
    for (let d = 0; d < 7; d++) {
      const day = addDays(weekStart, d);
      const dateStr = fmtDate(day);
      const otherMonth = day.getMonth() + 1 !== month;
      const tasks = getTasksForDate(dateStr);

      html += `<div class="day-col${otherMonth?' other-month':''}" data-date="${dateStr}" ondragover="onDragOver(event)" ondrop="onDrop(event,'${dateStr}')">`;
      for (const t of tasks) {
        html += renderTaskChip(t, 'month', dateStr);
      }
      html += renderMedChips(dateStr);
      html += `<button class="task-add-btn" onclick="openAddTaskOnDate('${dateStr}')">+ 新增</button>`;
      html += '</div>';
    }
    html += '</div>';

    // Notes row
    html += '<div class="notes-row">';
    const primaryCalId = getVisibleCalIds()[0];
    for (let d = 0; d < 7; d++) {
      const day = addDays(weekStart, d);
      const dateStr = fmtDate(day);
      const noteContent = primaryCalId ? getNoteForDate(primaryCalId, dateStr) : '';
      html += `<div class="notes-cell${noteContent?' has-content':''}"
        contenteditable="true"
        data-cal="${primaryCalId}" data-date="${dateStr}"
        onblur="saveNoteFromEl(this)"
        onfocus="this.classList.add('has-content')"
        title="筆記"
        >${escHtml(noteContent)}</div>`;
    }
    html += '</div>';

    html += '</div>';
    cur = addDays(cur, 7);
  }
  html += '</div>';
  container.innerHTML = html;
  initDragOnTasks();
}

// ── Week View ───────────────────────────────────────────────────────
function renderWeekView(container) {
  const today = new Date();
  const ws = getWeekStart(S.cursor);

  let html = '<div class="week-view">';
  html += '<div class="week-cols">';
  for (let d = 0; d < 7; d++) {
    const day = addDays(ws, d);
    const dateStr = fmtDate(day);
    const isToday = isSameDate(day, today);
    const tasks = getTasksForDate(dateStr);

    const hol = S.holidays[dateStr];
    html += `<div class="week-day-col">
      <div class="week-day-header${isToday?' today':''}${hol?.isHoliday?' holiday':''}">
        <div class="big-num">${day.getDate()}</div>
        <div style="font-size:11px;color:var(--text3)">${WEEKDAYS_ZH[d]}</div>
        ${hol?.description ? `<div style="font-size:10px;color:${hol.isHoliday?'#e53e3e':'var(--text3)'};margin-top:2px">${escHtml(hol.description)}</div>` : ''}
      </div>
      <div class="week-task-list" data-date="${dateStr}" ondragover="onDragOver(event)" ondrop="onDrop(event,'${dateStr}')">`;

    for (const t of tasks) {
      html += renderTaskChip(t, 'week', dateStr);
    }
    html += renderMedChips(dateStr);
    html += `<button class="week-add-btn" onclick="openAddTaskOnDate('${dateStr}')">
        <span style="font-size:14px;font-weight:300">+</span> 新增
      </button>`;
    const primaryCalId = getVisibleCalIds()[0];
    const noteContent = primaryCalId ? getNoteForDate(primaryCalId, dateStr) : '';
    html += `</div>
      <div class="notes-cell week-note-cell${noteContent?' has-content':''}"
        contenteditable="true"
        data-cal="${primaryCalId}" data-date="${dateStr}"
        onblur="saveNoteFromEl(this)"
        onfocus="this.classList.add('has-content')"
        title="筆記">${escHtml(noteContent)}</div>
    </div>`;
  }
  html += '</div></div>';
  container.innerHTML = html;
  initDragOnTasks();
}

// ── Day View ────────────────────────────────────────────────────────
function renderDayView(container) {
  const dateStr = fmtDate(S.cursor);
  const tasks = getTasksForDate(dateStr);
  const primaryCalId = getVisibleCalIds()[0];
  const noteContent = primaryCalId ? getNoteForDate(primaryCalId, dateStr) : '';

  const dayHol = S.holidays[dateStr];
  let html = `<div class="day-view">
    <div class="day-view-header">
      <span class="day-view-title">${S.cursor.getFullYear()}年${S.cursor.getMonth()+1}月${S.cursor.getDate()}日${dayHol?.description ? ` <span style="font-size:13px;color:${dayHol.isHoliday?'#e53e3e':'var(--text2)'}">· ${escHtml(dayHol.description)}</span>` : ''}</span>
      <button class="btn btn-primary btn-sm" onclick="openAddTaskOnDate('${dateStr}')">+ 新增任務</button>
    </div>
    <div class="day-task-list" data-date="${dateStr}">`;

  for (const t of tasks) {
    html += renderTaskChip(t, 'day', dateStr);
  }
  const medChips = renderMedChips(dateStr);
  if (medChips) html += `<div class="day-med-section"><div class="day-med-label">💊 今日用藥</div>${medChips}</div>`;
  if (!tasks.length && !medChips) html += '<div class="empty">今天沒有任務，新增一個吧！</div>';
  html += `</div>
    <div class="day-notes-area">
      <div class="day-notes-label">📝 今日備註</div>
      <textarea class="day-notes-input" placeholder="輸入今日備註..."
        data-cal="${primaryCalId}" data-date="${dateStr}"
        onblur="saveNoteFromTextarea(this)">${escHtml(noteContent)}</textarea>
    </div>
  </div>`;
  container.innerHTML = html;
  initDragOnTasks();
}

// ── Task Chip ───────────────────────────────────────────────────────
function renderTaskChip(t, mode, dateStr) {
  const catDot = t.category_color
    ? `<span class="task-cat-dot" style="background:${t.category_color}"></span>` : '';
  const timeHint = t.time_hint ? `<span style="color:var(--text3);font-size:10px">${t.time_hint}</span>` : '';
  const heart = t.notes ? `<span style="font-size:9px;color:#f43f5e;line-height:1" title="${escHtml(t.notes)}">♥</span>` : '';

  const isMultiDay = t.end_date && t.end_date.slice(0,10) !== t.date?.slice(0,10);
  const multiDay = isMultiDay
    ? `<span style="font-size:10px;color:var(--text3)" title="${t.date.slice(0,10)} ~ ${t.end_date.slice(0,10)}">↔</span>` : '';

  const isDone = isMultiDay && dateStr
    ? (t.completed_dates || []).includes(dateStr)
    : t.completed;
  const toggleCall = isMultiDay && dateStr
    ? `toggleTask(${t.id},${!isDone},'${dateStr}')`
    : `toggleTask(${t.id},${!isDone})`;

  if (mode === 'day') {
    return `<div class="day-task-item${isDone?' done':''}"
      draggable="true" data-id="${t.id}" data-date="${t.date}"
      ondragstart="onDragStart(event,${t.id})"
      onclick="openEditTask(${t.id})">
      <div class="task-check" onclick="event.stopPropagation();${toggleCall}"></div>
      <div style="flex:1">
        <div class="day-task-title">${escHtml(t.title)} ${multiDay} ${heart}</div>
        <div class="day-task-meta">
          ${catDot}
          ${t.category_name ? `<span>${escHtml(t.category_name)}</span>` : ''}
          ${timeHint}
          ${t.move_count > 0 ? `<span title="已延後${t.move_count}次">🔁×${t.move_count}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  if (mode === 'week') {
    return `<div class="week-task-item${isDone?' done':''}"
      draggable="true" data-id="${t.id}" data-date="${t.date}"
      ondragstart="onDragStart(event,${t.id})"
      onclick="openEditTask(${t.id})">
      <div class="task-check" onclick="event.stopPropagation();${toggleCall}"></div>
      ${catDot}
      <span class="task-text">${escHtml(t.title)}${timeHint ? ' '+timeHint : ''} ${heart}</span>
    </div>`;
  }

  // month
  return `<div class="task-item${isDone?' done':''}"
    draggable="true" data-id="${t.id}" data-date="${t.date}"
    ondragstart="onDragStart(event,${t.id})"
    onclick="openEditTask(${t.id})">
    <div class="task-check" onclick="event.stopPropagation();${toggleCall}"></div>
    ${catDot}
    <span class="task-text">${timeHint ? `<span style="color:var(--accent);font-size:9px;font-weight:600">${t.time_hint}</span> ` : ''}${escHtml(t.title)} ${heart}</span>
  </div>`;
}

function renderMedChips(dateStr) {
  const logs = S.medLogs[dateStr];
  if (!logs || !logs.length) return '';
  return logs.map(log => {
    const taken = log.taken;
    const label = log.drug_name + (log.dosage ? ` ${log.dosage}` : '');
    return `<div class="med-chip ${taken ? 'med-taken' : 'med-pending'}"
      onclick="calToggleMed(${log.prescription_id},'${dateStr}',${!taken})" title="${escHtml(label)}">
      <span class="med-chip-dot"></span>
      <span class="med-chip-label">${escHtml(log.drug_name)}</span>
    </div>`;
  }).join('');
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function saveNoteFromEl(el) {
  const calId = el.dataset.cal;
  const date = el.dataset.date;
  if (!calId || !date) return;
  const content = el.innerText.trim();
  S.notes[`${calId}:${date}`] = content;
  await API.saveNote({ calendar_id: calId, date, content });
}

async function saveNoteFromTextarea(el) {
  const calId = el.dataset.cal;
  const date = el.dataset.date;
  if (!calId || !date) return;
  const content = el.value.trim();
  S.notes[`${calId}:${date}`] = content;
  await API.saveNote({ calendar_id: calId, date, content });
}
