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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// ── Color Picker ────────────────────────────────────────────────────
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1-l);
  const f = n => { const k=(n+h/30)%12; const c=l-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c).toString(16).padStart(2,'0'); };
  return '#'+f(0)+f(8)+f(4);
}
function hexToHsl(hex) {
  let r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s,l=(max+min)/2;
  if(max===min){h=s=0}else{const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break;}h/=6;}
  return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
}

function buildColorPicker2D(containerId, hiddenId, initial, onChange) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const [ih, is, il] = hexToHsl(initial || '#2563eb');
  let hue = ih, sat = is, lit = il;

  const swatchHtml = THEME_COLORS.map(c =>
    `<div class="cp-preset-card" data-color="${c.value}">
      <div class="cp-preset-dot" style="background:${c.value}"></div>
      <span class="cp-preset-name">${c.name}</span>
    </div>`
  ).join('');

  wrap.innerHTML = `
    <div class="cp-wrap">
      <div style="position:relative">
        <canvas class="cp-gradient" id="${containerId}-canvas" width="260" height="130"></canvas>
        <div class="cp-cursor" id="${containerId}-cursor"></div>
      </div>
      <div style="position:relative;margin:6px 0 2px">
        <div class="cp-hue"></div>
        <div class="cp-hue-thumb" id="${containerId}-hthumb"></div>
      </div>
      <div class="cp-bottom-row">
        <div class="cp-preview" id="${containerId}-preview"></div>
        <div class="cp-rgb-inputs">
          <div class="cp-rgb-group"><input class="cp-rgb-input" id="${containerId}-r" type="number" min="0" max="255"/><span>R</span></div>
          <div class="cp-rgb-group"><input class="cp-rgb-input" id="${containerId}-g" type="number" min="0" max="255"/><span>G</span></div>
          <div class="cp-rgb-group"><input class="cp-rgb-input" id="${containerId}-b" type="number" min="0" max="255"/><span>B</span></div>
        </div>
      </div>
      <div class="cp-presets">${swatchHtml}</div>
    </div>`;

  const canvas = document.getElementById(`${containerId}-canvas`);
  const ctx = canvas.getContext('2d');
  const hthumb = document.getElementById(`${containerId}-hthumb`);
  const preview = document.getElementById(`${containerId}-preview`);
  const cursor = document.getElementById(`${containerId}-cursor`);
  const rInput = document.getElementById(`${containerId}-r`);
  const gInput = document.getElementById(`${containerId}-g`);
  const bInput = document.getElementById(`${containerId}-b`);
  const hueBar = wrap.querySelector('.cp-hue');

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
  }

  function drawGradient() {
    const W = canvas.width, H = canvas.height;
    for (let x = 0; x < W; x++) {
      const s = (x / W) * 100;
      const grad = ctx.createLinearGradient(x, 0, x, H);
      grad.addColorStop(0, hslToHex(hue, s, 100));
      grad.addColorStop(0.5, hslToHex(hue, s, 50));
      grad.addColorStop(1, hslToHex(hue, s, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 1, H);
    }
  }

  function updateUI() {
    drawGradient();
    const color = hslToHex(hue, sat, lit);
    preview.style.background = color;
    document.getElementById(hiddenId).value = color;
    const [r,g,b] = hexToRgb(color);
    rInput.value = r; gInput.value = g; bInput.value = b;
    cursor.style.left = (sat / 100 * canvas.offsetWidth) + 'px';
    cursor.style.top = ((1 - lit / 100) * canvas.offsetHeight) + 'px';
    hthumb.style.left = (hue / 360 * 100) + '%';
    wrap.querySelectorAll('.cp-preset-card').forEach(c => {
      c.classList.toggle('active', c.dataset.color === color);
    });
    if (onChange) onChange(color);
  }

  function pickFromCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    sat = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100);
    lit = Math.round((1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))) * 100);
    updateUI();
  }

  function pickHue(e) {
    const rect = hueBar.getBoundingClientRect();
    hue = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360);
    updateUI();
  }

  let dragging = null;
  canvas.addEventListener('mousedown', e => { dragging = 'canvas'; pickFromCanvas(e); });
  hueBar.addEventListener('mousedown', e => { dragging = 'hue'; pickHue(e); });
  document.addEventListener('mousemove', e => { if (dragging==='canvas') pickFromCanvas(e); else if (dragging==='hue') pickHue(e); });
  document.addEventListener('mouseup', () => dragging = null);
  canvas.addEventListener('touchstart', e => { dragging='canvas'; pickFromCanvas(e.touches[0]); e.preventDefault(); }, {passive:false});
  hueBar.addEventListener('touchstart', e => { dragging='hue'; pickHue(e.touches[0]); e.preventDefault(); }, {passive:false});
  document.addEventListener('touchmove', e => { if(dragging==='canvas') pickFromCanvas(e.touches[0]); else if(dragging==='hue') pickHue(e.touches[0]); }, {passive:true});
  document.addEventListener('touchend', () => dragging=null);

  function rgbInputChanged() {
    const r = Math.max(0,Math.min(255,parseInt(rInput.value)||0));
    const g = Math.max(0,Math.min(255,parseInt(gInput.value)||0));
    const b = Math.max(0,Math.min(255,parseInt(bInput.value)||0));
    const hex = '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
    [hue, sat, lit] = hexToHsl(hex);
    updateUI();
  }
  rInput.addEventListener('change', rgbInputChanged);
  gInput.addEventListener('change', rgbInputChanged);
  bInput.addEventListener('change', rgbInputChanged);

  wrap.querySelectorAll('.cp-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      [hue, sat, lit] = hexToHsl(card.dataset.color);
      updateUI();
    });
  });

  setTimeout(updateUI, 50);
}

function contrastColor(hex) {
  const [r,g,b] = colorToRgb(hex);
  return (r*299+g*587+b*114)/1000 > 128 ? '#1a1a18' : '#ffffff';
}
