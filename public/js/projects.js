'use strict';

const PP = {
  projects: [],
  milestones: {},      // { [project_id]: milestone[] }
  collapsed: new Set(), // project ids that are collapsed
  editProjId: null,
  editMsId: null,
  editMsProjId: null,
  linkedTaskId: null,
  linkedTaskTitle: null,
  taskSearchTimer: null,
  taskSearchResults: [],
  dragSrcMsId: null,
  dragSrcProjId: null,
};

// ── Load ──────────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    PP.projects = await apiFetch('/api/projects');
    const results = await Promise.all(PP.projects.map(p => apiFetch(`/api/projects/${p.id}/milestones`)));
    PP.projects.forEach((p, i) => { PP.milestones[p.id] = results[i]; });
    updateProjectsBadge();
  } catch(e) { PP.projects = []; PP.milestones = {}; }
}

async function reloadProjectMilestones(projId) {
  try {
    PP.milestones[projId] = await apiFetch(`/api/projects/${projId}/milestones`);
    updateProjectsBadge();
  } catch(e) {}
}

// ── Badge ─────────────────────────────────────────────────────────────
function updateProjectsBadge() {
  const today = fmtDate(new Date());
  let count = 0;
  for (const ms of Object.values(PP.milestones)) {
    for (const m of ms) {
      if (m.status === 'done' || !m.due_date) continue;
      const due = m.due_date.slice(0,10);
      const daysLeft = Math.ceil((parseDate(due) - parseDate(today)) / 86400000);
      if (daysLeft <= (m.remind_days_before ?? 3)) count++;
    }
  }
  const badge = document.getElementById('proj-badge');
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : count;
  badge.style.display = count > 0 ? 'block' : 'none';
}

// ── Render ────────────────────────────────────────────────────────────
function renderProjectsView() {
  const content = document.getElementById('main-content');
  document.getElementById('header-title').textContent = '專案追蹤';

  const toolbar = `<div class="proj-toolbar">
    <span style="font-size:13px;color:var(--text3)">${PP.projects.length} 個專案</span>
    <button class="btn btn-primary btn-sm" onclick="openProjectModal(null)">+ 新增專案</button>
  </div>`;

  if (!PP.projects.length) {
    content.innerHTML = `${toolbar}<div class="proj-empty">
      <div class="proj-empty-icon">📋</div>
      <div class="proj-empty-title">還沒有專案</div>
      <div style="font-size:13px">新增第一個專案，開始追蹤各階段截止日</div>
    </div>`;
    return;
  }

  const cards = PP.projects.map(renderProjectCard).join('');
  content.innerHTML = `<div class="proj-view">${toolbar}${cards}</div>`;
}

function toggleProjectCollapse(projId) {
  if (PP.collapsed.has(projId)) PP.collapsed.delete(projId);
  else PP.collapsed.add(projId);
  renderProjectsView();
}

function renderProjectCard(proj) {
  const ms = PP.milestones[proj.id] || [];
  const today = fmtDate(new Date());
  const sorted = [...ms].sort((a, b) => a.sort_order - b.sort_order || (a.id - b.id));
  const isCollapsed = PP.collapsed.has(proj.id);

  // count urgent for collapsed badge
  const urgentCount = sorted.filter(m => {
    if (m.status === 'done' || !m.due_date) return false;
    const daysLeft = Math.ceil((parseDate(m.due_date) - parseDate(today)) / 86400000);
    return daysLeft <= (m.remind_days_before ?? 3);
  }).length;

  const msHtml = sorted.map(m => renderMilestoneRow(m, today)).join('');
  const arrow = isCollapsed ? '▸' : '▾';
  const collapsedBadge = isCollapsed && urgentCount > 0
    ? `<span style="background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px">${urgentCount}</span>`
    : '';

  return `<div class="proj-card" style="border-left-color:${escHtml(proj.color)}">
    <div class="proj-card-header" onclick="toggleProjectCollapse(${proj.id})" style="cursor:pointer">
      <span style="color:var(--text3);font-size:13px;margin-right:2px">${arrow}</span>
      <span class="proj-dot" style="background:${escHtml(proj.color)}"></span>
      <span class="proj-name">${escHtml(proj.name)}</span>
      ${collapsedBadge}
      <div class="proj-actions" onclick="event.stopPropagation()">
        <button class="ms-btn" onclick="openProjectModal(${proj.id})" title="編輯">✎</button>
        <button class="ms-btn" onclick="deleteProject(${proj.id})" title="刪除" style="color:#ef4444">✕</button>
      </div>
    </div>
    ${isCollapsed ? '' : `<div class="proj-milestones"
        ondragover="onMsDragOver(event)"
        ondrop="onMsDrop(event,${proj.id})">
      ${msHtml}
      <button class="proj-add-ms" onclick="openMilestoneModal(${proj.id}, null)">＋ 新增里程碑</button>
    </div>`}
  </div>`;
}

function renderMilestoneRow(m, today) {
  const isDone = m.status === 'done';
  const due = m.due_date ? m.due_date.slice(0,10) : null;
  const daysLeft = due ? Math.ceil((parseDate(due) - parseDate(today)) / 86400000) : null;
  const isOverdue = !isDone && due && daysLeft < 0;
  const isUrgent = !isDone && !isOverdue && daysLeft !== null && daysLeft <= (m.remind_days_before ?? 3);

  let dueLabel = '—';
  let dueClass = 'ms-due-normal';
  if (due) {
    const [, mm, dd] = due.split('-');
    dueLabel = `${parseInt(mm)}/${parseInt(dd)}`;
    if (isDone) { dueClass = 'ms-due-done'; }
    else if (isOverdue) { dueLabel += ' 已逾期'; dueClass = 'ms-due-overdue'; }
    else if (daysLeft === 0) { dueLabel += ' 今天到期'; dueClass = 'ms-due-urgent'; }
    else if (isUrgent) { dueLabel += ` 剩${daysLeft}天`; dueClass = 'ms-due-urgent'; }
  }

  const linkedHtml = m.linked_task_id
    ? `<span class="ms-linked" title="${escHtml(m.linked_task_title||'')}">↗ ${escHtml(m.linked_task_title||'任務')}${m.linked_task_done ? ' ✓' : ''}</span>`
    : '';

  return `<div class="ms-row ${isDone ? 'ms-done' : ''}"
      draggable="true"
      data-ms-id="${m.id}"
      data-proj-id="${m.project_id}"
      ondragstart="onMsDragStart(event,${m.id},${m.project_id})"
      ondragend="onMsDragEnd(event)">
    <span class="ms-drag-handle" title="拖曳排序">⠿</span>
    <button class="ms-check" onclick="toggleMilestone(${m.id}, ${m.project_id})">${isDone ? '✓' : ''}</button>
    <span class="ms-title">${escHtml(m.title)}</span>
    ${linkedHtml}
    <span class="ms-due ${dueClass}">${dueLabel}</span>
    <button class="ms-btn" onclick="openMilestoneModal(${m.project_id}, ${m.id})" title="編輯">✎</button>
    <button class="ms-btn" onclick="deleteMilestone(${m.id}, ${m.project_id})" title="刪除" style="color:#ef4444">✕</button>
  </div>`;
}

// ── Project Modal ─────────────────────────────────────────────────────
function openProjectModal(projId) {
  PP.editProjId = projId;
  const proj = projId ? PP.projects.find(p => p.id === projId) : null;
  const name = proj ? proj.name : '';
  const color = proj ? proj.color : '#2563eb';

  const swatches = CAL_COLORS.map(c =>
    `<div class="proj-color-swatch ${c === color ? 'selected' : ''}"
      style="background:${c}" data-color="${c}"
      onclick="selectProjColor(this,'proj-color-hidden')"></div>`
  ).join('');

  const body = `
    <div><label>專案名稱</label><input type="text" id="proj-name-input" value="${escHtml(name)}" placeholder="例：透視班 第19期" autocomplete="off"/></div>
    <div style="margin-top:12px"><label>顏色</label>
      <div class="proj-color-row">${swatches}</div>
      <input type="hidden" id="proj-color-hidden" value="${color}"/>
    </div>`;

  const footer = `
    ${projId ? `<button class="btn btn-danger btn-sm" style="margin-right:auto" onclick="deleteProject(${projId});closeModal('modal-small')">刪除</button>` : ''}
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveProject()">儲存</button>`;

  showSmallModal(proj ? '編輯專案' : '新增專案', body, footer);
  setTimeout(() => document.getElementById('proj-name-input')?.focus(), 80);
}

function selectProjColor(el, hiddenId) {
  el.closest('.proj-color-row').querySelectorAll('.proj-color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(hiddenId).value = el.dataset.color;
}

async function saveProject() {
  const name = document.getElementById('proj-name-input')?.value.trim();
  const color = document.getElementById('proj-color-hidden')?.value || '#2563eb';
  if (!name) { showToast('請輸入專案名稱'); return; }
  try {
    if (PP.editProjId) {
      const updated = await apiFetch(`/api/projects/${PP.editProjId}`, { method:'PATCH', body: { name, color } });
      const idx = PP.projects.findIndex(p => p.id === PP.editProjId);
      if (idx >= 0) PP.projects[idx] = { ...PP.projects[idx], ...updated };
    } else {
      const created = await apiFetch('/api/projects', { method:'POST', body: { name, color } });
      PP.projects.push(created);
      PP.milestones[created.id] = [];
    }
    closeModal('modal-small');
    updateProjectsBadge();
    renderProjectsView();
    showToast('已儲存');
  } catch(e) { showToast('錯誤：' + e.message); }
}

async function deleteProject(projId) {
  if (!confirm('確定刪除此專案及所有里程碑？')) return;
  try {
    await apiFetch(`/api/projects/${projId}`, { method:'DELETE' });
    PP.projects = PP.projects.filter(p => p.id !== projId);
    delete PP.milestones[projId];
    updateProjectsBadge();
    renderProjectsView();
    showToast('已刪除');
  } catch(e) { showToast('錯誤：' + e.message); }
}

// ── Milestone Modal ───────────────────────────────────────────────────
function openMilestoneModal(projId, msId) {
  PP.editMsProjId = projId;
  PP.editMsId = msId;
  const ms = msId ? (PP.milestones[projId] || []).find(m => m.id === msId) : null;

  PP.linkedTaskId = ms?.linked_task_id || null;
  PP.linkedTaskTitle = ms?.linked_task_title || null;

  const title = ms ? ms.title : '';
  const dueDate = ms?.due_date ? ms.due_date.slice(0,10) : '';
  const remindDays = ms?.remind_days_before ?? 3;
  const linkedChip = PP.linkedTaskId
    ? `<div class="task-linked-chip" id="ms-linked-chip" onclick="clearLinkedTask()">↗ ${escHtml(PP.linkedTaskTitle||'')} <span style="color:#ef4444;font-size:10px">✕</span></div>`
    : `<div id="ms-linked-chip" style="display:none"></div>`;

  const body = `
    <div><label>里程碑名稱</label>
      <input type="text" id="ms-title-input" value="${escHtml(title)}" placeholder="例：FB文案截止" autocomplete="off"/></div>
    <div class="form-row" style="margin-top:12px">
      <div><label>到期日</label><input type="date" id="ms-due-input" value="${dueDate}"/></div>
      <div><label>提前幾天提醒</label>
        <input type="number" id="ms-remind-input" value="${remindDays}" min="0" max="30" style="width:80px"/></div>
    </div>
    <div style="margin-top:12px"><label>連結任務（選填）</label>
      <div class="task-search-wrap">
        <input type="text" id="ms-task-search" placeholder="搜尋任務名稱..." autocomplete="off"
          oninput="onTaskSearch(this.value)" value="${PP.linkedTaskTitle ? escHtml(PP.linkedTaskTitle) : ''}"/>
        <div class="task-search-results" id="ms-task-results" style="display:none"></div>
      </div>
      ${linkedChip}
    </div>`;

  const footer = `
    ${msId ? `<button class="btn btn-danger btn-sm" style="margin-right:auto" onclick="deleteMilestone(${msId},${projId});closeModal('modal-small')">刪除</button>` : ''}
    <button class="btn" onclick="closeModal('modal-small')">取消</button>
    <button class="btn btn-primary" onclick="saveMilestone()">儲存</button>`;

  showSmallModal(ms ? '編輯里程碑' : '新增里程碑', body, footer);
  setTimeout(() => document.getElementById('ms-title-input')?.focus(), 80);
}

function onTaskSearch(q) {
  clearTimeout(PP.taskSearchTimer);
  const resultsEl = document.getElementById('ms-task-results');
  if (!q.trim()) { resultsEl.style.display = 'none'; return; }
  PP.taskSearchTimer = setTimeout(async () => {
    try {
      const tasks = await apiFetch(`/api/tasks/search?q=${encodeURIComponent(q.trim())}`);
      if (!tasks.length) { resultsEl.style.display = 'none'; return; }
      PP.taskSearchResults = tasks;
      resultsEl.innerHTML = tasks.map((t, i) => {
        const dateStr = t.date ? t.date.slice(0,10) : '無日期';
        return `<div class="task-search-item" onmousedown="selectLinkedTask(${i})">
          <span>${escHtml(t.title)}</span>
          <span class="task-search-meta">${dateStr}${t.category_name ? ' · ' + escHtml(t.category_name) : ''}</span>
        </div>`;
      }).join('');
      resultsEl.style.display = 'block';
    } catch(e) { resultsEl.style.display = 'none'; }
  }, 300);
}

function selectLinkedTask(idx) {
  const t = PP.taskSearchResults[idx];
  if (!t) return;
  PP.linkedTaskId = t.id;
  PP.linkedTaskTitle = t.title;
  document.getElementById('ms-task-search').value = t.title;
  document.getElementById('ms-task-results').style.display = 'none';
  const chip = document.getElementById('ms-linked-chip');
  if (chip) {
    chip.style.display = 'inline-flex';
    chip.innerHTML = `↗ ${escHtml(t.title)} <span style="color:#ef4444;font-size:10px;margin-left:4px" onclick="clearLinkedTask()">✕</span>`;
  }
}

function clearLinkedTask() {
  PP.linkedTaskId = null;
  PP.linkedTaskTitle = null;
  const inp = document.getElementById('ms-task-search');
  if (inp) inp.value = '';
  const chip = document.getElementById('ms-linked-chip');
  if (chip) chip.style.display = 'none';
}

async function saveMilestone() {
  const title = document.getElementById('ms-title-input')?.value.trim();
  const dueDate = document.getElementById('ms-due-input')?.value || null;
  const remindDays = parseInt(document.getElementById('ms-remind-input')?.value) || 3;
  if (!title) { showToast('請輸入里程碑名稱'); return; }
  const projId = PP.editMsProjId;
  try {
    const payload = { title, due_date: dueDate, remind_days_before: remindDays, linked_task_id: PP.linkedTaskId || null };
    if (PP.editMsId) {
      await apiFetch(`/api/milestones/${PP.editMsId}`, { method:'PATCH', body: payload });
    } else {
      payload.project_id = projId;
      await apiFetch('/api/milestones', { method:'POST', body: payload });
    }
    closeModal('modal-small');
    await reloadProjectMilestones(projId);
    renderProjectsView();
    showToast('已儲存');
  } catch(e) { showToast('錯誤：' + e.message); }
}

async function deleteMilestone(msId, projId) {
  try {
    await apiFetch(`/api/milestones/${msId}`, { method:'DELETE' });
    if (PP.milestones[projId]) {
      PP.milestones[projId] = PP.milestones[projId].filter(m => m.id !== msId);
    }
    updateProjectsBadge();
    renderProjectsView();
    showToast('已刪除');
  } catch(e) { showToast('錯誤：' + e.message); }
}

// ── Drag & Drop milestones ────────────────────────────────────────────
function onMsDragStart(e, msId, projId) {
  PP.dragSrcMsId = msId;
  PP.dragSrcProjId = projId;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('ms-dragging');
}

function onMsDragEnd(e) {
  e.currentTarget.classList.remove('ms-dragging');
  document.querySelectorAll('.ms-drag-over').forEach(el => el.classList.remove('ms-drag-over'));
}

function onMsDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.ms-row');
  document.querySelectorAll('.ms-drag-over').forEach(el => el.classList.remove('ms-drag-over'));
  if (row && row.dataset.msId != PP.dragSrcMsId) row.classList.add('ms-drag-over');
}

async function onMsDrop(e, projId) {
  e.preventDefault();
  document.querySelectorAll('.ms-drag-over').forEach(el => el.classList.remove('ms-drag-over'));
  const srcId = PP.dragSrcMsId;
  if (!srcId || PP.dragSrcProjId !== projId) return;

  const targetRow = e.target.closest('.ms-row');
  const targetId = targetRow ? parseInt(targetRow.dataset.msId) : null;
  if (!targetId || targetId === srcId) return;

  const ms = PP.milestones[projId];
  if (!ms) return;
  const srcIdx = ms.findIndex(m => m.id === srcId);
  const tgtIdx = ms.findIndex(m => m.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  // reorder in memory
  const [moved] = ms.splice(srcIdx, 1);
  ms.splice(tgtIdx, 0, moved);
  ms.forEach((m, i) => { m.sort_order = i; });
  renderProjectsView();

  // persist
  try {
    await apiFetch('/api/milestones/reorder', { method:'POST', body: { ordered_ids: ms.map(m => m.id) } });
  } catch(e) { /* silent */ }
}

async function toggleMilestone(msId, projId) {
  const ms = (PP.milestones[projId] || []).find(m => m.id === msId);
  if (!ms) return;
  const newStatus = ms.status === 'done' ? 'pending' : 'done';
  try {
    await apiFetch(`/api/milestones/${msId}`, { method:'PATCH', body: JSON.stringify({ status: newStatus }) });
    ms.status = newStatus;
    updateProjectsBadge();
    renderProjectsView();
  } catch(e) { showToast('錯誤：' + e.message); }
}
