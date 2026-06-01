'use strict';
const THEME_COLORS = [
  { name:'藍色',  value:'#2563eb' },
  { name:'天藍',  value:'#0891b2' },
  { name:'綠色',  value:'#16a34a' },
  { name:'青綠',  value:'#059669' },
  { name:'紫色',  value:'#7c3aed' },
  { name:'粉紫',  value:'#9333ea' },
  { name:'珊瑚',  value:'#dc4e4e' },
  { name:'橙色',  value:'#ea580c' },
  { name:'琥珀',  value:'#d97706' },
  { name:'粉紅',  value:'#db2777' },
];

const CAL_COLORS = THEME_COLORS.map(t => t.value);

const WEEKDAYS_ZH = ['一','二','三','四','五','六','日'];
const MONTHS_ZH = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function applyTheme(accent) {
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-text', accent);
  document.documentElement.style.setProperty('--accent-light', accent + '18');
  document.getElementById('theme-color-meta').setAttribute('content', accent);
}

function fmtDate(d) {
  // Returns YYYY-MM-DD for a Date object
  return d.toISOString().slice(0, 10);
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function showToast(msg, duration = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function openModal(id) {
  document.getElementById('modal-' + id).classList.add('open');
}

function closeModalOnBg(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getMonthRange(year, month) {
  // month: 1-based
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);
  // Extend to full weeks
  const fromDay = (from.getDay() + 6) % 7; // 0=Mon
  const toDay = (to.getDay() + 6) % 7;
  const start = new Date(from); start.setDate(start.getDate() - fromDay);
  const end = new Date(to); end.setDate(end.getDate() + (6 - toDay));
  return { start, end };
}

function getWeekStart(d) {
  const day = (d.getDay() + 6) % 7;
  const s = new Date(d);
  s.setDate(s.getDate() - day);
  return s;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function colorToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r,g,b];
}

function contrastColor(hex) {
  const [r,g,b] = colorToRgb(hex);
  return (r*299+g*587+b*114)/1000 > 128 ? '#1a1a18' : '#ffffff';
}
