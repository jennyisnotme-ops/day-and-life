'use strict';

async function init() {
  // Try to restore session
  try {
    const { user, settings } = await API.me();
    S.user = user;
    S.themeAccent = settings.theme_accent || '#2563eb';
    applyTheme(S.themeAccent);
    await loadAppData(settings);
    showApp();
  } catch {
    showLogin();
  }
}

async function loadAppData(settings) {
  [S.calendars, S.categories, S.allUsers] = await Promise.all([
    API.getCalendars(),
    API.getCategories(),
    API.getUsers(),
  ]);
  loadProjects().catch(() => {});

  // Restore visible calendars from settings, fallback to all
  const savedIds = settings?.visible_calendar_ids || [];
  S.visibleCalIds = savedIds.length
    ? S.calendars.filter(c => savedIds.includes(c.id)).map(c => c.id)
    : S.calendars.map(c => c.id);

  await reloadData();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  setTimeout(() => document.getElementById('login-user').focus(), 50);

  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-user').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  if (window.innerWidth <= 768) {
    document.getElementById('mobile-menu-btn').style.display = '';
    document.getElementById('sidebar-close-btn').style.display = '';
    document.getElementById('mobile-inbox-fab').style.display = 'flex';
    document.getElementById('inbox-toggle-btn').style.display = 'none';
  }
  renderApp();
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';
  try {
    const { user, settings } = await API.login(username, password);
    S.user = user;
    S.themeAccent = settings.theme_accent || '#2563eb';
    applyTheme(S.themeAccent);
    await loadAppData(settings);
    showApp();
  } catch(err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}

async function doLogout() {
  await API.logout();
  S.user = null;
  S.calendars = [];
  S.tasks = [];
  closeSettings();
  showLogin();
}

function switchView(view, btn) {
  S.view = view;
  document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  reloadData().then(() => renderApp());
}

function navigate(dir) {
  if (S.view === 'month' || S.view === 'stats') {
    S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + dir, 1);
  } else if (S.view === 'week') {
    S.cursor = addDays(S.cursor, dir * 7);
  } else if (S.view === 'day') {
    S.cursor = addDays(S.cursor, dir);
  }
  reloadData().then(() => renderApp());
}

function goToday() {
  S.cursor = new Date();
  reloadData().then(() => renderApp());
}

function toggleInbox() {
  document.getElementById('inbox-panel').classList.toggle('open');
  renderInbox();
}

function openAddInboxTask() {
  _editingTaskId = null;
  document.getElementById('task-modal-title').textContent = '新增至事項口袋';
  document.getElementById('task-delete-btn').style.display = 'none';
  document.getElementById('task-date').value = '';
  document.getElementById('task-end-date').value = '';
  document.getElementById('task-title').value = '';
  document.getElementById('task-notes').value = '';
  document.getElementById('task-time').value = '';
  document.getElementById('task-repeat').value = 'none';
  populateTaskCalendarSelect();
  populateTaskCategorySelect();
  openModal('add-task');
  setTimeout(() => document.getElementById('task-title').focus(), 80);
}

async function deleteInboxTask(taskId) {
  if (!confirm('確定刪除這個事項？')) return;
  await API.deleteTask(taskId);
  S.inbox = S.inbox.filter(t => t.id !== taskId);
  renderInbox();
  showToast('已刪除');
}

function updateInboxBadge() {
  const count = S.inbox.length;
  ['inbox-badge', 'inbox-badge-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : count;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  });
}

function renderInbox() {
  const list = document.getElementById('inbox-list');
  if (!list) return;
  updateInboxBadge();
  if (!S.inbox.length) {
    list.innerHTML = '<div class="inbox-empty">口袋是空的～<br>新增一些待安排事項吧！</div>';
    return;
  }
  list.innerHTML = S.inbox.map(t => {
    const heart = t.notes ? `<span style="font-size:9px;color:#f43f5e">♥</span>` : '';
    const dot = t.category_color ? `<span style="width:6px;height:6px;border-radius:50%;background:${t.category_color};flex-shrink:0;margin-top:3px;display:inline-block"></span>` : '';
    return `<div class="inbox-task" draggable="true" data-id="${t.id}"
      ondragstart="onInboxDragStart(event,${t.id})"
      onclick="openEditTask(${t.id})">
      ${dot}
      <span style="flex:1;word-break:break-all">${escHtml(t.title)} ${heart}</span>
      <button onclick="event.stopPropagation();deleteInboxTask(${t.id})" style="border:none;background:none;color:#ef4444;font-size:13px;cursor:pointer;padding:0 2px;flex-shrink:0" title="刪除">✕</button>
    </div>`;
  }).join('');
}

function toggleSidebar() {
  const open = document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('sidebar-overlay').classList.toggle('active', open);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (!S.user) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key === 'n' || e.key === 'N') {
    openAddTaskOnDate(fmtDate(S.view === 'day' ? S.cursor : new Date()));
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(m => m.classList.remove('open'));
    closeSettings();
  }
  if (e.key === 'ArrowLeft') navigate(-1);
  if (e.key === 'ArrowRight') navigate(1);
});

function toggleRepeatUntil(val) {
  document.getElementById('repeat-until-wrap').style.display = val === 'none' ? 'none' : '';
}

function toggleSection(label) {
  const content = label.nextElementSibling;
  const arrow = label.querySelector('.collapse-arrow');
  const isCollapsed = label.classList.toggle('collapsed');
  content.style.display = isCollapsed ? 'none' : '';
  arrow.textContent = isCollapsed ? '▸' : '▾';
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '👁️';
  } else {
    input.type = 'password';
    btn.textContent = '🙈';
  }
}

// Override openModal for new-cal to init color picker
const _origOpenNewCal = window.openModal;
document.addEventListener('DOMContentLoaded', () => {
  // Patch new-cal open button
  const btn = document.querySelector('[onclick="openModal(\'new-cal\')"]');
  if (btn) btn.setAttribute('onclick', 'openModal_newCal()');
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_UPDATED') window.location.reload();
  });
}

document.addEventListener('DOMContentLoaded', init);
