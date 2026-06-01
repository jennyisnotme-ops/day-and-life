'use strict';

function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
  renderThemeSwatches();
  renderSettingsCalendarSelects();
  renderSettingsCategories();
  renderSettingsMembers();
  if (S.user?.is_admin) {
    document.getElementById('admin-section').style.display = '';
    renderUserList();
  }
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function closeSettingsOnBg(e) {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
}

function renderThemeSwatches() {
  buildColorPicker2D('theme-swatches', 'theme-accent-hidden', S.themeAccent, (color) => {
    S.themeAccent = color;
    applyTheme(color);
    API.saveSettings({ theme_accent: color, visible_calendar_ids: S.visibleCalIds }).catch(()=>{});
  });
}

async function setTheme(color, el) {
  S.themeAccent = color;
  applyTheme(color);
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  try {
    await API.saveSettings({ theme_accent: color, visible_calendar_ids: S.visibleCalIds });
  } catch(e) {}
}

function renderSettingsCalendarSelects() {
  const opts = S.calendars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const catSel = document.getElementById('settings-cat-calendar');
  const memSel = document.getElementById('settings-mem-calendar');
  if (catSel) catSel.innerHTML = opts;
  if (memSel) memSel.innerHTML = opts;
}

function renderSettingsCategories() {
  const sel = document.getElementById('settings-cat-calendar');
  const calId = sel ? parseInt(sel.value) : S.calendars[0]?.id;
  const cats = S.categories.filter(c => c.calendar_id === calId);
  const list = document.getElementById('settings-cat-list');
  if (!list) return;
  list.innerHTML = cats.length ? cats.map(c => `
    <div class="cat-row">
      <span class="cat-color" style="background:${c.color}"></span>
      <span class="cat-name">${escHtml(c.name)}</span>
      <button class="btn-icon btn-sm" onclick="openEditCategory(${c.id})" title="編輯">✎</button>
    </div>`).join('') : '<div class="empty" style="padding:8px">尚未新增分類</div>';
}

function renderSettingsMembers() {
  const sel = document.getElementById('settings-mem-calendar');
  const calId = sel ? parseInt(sel.value) : S.calendars[0]?.id;
  const cal = S.calendars.find(c => c.id === calId);
  const members = cal?.members || [];
  const list = document.getElementById('settings-mem-list');
  if (!list) return;
  list.innerHTML = members.map(m => `
    <div class="member-row">
      <div class="avatar" style="background:${m.avatar_color||'#2563eb'};width:24px;height:24px;font-size:10px">${(m.display_name||'U')[0]}</div>
      <span style="flex:1;font-size:13px">${escHtml(m.display_name)}</span>
      <span style="font-size:11px;color:var(--text3)">${m.role==='admin'?'管理員':'成員'}</span>
      ${m.user_id !== S.user?.id ? `<button class="btn-icon btn-sm" onclick="doRemoveMember(${calId},${m.user_id})" title="移除">✕</button>` : ''}
    </div>`).join('') || '<div class="empty" style="padding:8px">尚無成員</div>';
}

async function doRemoveMember(calId, userId) {
  if (!confirm('確定移除此成員？')) return;
  await API.removeMember(calId, userId);
  S.calendars = await API.getCalendars();
  renderSettingsMembers();
  showToast('已移除');
}

function renderUserList() {
  const list = document.getElementById('user-list');
  if (!list) return;
  list.innerHTML = S.allUsers.map(u => `
    <div class="member-row">
      <div class="avatar" style="background:${u.avatar_color||'#2563eb'};width:24px;height:24px;font-size:10px">${(u.display_name||u.username)[0]}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${escHtml(u.display_name)}</div>
        <div style="font-size:11px;color:var(--text3)">@${escHtml(u.username)}${u.is_admin?' · 管理員':''}</div>
      </div>
      ${u.id !== S.user?.id ? `<button class="btn-icon btn-sm" onclick="openResetUserPassword(${u.id})" title="重設密碼">🔑</button>
      <button class="btn-icon btn-sm" onclick="doDeleteUser(${u.id})" title="刪除">✕</button>` : ''}
    </div>`).join('') || '<div class="empty">尚無用戶</div>';
}

function openResetUserPassword(userId) {
  const user = S.allUsers.find(u => u.id === userId);
  showSmallModal(`重設密碼 — ${user?.display_name}`,
    `<div><label>新密碼</label><input type="password" id="sm-reset-pass"/></div>`,
    `<button class="btn" onclick="closeModal('modal-small')">取消</button>
     <button class="btn btn-primary" onclick="doResetPassword(${userId})">儲存</button>`
  );
}

async function doResetPassword(userId) {
  const pass = document.getElementById('sm-reset-pass').value;
  if (pass.length < 6) { showToast('密碼至少 6 碼'); return; }
  await API.updateUser(userId, { password: pass });
  closeModal('modal-small');
  showToast('密碼已重設');
}

async function doDeleteUser(userId) {
  const user = S.allUsers.find(u => u.id === userId);
  if (!confirm(`確定刪除帳號「${user?.display_name}」？`)) return;
  await API.deleteUser(userId);
  S.allUsers = S.allUsers.filter(u => u.id !== userId);
  renderUserList();
  showToast('已刪除');
}

async function toggleCalendar(calId, checked) {
  if (checked) {
    if (!S.visibleCalIds.includes(calId)) S.visibleCalIds.push(calId);
  } else {
    S.visibleCalIds = S.visibleCalIds.filter(id => id !== calId);
  }
  await API.saveSettings({ theme_accent: S.themeAccent, visible_calendar_ids: S.visibleCalIds });
  S.categories = await API.getCategories();
  await reloadData();
  renderApp();
}
