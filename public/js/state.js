'use strict';
const S = {
  user: null,
  calendars: [],
  visibleCalIds: [],
  categories: [],
  tasks: [],
  notes: {},
  view: 'month',
  cursor: new Date(),
  themeAccent: '#2563eb',
  allUsers: [],
  holidays: {},   // { "YYYY-MM-DD": { description, isHoliday } }
  _holidayYears: new Set(),
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

async function loadHolidaysForYear(year) {
  if (S._holidayYears.has(year)) return;
  S._holidayYears.add(year);
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
    if (!res.ok) return;
    const data = await res.json();
    for (const d of data) {
      // date format: "20260101"
      const dateStr = `${d.date.slice(0,4)}-${d.date.slice(4,6)}-${d.date.slice(6,8)}`;
      S.holidays[dateStr] = {
        description: d.description || '',
        isHoliday: d.isHoliday,
        holidayCategory: d.holidayCategory || '',
      };
    }
  } catch(e) {}
}

async function reloadData() {
  const year = S.cursor.getFullYear();
  await Promise.all([
    loadTasksForView(),
    loadNotesForView(),
    loadHolidaysForYear(year),
    loadHolidaysForYear(year + 1), // preload next year
  ]);
}
