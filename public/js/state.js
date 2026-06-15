'use strict';
const S = {
  user: null,
  calendars: [],
  visibleCalIds: [],
  categories: [],
  tasks: [],
  inbox: [],
  notes: {},
  view: 'month',
  cursor: new Date(),
  themeAccent: '#2563eb',
  allUsers: [],
  holidays: {},
  _holidayYears: new Set(),
  prescriptions: [],   // 使用者的 active 處方籤
  medLogs: {},         // { 'YYYY-MM-DD': [{ prescription_id, taken, drug_name, dosage, frequency }] }
};

function getVisibleCalIds() {
  return S.calendars.filter(c => S.visibleCalIds.includes(c.id)).map(c => c.id);
}

function getTasksForDate(dateStr) {
  return S.tasks.filter(t => {
    const start = t.date.slice(0,10);
    const end = t.end_date ? t.end_date.slice(0,10) : start;
    return dateStr >= start && dateStr <= end;
  }).sort((a,b) => a.sort_order - b.sort_order);
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

async function loadInbox() {
  const ids = getVisibleCalIds();
  if (!ids.length) { S.inbox = []; return; }
  S.inbox = await API.getInbox(ids);
}

async function loadMedDataForView() {
  // 載入處方籤（只需一次，不隨日期變動）
  try {
    S.prescriptions = await apiFetch('/api/prescriptions?active=1');
  } catch { S.prescriptions = []; }
  if (!S.prescriptions.length) { S.medLogs = {}; return; }

  // 取出當前 view 的日期範圍
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

  // 先把所有日期 x 所有處方預填 taken: false
  S.medLogs = {};
  let cur = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (cur <= endDate) {
    const d = fmtDate(cur);
    S.medLogs[d] = S.prescriptions.filter(p =>
      (!p.start_date || p.start_date.slice(0,10) <= d) &&
      (!p.end_date   || p.end_date.slice(0,10)   >= d)
    ).map(p => ({
      prescription_id: p.id, log_date: d, taken: false,
      drug_name: p.drug_name, dosage: p.dosage, frequency: p.frequency
    }));
    cur = new Date(cur.getTime() + 86400000);
  }
  // 再把實際記錄覆蓋上去（含停用的舊處方）
  try {
    const rows = await apiFetch(`/api/medication-logs/range?from=${start}&to=${end}`);
    for (const r of rows) {
      if (!r.log_date) continue;
      const d = r.log_date.slice(0, 10);
      if (!S.medLogs[d]) continue;
      const log = S.medLogs[d].find(l => l.prescription_id === r.prescription_id);
      if (log) {
        log.taken = r.taken || false;
      } else {
        S.medLogs[d].push({
          prescription_id: r.prescription_id, log_date: d, taken: r.taken || false,
          drug_name: r.drug_name, dosage: r.dosage, frequency: r.frequency
        });
      }
    }
  } catch { /* 保留預設值 */ }
}

async function reloadData() {
  const year = S.cursor.getFullYear();
  await Promise.all([
    loadTasksForView(),
    loadNotesForView(),
    loadInbox(),
    loadHolidaysForYear(year),
    loadHolidaysForYear(year + 1),
    loadMedDataForView(),
  ]);
}
