'use strict';
const S = {
  user: null,
  calendars: [],       // all calendars user belongs to
  visibleCalIds: [],   // which calendars are checked ON
  categories: [],      // all categories for visible calendars
  tasks: [],           // tasks for current view range
  notes: {},           // { "calId:date": content }
  view: 'month',       // 'month' | 'week' | 'day' | 'stats'
  cursor: new Date(),  // current date/month being viewed
  themeAccent: '#2563eb',
  allUsers: [],        // for admin
};

function getVisibleCalIds() {
  return S.calendars.filter(c => S.visibleCalIds.includes(c.id)).map(c => c.id);
}

function getTasksForDate(dateStr) {
  return S.tasks.filter(t => t.date === dateStr || t.date.slice(0,10) === dateStr)
    .sort((a,b) => a.sort_order - b.sort_order);
}

function getNoteForDate(calId, dateStr) {
  return S.notes[`${calId}:${dateStr}`] || '';
}

async function loadTasksForView() {
  const ids = getVisibleCalIds();
  if (!ids.length) { S.tasks = []; return; }
  let start, end;
  if (S.view === 'month') {
    const r = getMonthRange(S.cursor.getFullYear(), S.cursor.getMonth() + 1);
    start = fmtDate(r.start); end = fmtDate(r.end);
  } else if (S.view === 'week') {
    const ws = getWeekStart(S.cursor);
    start = fmtDate(ws); end = fmtDate(addDays(ws, 6));
  } else if (S.view === 'day') {
    start = end = fmtDate(S.cursor);
  } else {
    // stats: current month
    const y = S.cursor.getFullYear(), m = S.cursor.getMonth() + 1;
    start = `${y}-${String(m).padStart(2,'0')}-01`;
    end = fmtDate(new Date(y, m, 0));
  }
  S.tasks = await API.getTasks(ids, start, end);
}

async function loadNotesForView() {
  const ids = getVisibleCalIds();
  if (!ids.length) { S.notes = {}; return; }
  let start, end;
  if (S.view === 'month') {
    const r = getMonthRange(S.cursor.getFullYear(), S.cursor.getMonth() + 1);
    start = fmtDate(r.start); end = fmtDate(r.end);
  } else if (S.view === 'week') {
    const ws = getWeekStart(S.cursor);
    start = fmtDate(ws); end = fmtDate(addDays(ws, 6));
  } else {
    start = end = fmtDate(S.cursor);
  }
  S.notes = {};
  for (const calId of ids) {
    const rows = await API.getNotes(calId, start, end);
    for (const r of rows) {
      S.notes[`${calId}:${r.date.slice(0,10)}`] = r.content;
    }
  }
}

async function reloadData() {
  await Promise.all([loadTasksForView(), loadNotesForView()]);
}
