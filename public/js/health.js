'use strict';

// ── 疾病分類 ──────────────────────────────────────────────────────────
const DISEASE_CATEGORIES = [
  { code: 'cancer',      label: '惡性腫瘤（癌症）',         needDetail: true,  detailPlaceholder: '請填寫具體部位，例如：肺癌、大腸癌' },
  { code: 'heart',       label: '心臟疾病',                 needDetail: false },
  { code: 'cerebro',     label: '腦血管疾病',               needDetail: false },
  { code: 'pneumonia',   label: '肺炎',                     needDetail: false },
  { code: 'diabetes',    label: '糖尿病',                   needDetail: false },
  { code: 'hypertension',label: '高血壓性疾病',             needDetail: false },
  { code: 'respiratory', label: '慢性下呼吸道疾病',         needDetail: false },
  { code: 'kidney',      label: '腎臟疾病',                 needDetail: false },
  { code: 'liver',       label: '慢性肝病及肝硬化',         needDetail: false },
  { code: 'metabolic',   label: '代謝症候群',               needDetail: true,  detailPlaceholder: '請填寫具體狀況，例如：高血脂、肥胖' },
];

// ── 狀態 ──────────────────────────────────────────────────────────────
const HP = {
  bpRecords: [],
  sharedWithMe: [],
  myShares: [],
  viewingOwner: null,
  pdfFrom: '',
  pdfTo: '',
  prescriptions: [],
  todayLogs: [],
  activeTab: 'today', // 'today' | 'rx' | 'bp'
};

// ── 初始化 ────────────────────────────────────────────────────────────
async function initHealth() {
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    loadBpRecords(), loadSharedWithMe(), loadMyShares(),
    loadPrescriptions(), loadTodayLogs(today),
  ]);
  renderHealthView();
}

async function loadPrescriptions() {
  HP.prescriptions = await apiFetch('/api/prescriptions');
}

async function loadTodayLogs(date) {
  HP.todayLogs = await apiFetch(`/api/medication-logs?date=${date}`);
}

async function loadBpRecords() {
  const ownerId = HP.viewingOwner ? HP.viewingOwner.id : null;
  const params = ownerId ? `?owner_id=${ownerId}` : '';
  HP.bpRecords = await apiFetch(`/api/bp${params}`);
}

async function loadSharedWithMe() {
  HP.sharedWithMe = await apiFetch('/api/bp/shared-with-me');
}

async function loadMyShares() {
  HP.myShares = await apiFetch('/api/bp/shares');
}

// ── 主視圖渲染 ────────────────────────────────────────────────────────
function renderHealthView() {
  const content = document.getElementById('main-content');
  const today = new Date().toISOString().slice(0, 10);

  const tabs = [
    { id: 'today', label: '今日服藥' },
    { id: 'rx',    label: '我的處方箋' },
    { id: 'bp',    label: '我的血壓' },
  ];

  const tabBar = `<div class="health-tabs">
    ${tabs.map(t => `<button class="health-tab ${HP.activeTab === t.id ? 'active' : ''}"
      onclick="switchHealthTab('${t.id}')">${t.label}</button>`).join('')}
  </div>`;

  let body = '';
  if (HP.activeTab === 'today') {
    body = renderTodayTab(today);
  } else if (HP.activeTab === 'rx') {
    body = renderRxTab();
  } else {
    body = renderBpTab();
  }

  content.innerHTML = `<div class="health-wrap">${tabBar}${body}</div>`;
}

function switchHealthTab(tab) {
  HP.activeTab = tab;
  renderHealthView();
}

// ── 今日服藥 tab ──────────────────────────────────────────────────────
function renderTodayTab(today) {
  const alerts = renderRefillAlerts();
  return `
    ${alerts}
    <div class="health-section">
      <div class="health-section-header">
        <h3>今日服藥</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" onclick="openManualLogModal('${today}')">手動紀錄</button>
        </div>
      </div>
      ${renderTodayMedSection(today)}
    </div>`;
}

// ── 處方箋 tab ────────────────────────────────────────────────────────
function renderRxTab() {
  return `
    <div class="health-section">
      <div class="health-section-header">
        <h3>我的處方箋</h3>
        <button class="btn btn-primary btn-sm" onclick="openAddPrescriptionModal()">+ 新增處方</button>
      </div>
      ${renderPrescriptionList()}
    </div>`;
}

// ── 血壓 tab ──────────────────────────────────────────────────────────
function renderBpTab() {
  const viewingName = HP.viewingOwner ? HP.viewingOwner.display_name : '我的';
  return `
    <div class="health-topbar">
      <div class="health-person-tabs">
        <button class="person-tab ${!HP.viewingOwner ? 'active' : ''}" onclick="switchBpOwner(null)">我的</button>
        ${HP.sharedWithMe.map(u => `
          <button class="person-tab ${HP.viewingOwner?.id === u.id ? 'active' : ''}"
            onclick="switchBpOwner(${JSON.stringify(u).replace(/"/g,'&quot;')})">
            ${escHtml(u.display_name)}
          </button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        ${!HP.viewingOwner ? `<button class="btn btn-sm" onclick="openBpShareModal()">分享設定</button>` : ''}
        ${!HP.viewingOwner ? `<button class="btn btn-primary btn-sm" onclick="openAddBpModal()">+ 新增記錄</button>` : ''}
      </div>
    </div>
    <div class="health-section">
      <div class="health-section-header">
        <h3>${escHtml(viewingName)}血壓記錄</h3>
        <button class="btn btn-sm" onclick="openBpExportModal()">📄 匯出 PDF</button>
      </div>
      ${renderBpTable()}
    </div>`;
}

// ── 今日服藥區塊 ──────────────────────────────────────────────────────
function renderTodayMedSection(today) {
  const FREQ_LABEL = { morning:'早', noon:'中', evening:'晚', bedtime:'睡前' };
  const RECUR_LABEL = { daily:'每天', every_other_day:'每雙日', weekly:'每週' };

  const rxLogs = HP.todayLogs.filter(l => !l.is_manual);
  const manualLogs = HP.todayLogs.filter(l => l.is_manual);

  const rxItems = rxLogs.length
    ? rxLogs.map(log => {
        const freqStr = (log.frequency || []).map(f => FREQ_LABEL[f] || f).join('／') || '–';
        const recurStr = log.recurrence ? RECUR_LABEL[log.recurrence] || '' : '';
        return `<div class="med-log-item ${log.taken ? 'taken' : ''}">
          <input type="checkbox" ${log.taken ? 'checked' : ''} onchange="toggleMedLog(${log.prescription_id},'${today}',this.checked)"/>
          <div class="med-log-info">
            <span class="med-name">${escHtml(log.drug_name)}${log.dosage ? ' ' + escHtml(log.dosage) : ''}</span>
            <span class="med-freq">${freqStr}${recurStr ? '・' + recurStr : ''}</span>
          </div>
        </div>`;
      }).join('')
    : `<div style="color:var(--text3);font-size:13px;padding:8px 0">今日無處方用藥</div>`;

  const manualItems = manualLogs.map(log => {
    const timeStr = log.manual_time ? new Date(log.manual_time).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="med-log-item taken" style="background:var(--bg3)">
      <span style="font-size:16px;flex-shrink:0">💊</span>
      <div class="med-log-info" style="flex:1">
        <span class="med-name">${escHtml(log.drug_name)}${log.dosage ? ' ' + escHtml(log.dosage) : ''}</span>
        <span class="med-freq">${timeStr ? timeStr + '・' : ''}臨時用藥${log.manual_note ? '・' + escHtml(log.manual_note) : ''}</span>
      </div>
      <button class="btn-icon" style="color:#ef4444;flex-shrink:0" onclick="deleteManualLog(${log.id},'${today}')">✕</button>
    </div>`;
  }).join('');

  const total = rxLogs.length;
  const done = rxLogs.filter(l => l.taken).length;

  return `<div class="med-log-list">
    <div style="font-size:11px;font-weight:600;color:var(--text3);padding:4px 0 6px;text-transform:uppercase;letter-spacing:.05em">
      處方用藥 ${total ? `${done}/${total} 已服用` : ''}
    </div>
    ${rxItems}
    ${manualLogs.length ? `
    <div style="font-size:11px;font-weight:600;color:var(--text3);padding:12px 0 6px;text-transform:uppercase;letter-spacing:.05em">臨時用藥</div>
    ${manualItems}` : ''}
  </div>`;
}

// ── 領藥提醒 ──────────────────────────────────────────────────────────
function renderRefillAlerts() {
  const today = new Date();
  const soon = HP.prescriptions.filter(p => {
    if (!p.is_active || !p.refill_date) return false;
    const diff = (new Date(p.refill_date) - today) / 86400000;
    return diff <= 3;
  });
  if (!soon.length) return '';

  const items = soon.map(p => {
    const diff = Math.ceil((new Date(p.refill_date) - today) / 86400000);
    const label = diff < 0 ? '已過期' : diff === 0 ? '今天' : `${diff} 天後`;
    const cls = diff <= 0 ? 'alert-danger' : 'alert-warn';
    return `<div class="refill-alert ${cls}">
      💊 <strong>${escHtml(p.drug_name)}</strong> 領藥日：${p.refill_date}（${label}）
    </div>`;
  }).join('');

  return `<div style="display:flex;flex-direction:column;gap:6px">${items}</div>`;
}

// ── 處方籤列表 ────────────────────────────────────────────────────────
function renderPrescriptionList() {
  const FREQ_LABEL = { morning:'早', noon:'中', evening:'晚', bedtime:'睡前' };
  const active = HP.prescriptions.filter(p => p.is_active);
  const inactive = HP.prescriptions.filter(p => !p.is_active);

  const renderCard = p => {
    const cat = DISEASE_CATEGORIES.find(c => c.code === p.category_code);
    const catLabel = cat ? cat.label : p.category_code;
    const detail = p.category_detail ? `・${p.category_detail}` : '';
    const freqStr = (p.frequency || []).map(f => FREQ_LABEL[f] || f).join('／') || '未設定';
    return `<div class="rx-card ${p.is_active ? '' : 'rx-inactive'}">
      <div class="rx-card-header">
        <span class="rx-name">${escHtml(p.drug_name)}${p.dosage ? ' <span class="rx-dosage">'+escHtml(p.dosage)+'</span>' : ''}</span>
        <div style="display:flex;gap:6px">
          <button class="btn-icon" onclick="openEditPrescriptionModal(${p.id})" title="編輯">✎</button>
          <button class="btn-icon" style="color:#ef4444" onclick="deletePrescription(${p.id})" title="刪除">✕</button>
        </div>
      </div>
      <div class="rx-meta">
        <span class="rx-tag">${escHtml(catLabel)}${escHtml(detail)}</span>
        <span>服藥：${freqStr}</span>
        ${p.refill_date ? `<span>領藥日：${p.refill_date.slice(0,10)}</span>` : ''}
      </div>
      ${p.notes ? `<div class="rx-notes">${escHtml(p.notes)}</div>` : ''}
    </div>`;
  };

  if (!HP.prescriptions.length) return `<div class="health-empty">尚無處方籤，點右上角新增</div>`;

  return `<div class="rx-list">
    ${active.map(renderCard).join('')}
    ${inactive.length ? `<div class="rx-inactive-label">已停用</div>${inactive.map(renderCard).join('')}` : ''}
  </div>`;
}

// ── 新增 / 編輯處方籤 Modal ───────────────────────────────────────────
function openAddPrescriptionModal() {
  showSmallModal('新增處方籤', buildRxForm(), `
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveRx()">儲存</button>
  `);
  setupDrugSearch();
  setupCategoryDetail();
}

function openEditPrescriptionModal(id) {
  const p = HP.prescriptions.find(x => x.id === id);
  if (!p) return;
  showSmallModal('編輯處方籤', buildRxForm(p), `
    <button class="btn btn-danger btn-sm" style="margin-right:auto" onclick="toggleRxActive(${id},${!p.is_active})">${p.is_active ? '停用' : '重新啟用'}</button>
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveRx(${id})">儲存</button>
  `);
  setupDrugSearch();
  setupCategoryDetail();
}

function buildRxForm(p = {}) {
  const FREQ_OPTIONS = [
    { value:'morning', label:'早' },
    { value:'noon',    label:'中' },
    { value:'evening', label:'晚' },
    { value:'bedtime', label:'睡前' },
  ];
  const freq = p.frequency || [];
  const freqCheckboxes = FREQ_OPTIONS.map(f => `
    <label class="freq-check">
      <input type="checkbox" value="${f.value}" ${freq.includes(f.value) ? 'checked' : ''}/>
      ${f.label}
    </label>`).join('');

  const catOptions = DISEASE_CATEGORIES.map(c =>
    `<option value="${c.code}" data-need-detail="${c.needDetail}" ${p.category_code === c.code ? 'selected' : ''}>${escHtml(c.label)}</option>`
  ).join('');

  const selectedCat = DISEASE_CATEGORIES.find(c => c.code === p.category_code);
  const showDetail = selectedCat?.needDetail ? '' : 'display:none';

  return `
  <div style="display:flex;flex-direction:column;gap:12px">
    <div>
      <label>藥品名稱</label>
      <div style="position:relative">
        <input type="text" id="rx-drug-name" value="${escHtml(p.drug_name || '')}" placeholder="輸入藥名搜尋..." autocomplete="off"/>
        <div id="drug-suggestions" class="drug-suggestions" style="display:none"></div>
      </div>
    </div>
    <div>
      <label>劑量（選填）</label>
      <input type="text" id="rx-dosage" value="${escHtml(p.dosage || '')}" placeholder="例：500mg、1顆"/>
    </div>
    <div>
      <label>疾病分類</label>
      <select id="rx-category" onchange="setupCategoryDetail()">
        <option value="">── 請選擇 ──</option>
        ${catOptions}
      </select>
    </div>
    <div id="rx-detail-wrap" style="${showDetail}">
      <label>具體說明</label>
      <input type="text" id="rx-detail" value="${escHtml(p.category_detail || '')}"
        placeholder="${selectedCat?.detailPlaceholder || ''}"/>
    </div>
    <div>
      <label>服藥時間（每次）</label>
      <div class="freq-group">${freqCheckboxes}</div>
    </div>
    <div>
      <label>服藥頻率</label>
      <select id="rx-recurrence">
        <option value="daily"          ${(p.recurrence||'daily')==='daily'          ?'selected':''}>每日</option>
        <option value="every_other_day"${(p.recurrence||'daily')==='every_other_day'?'selected':''}>每雙日</option>
        <option value="weekly"         ${(p.recurrence||'daily')==='weekly'         ?'selected':''}>每週</option>
      </select>
    </div>
    <div class="form-row">
      <div><label>開始日期</label><input type="date" id="rx-start" value="${p.start_date?.slice(0,10) || ''}"/></div>
      <div><label>下次領藥日</label><input type="date" id="rx-refill" value="${p.refill_date?.slice(0,10) || ''}"/></div>
    </div>
    <div>
      <label>備註（選填）</label>
      <input type="text" id="rx-notes" value="${escHtml(p.notes || '')}" placeholder="例：飯後服用、注意副作用..."/>
    </div>
  </div>`;
}

function setupCategoryDetail() {
  const sel = document.getElementById('rx-category');
  const wrap = document.getElementById('rx-detail-wrap');
  const detailInput = document.getElementById('rx-detail');
  if (!sel || !wrap) return;
  const opt = sel.selectedOptions[0];
  const needDetail = opt?.dataset.needDetail === 'true';
  wrap.style.display = needDetail ? '' : 'none';
  const cat = DISEASE_CATEGORIES.find(c => c.code === sel.value);
  if (detailInput && cat?.detailPlaceholder) detailInput.placeholder = cat.detailPlaceholder;
}

function setupDrugSearch() {
  setTimeout(() => {
    const input = document.getElementById('rx-drug-name');
    const suggestions = document.getElementById('drug-suggestions');
    if (!input || !suggestions) return;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { suggestions.style.display = 'none'; return; }
      timer = setTimeout(async () => {
        const drugs = await apiFetch(`/api/drugs?q=${encodeURIComponent(q)}`);
        if (!drugs.length) { suggestions.style.display = 'none'; return; }
        suggestions.innerHTML = drugs.map(d =>
          `<div class="drug-option" onclick="selectDrug('${escHtml(d.name)}','${escHtml(d.dosage||'')}')">
            <span>${escHtml(d.name)}</span>
            ${d.dosage ? `<span class="drug-dosage">${escHtml(d.dosage)}</span>` : ''}
          </div>`
        ).join('');
        suggestions.style.display = 'block';
      }, 250);
    });
    document.addEventListener('click', e => {
      if (!suggestions.contains(e.target) && e.target !== input) suggestions.style.display = 'none';
    }, { once: false });
  }, 100);
}

function selectDrug(name, dosage) {
  const nameEl = document.getElementById('rx-drug-name');
  const dosageEl = document.getElementById('rx-dosage');
  if (nameEl) nameEl.value = name;
  if (dosageEl && dosage) dosageEl.value = dosage;
  const suggestions = document.getElementById('drug-suggestions');
  if (suggestions) suggestions.style.display = 'none';
}

async function saveRx(id) {
  const drug_name = document.getElementById('rx-drug-name')?.value.trim();
  const dosage = document.getElementById('rx-dosage')?.value.trim();
  const category_code = document.getElementById('rx-category')?.value;
  const category_detail = document.getElementById('rx-detail')?.value.trim();
  const frequency = [...document.querySelectorAll('.freq-check input[type=checkbox]:checked')].map(el => el.value);
  const recurrence = document.getElementById('rx-recurrence')?.value || 'daily';
  const start_date = document.getElementById('rx-start')?.value || null;
  const refill_date = document.getElementById('rx-refill')?.value || null;
  const notes = document.getElementById('rx-notes')?.value.trim();

  if (!drug_name) { showToast('請填寫藥品名稱'); return; }
  if (!category_code) { showToast('請選擇疾病分類'); return; }

  const cat = DISEASE_CATEGORIES.find(c => c.code === category_code);
  if (cat?.needDetail && !category_detail) { showToast('請填寫具體說明'); return; }

  const body = { drug_name, dosage, category_code, category_detail, frequency, recurrence, start_date, refill_date, notes };
  if (id) {
    const p = HP.prescriptions.find(x => x.id === id);
    await apiFetch(`/api/prescriptions/${id}`, { method: 'PUT', body: { ...body, is_active: p?.is_active ?? true } });
  } else {
    await apiFetch('/api/prescriptions', { method: 'POST', body });
  }
  closeModal('modal-small');
  await Promise.all([loadPrescriptions(), loadTodayLogs(new Date().toISOString().slice(0,10))]);
  renderHealthView();
  showToast('已儲存');
}

async function toggleRxActive(id, is_active) {
  const p = HP.prescriptions.find(x => x.id === id);
  if (!p) return;
  await apiFetch(`/api/prescriptions/${id}`, { method: 'PUT', body: { ...p, is_active } });
  closeModal('modal-small');
  await loadPrescriptions();
  renderHealthView();
  showToast(is_active ? '已重新啟用' : '已停用');
}

async function deletePrescription(id) {
  if (!confirm('確定刪除此處方？相關服藥紀錄也會一併刪除。')) return;
  await apiFetch(`/api/prescriptions/${id}`, { method: 'DELETE' });
  closeModal('modal-small');
  await Promise.all([loadPrescriptions(), loadTodayLogs(new Date().toISOString().slice(0,10))]);
  renderHealthView();
  showToast('已刪除');
}

async function toggleMedLog(prescriptionId, date, taken) {
  await apiFetch('/api/medication-logs', { method: 'POST', body: { prescription_id: prescriptionId, log_date: date, taken } });
  await loadTodayLogs(date);
  renderHealthView();
}

// ── 手動紀錄臨時用藥 ──────────────────────────────────────────────────
function openManualLogModal(date) {
  const now = toLocalDateTimeInput(new Date());
  showSmallModal('手動紀錄臨時用藥', `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label>藥品名稱</label>
        <input type="text" id="manual-drug" placeholder="例：降壓藥、普拿疼..." autocomplete="off"/>
      </div>
      <div>
        <label>劑量（選填）</label>
        <input type="text" id="manual-dosage" placeholder="例：1顆、10mg"/>
      </div>
      <div>
        <label>服用時間</label>
        <input type="datetime-local" id="manual-time" value="${now}" step="60"/>
      </div>
      <div>
        <label>原因／備註（選填）</label>
        <input type="text" id="manual-note" placeholder="例：急診醫生指示、血壓高於160"/>
      </div>
    </div>`, `
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveManualLog('${date}')">儲存</button>
  `);
}

async function saveManualLog(date) {
  const drug = document.getElementById('manual-drug')?.value.trim();
  if (!drug) { showToast('請填寫藥品名稱'); return; }
  const dosage = document.getElementById('manual-dosage')?.value.trim();
  const timeVal = document.getElementById('manual-time')?.value;
  const note = document.getElementById('manual-note')?.value.trim();
  await apiFetch('/api/medication-logs/manual', { method: 'POST', body: {
    log_date: date,
    manual_drug_name: drug,
    manual_dosage: dosage || null,
    manual_time: timeVal ? new Date(timeVal).toISOString() : null,
    manual_note: note || null,
  }});
  closeModal('modal-small');
  await loadTodayLogs(date);
  renderHealthView();
  showToast('已記錄');
}

async function deleteManualLog(id, date) {
  if (!confirm('確定刪除此筆臨時紀錄？')) return;
  await apiFetch(`/api/medication-logs/manual/${id}`, { method: 'DELETE' });
  await loadTodayLogs(date);
  renderHealthView();
  showToast('已刪除');
}

function renderBpTable() {
  if (!HP.bpRecords.length) {
    return `<div class="health-empty">尚無血壓記錄</div>`;
  }
  const rows = HP.bpRecords.map(r => {
    const dt = new Date(r.measured_at);
    const dateStr = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const level = bpLevel(r.systolic, r.diastolic);
    const editable = !HP.viewingOwner;
    return `<tr>
      <td>${dateStr} ${timeStr}</td>
      <td><span class="bp-value">${r.systolic}</span></td>
      <td><span class="bp-value">${r.diastolic}</span></td>
      <td>${r.pulse ?? '—'}</td>
      <td><span class="bp-badge bp-${level.cls}">${level.label}</span></td>
      <td>${escHtml(r.note || '')}</td>
      ${editable ? `<td><button class="btn-icon" onclick="openEditBpModal(${r.id})" title="編輯">✎</button>
        <button class="btn-icon" style="color:#ef4444" onclick="deleteBpRecord(${r.id})" title="刪除">✕</button></td>` : '<td></td>'}
    </tr>`;
  }).join('');

  return `<div class="bp-table-wrap">
  <table class="bp-table">
    <thead><tr>
      <th>時間</th><th>收縮壓</th><th>舒張壓</th><th>脈搏</th><th>狀態</th><th>備註</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>`;
}

function bpLevel(sys, dia) {
  if (sys < 120 && dia < 80)  return { cls: 'normal',  label: '正常' };
  if (sys < 130 && dia < 80)  return { cls: 'elevated', label: '偏高' };
  if (sys < 140 || dia < 90)  return { cls: 'high1',   label: '高血壓一期' };
  return                              { cls: 'high2',   label: '高血壓二期' };
}

// ── 切換查看對象 ──────────────────────────────────────────────────────
async function switchBpOwner(user) {
  HP.viewingOwner = user;
  await loadBpRecords();
  renderHealthView();
}

// ── 新增 / 編輯血壓記錄 Modal ─────────────────────────────────────────
function openAddBpModal() {
  const now = new Date();
  const localDT = toLocalDateTimeInput(now);
  showSmallModal('新增血壓記錄', buildBpForm({ measured_at: localDT }), `
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveBpRecord()">儲存</button>
  `);
  setupBpAutoFocus();
}

function openEditBpModal(id) {
  const r = HP.bpRecords.find(x => x.id === id);
  if (!r) return;
  const localDT = toLocalDateTimeInput(new Date(r.measured_at));
  showSmallModal('編輯血壓記錄', buildBpForm({ ...r, measured_at: localDT }), `
    <button class="btn btn-danger btn-sm" style="margin-right:auto" onclick="deleteBpRecord(${id})">刪除</button>
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveBpRecord(${id})">儲存</button>
  `);
  setupBpAutoFocus();
}

function buildBpForm(r = {}) {
  return `
  <div style="display:flex;flex-direction:column;gap:12px">
    <div>
      <label>量測時間</label>
      <input type="datetime-local" id="bp-time" value="${r.measured_at || ''}" step="60"/>
    </div>
    <div style="display:flex;gap:10px">
      <div><label>收縮壓（高）</label><input type="number" id="bp-sys" value="${r.systolic || ''}" placeholder="120" min="50" max="300" style="width:100px"/></div>
      <div><label>舒張壓（低）</label><input type="number" id="bp-dia" value="${r.diastolic || ''}" placeholder="80" min="30" max="200" style="width:100px"/></div>
      <div><label>脈搏</label><input type="number" id="bp-pulse" value="${r.pulse || ''}" placeholder="70" min="30" max="200" style="width:100px"/></div>
    </div>
    <div>
      <label>備註（選填）</label>
      <input type="text" id="bp-note" value="${escHtml(r.note || '')}" placeholder="例：飯後、運動後..."/>
    </div>
  </div>`;
}

function setupBpAutoFocus() {
  // 時間填完 → 跳收縮壓
  setTimeout(() => {
    const timeEl = document.getElementById('bp-time');
    const sysEl  = document.getElementById('bp-sys');
    const diaEl  = document.getElementById('bp-dia');
    const pulseEl= document.getElementById('bp-pulse');
    if (!timeEl) return;

    timeEl.addEventListener('change', () => { if (timeEl.value) sysEl?.focus(); });
    sysEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); diaEl?.focus(); } });
    diaEl?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pulseEl?.focus(); } });
  }, 100);
}

async function saveBpRecord(id) {
  const measured_at = document.getElementById('bp-time')?.value;
  const systolic    = Number(document.getElementById('bp-sys')?.value);
  const diastolic   = Number(document.getElementById('bp-dia')?.value);
  const pulse       = Number(document.getElementById('bp-pulse')?.value) || null;
  const note        = document.getElementById('bp-note')?.value || '';

  if (!measured_at || !systolic || !diastolic) {
    showToast('請填寫時間、收縮壓、舒張壓'); return;
  }

  const body = { measured_at: new Date(measured_at).toISOString(), systolic, diastolic, pulse, note };
  if (id) {
    await apiFetch(`/api/bp/${id}`, { method: 'PUT', body });
  } else {
    await apiFetch('/api/bp', { method: 'POST', body });
  }
  closeModal('modal-small');
  await loadBpRecords();
  renderHealthView();
  showToast('已儲存');
}

async function deleteBpRecord(id) {
  if (!confirm('確定刪除此筆記錄？')) return;
  await apiFetch(`/api/bp/${id}`, { method: 'DELETE' });
  closeModal('modal-small');
  await loadBpRecords();
  renderHealthView();
  showToast('已刪除');
}

// ── 分享設定 Modal ────────────────────────────────────────────────────
function openBpShareModal() {
  showSmallModal('血壓分享設定', buildShareModalBody(), `
    <button class="btn" onclick="closeModal('modal-small')">關閉</button>
  `);
}

function buildShareModalBody() {
  const list = HP.myShares.length
    ? HP.myShares.map(u => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div class="avatar" style="background:${u.avatar_color}">${u.display_name[0]}</div>
        <span style="flex:1">${escHtml(u.display_name)} <span style="color:var(--text3);font-size:12px">@${u.username}</span></span>
        <button class="btn btn-sm btn-danger" onclick="removeBpShare(${u.id})">移除</button>
      </div>`).join('')
    : `<div style="color:var(--text3);font-size:13px;padding:8px 0">尚未分享給任何人</div>`;

  return `
  <div style="display:flex;flex-direction:column;gap:14px">
    <div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:10px">以下帳號可查看你的血壓記錄（唯讀）：</p>
      ${list}
    </div>
    <div style="border-top:1px solid var(--border);padding-top:12px">
      <label>新增分享對象（輸入帳號名稱）</label>
      <div style="display:flex;gap:8px;margin-top:6px">
        <input type="text" id="share-username-input" placeholder="帳號名稱" style="flex:1"/>
        <button class="btn btn-primary btn-sm" onclick="addBpShare()">新增</button>
      </div>
    </div>
  </div>`;
}

async function addBpShare() {
  const username = document.getElementById('share-username-input')?.value.trim();
  if (!username) return;
  try {
    await apiFetch('/api/bp/shares', { method: 'POST', body: { username } });
    await loadMyShares();
    document.getElementById('small-modal-body').innerHTML = buildShareModalBody();
    showToast(`已分享給 ${username}`);
  } catch(e) {
    showToast(e.message || '新增失敗', 'error');
  }
}

async function removeBpShare(viewerId) {
  await apiFetch(`/api/bp/shares/${viewerId}`, { method: 'DELETE' });
  await loadMyShares();
  document.getElementById('small-modal-body').innerHTML = buildShareModalBody();
  showToast('已移除分享');
}

// ── PDF 匯出 ──────────────────────────────────────────────────────────
function openBpExportModal() {
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const fmt = d => d.toISOString().slice(0,10);

  showSmallModal('匯出血壓記錄 PDF', `
  <div style="display:flex;flex-direction:column;gap:12px">
    <div class="form-row">
      <div><label>起始日期</label><input type="date" id="pdf-from" value="${fmt(monthAgo)}"/></div>
      <div><label>結束日期</label><input type="date" id="pdf-to" value="${fmt(today)}"/></div>
    </div>
    <p style="font-size:12px;color:var(--text3)">將匯出所選區間內的所有血壓記錄。</p>
  </div>`, `
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="exportBpPdf()">下載 PDF</button>
  `);
}

async function exportBpPdf() {
  const from = document.getElementById('pdf-from')?.value;
  const to   = document.getElementById('pdf-to')?.value;
  if (!from || !to) { showToast('請選擇日期區間'); return; }

  const ownerId = HP.viewingOwner ? HP.viewingOwner.id : null;
  const params = new URLSearchParams({ from, to });
  if (ownerId) params.set('owner_id', ownerId);
  const records = await apiFetch(`/api/bp?${params}`);

  if (!records.length) { showToast('所選區間無資料'); return; }

  closeModal('modal-small');
  generateBpPdf(records, from, to);
}

function generateBpPdf(records, from, to) {
  // 建立隱藏的列印區塊
  const existing = document.getElementById('bp-print-area');
  if (existing) existing.remove();

  const ownerName = HP.viewingOwner ? HP.viewingOwner.display_name : (S.user?.display_name || '');
  const rows = records.map(r => {
    const dt = new Date(r.measured_at);
    const dateStr = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const level = bpLevel(r.systolic, r.diastolic);
    return `<tr>
      <td>${dateStr} ${timeStr}</td>
      <td>${r.systolic}</td>
      <td>${r.diastolic}</td>
      <td>${r.pulse ?? ''}</td>
      <td>${level.label}</td>
      <td>${escHtml(r.note || '')}</td>
    </tr>`;
  }).join('');

  const div = document.createElement('div');
  div.id = 'bp-print-area';
  div.innerHTML = `
    <div style="font-family:sans-serif;padding:24px;font-size:13px">
      <h2 style="margin:0 0 4px">${escHtml(ownerName)} 血壓記錄</h2>
      <p style="color:#666;margin:0 0 16px">${from} 至 ${to}（共 ${records.length} 筆）</p>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="text-align:left;padding:8px;border:1px solid #e5e7eb">時間</th>
            <th style="text-align:center;padding:8px;border:1px solid #e5e7eb">收縮壓</th>
            <th style="text-align:center;padding:8px;border:1px solid #e5e7eb">舒張壓</th>
            <th style="text-align:center;padding:8px;border:1px solid #e5e7eb">脈搏</th>
            <th style="text-align:center;padding:8px;border:1px solid #e5e7eb">狀態</th>
            <th style="text-align:left;padding:8px;border:1px solid #e5e7eb">備註</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  document.body.appendChild(div);

  window.print();

  setTimeout(() => div.remove(), 1000);
}

// ── 工具函式 ──────────────────────────────────────────────────────────
// 行事曆格子上直接勾服藥
async function calToggleMed(prescriptionId, dateStr, taken) {
  await apiFetch('/api/medication-logs', { method: 'POST', body: { prescription_id: prescriptionId, log_date: dateStr, taken } });
  // 更新本地狀態，不用重載全部
  const logs = S.medLogs[dateStr];
  if (logs) {
    const log = logs.find(l => l.prescription_id === prescriptionId);
    if (log) log.taken = taken;
  }
  renderApp();
}

function toLocalDateTimeInput(date) {
  const y = date.getFullYear();
  const M = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  const h = String(date.getHours()).padStart(2,'0');
  const m = String(date.getMinutes()).padStart(2,'0');
  return `${y}-${M}-${d}T${h}:${m}`;
}
