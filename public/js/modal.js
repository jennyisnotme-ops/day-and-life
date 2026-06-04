'use strict';
let _editingTaskId = null;

// ── Task Modal ──────────────────────────────────────────────────────
function openAddTaskOnDate(dateStr) {
  _editingTaskId = null;
  document.getElementById('task-modal-title').textContent = '新增任務';
  document.getElementById('task-delete-btn').style.display = 'none';
  document.getElementById('task-date').value = dateStr;
  document.getElementById('task-end-date').value = '';
  document.getElementById('task-title').value = '';
  document.getElementById('task-notes').value = '';
  document.getElementById('task-time').value = '';
  document.getElementById('task-repeat').value = 'none';
  document.getElementById('task-repeat-until').value = '';
  document.getElementById('repeat-until-wrap').style.display = 'none';
  populateTaskCalendarSelect();
  populateTaskCategorySelect();
  openModal('add-task');
  setTimeout(() => document.getElementById('task-title').focus(), 80);
}

function openEditTask(taskId) {
  const task = S.tasks.find(t => t.id === taskId) || S.inbox.find(t => t.id === taskId);
  if (!task) return;
  _editingTaskId = taskId;
  document.getElementById('task-modal-title').textContent = '編輯任務';
  document.getElementById('task-delete-btn').style.display = '';
  document.getElementById('task-date').value = task.date ? task.date.slice(0,10) : '';
  document.getElementById('task-end-date').value = task.end_date ? task.end_date.slice(0,10) : '';
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-notes').value = task.notes || '';
  document.getElementById('task-time').value = task.time_hint || '';
  document.getElementById('task-repeat').value = task.repeat_type || 'none';
  document.getElementById('task-repeat-until').value = task.repeat_until ? task.repeat_until.slice(0,10) : '';
  toggleRepeatUntil(task.repeat_type || 'none');
  populateTaskCalendarSelect(task.calendar_id);
  populateTaskCategorySelect(task.calendar_id, task.category_id);
  openModal('add-task');
}

function populateTaskCalendarSelect(selectedId) {
  const sel = document.getElementById('task-calendar');
  sel.innerHTML = S.calendars.filter(c => S.visibleCalIds.includes(c.id)).map(c =>
    `<option value="${c.id}" ${c.id == selectedId ? 'selected' : ''}>${c.name}</option>`
  ).join('');
  sel.onchange = () => populateTaskCategorySelect(parseInt(sel.value));
}

function populateTaskCategorySelect(calId, selectedCatId) {
  const calSel = document.getElementById('task-calendar');
  const cid = calId || (calSel ? parseInt(calSel.value) : null);
  const sel = document.getElementById('task-category');
  const cats = S.categories.filter(c => c.calendar_id === cid);
  sel.innerHTML = `<option value="">── 不選分類 ──</option>` +
    cats.map(c => `<option value="${c.id}" ${c.id == selectedCatId ? 'selected' : ''}>${c.name}</option>`).join('');
}

async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  if (!title) { showToast('請輸入任務內容'); return; }
  const date = document.getElementById('task-date').value || null;
  const endDate = document.getElementById('task-end-date').value || null;
  if (endDate && endDate < date) { showToast('結束日期不能早於開始日期'); return; }
  const calendarId = parseInt(document.getElementById('task-calendar').value);
  const categoryId = document.getElementById('task-category').value ? parseInt(document.getElementById('task-category').value) : null;
  const timeHint = document.getElementById('task-time').value || null;
  const repeatType = document.getElementById('task-repeat').value;
  const repeatUntil = repeatType !== 'none' ? (document.getElementById('task-repeat-until').value || null) : null;
  const notes = document.getElementById('task-notes').value.trim() || null;

  try {
    if (_editingTaskId) {
      const updated = await API.updateTask(_editingTaskId, { title, date, end_date: endDate, calendar_id: calendarId, category_id: categoryId, time_hint: timeHint, repeat_type: repeatType, repeat_until: repeatUntil, notes });
      const idx = S.tasks.findIndex(t => t.id === _editingTaskId);
      if (idx >= 0) S.tasks[idx] = { ...S.tasks[idx], ...updated };
    } else {
      const newTask = await API.createTask({ calendar_id: calendarId, category_id: categoryId, title, date, end_date: endDate, time_hint: timeHint, repeat_type: repeatType, repeat_until: repeatUntil, notes });
      S.tasks.push(newTask);
    }
  } catch (err) {
    console.error('saveTask error:', err);
    showToast('錯誤：' + (err.message || String(err)));
    return;
  }
  // 儲存成功後關閉 modal、刷新畫面（render 錯誤不影響儲存）
  closeModal('modal-add-task');
  showToast(_editingTaskId ? '已更新' : '已新增');
  try {
    await reloadData();
    renderApp();
    renderInbox();
  } catch(e) {
    console.error('render error after save:', e);
  }
}

async function deleteCurrentTask() {
  if (!_editingTaskId) return;
  if (!confirm('確定刪除這個任務？')) return;
  await API.deleteTask(_editingTaskId);
  S.tasks = S.tasks.filter(t => t.id !== _editingTaskId);
  closeModal('modal-add-task');
  await reloadData();
  renderApp();
  showToast('已刪除');
}

async function toggleTask(taskId, completed) {
  const task = S.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.completed = completed;
  renderApp();
  await API.updateTask(taskId, { completed });
}

// ── Calendar Modal ──────────────────────────────────────────────────
let _editingCalId = null;

function buildColorPicker(pickerId, hiddenId, selected) {
  buildColorPicker2D(pickerId, hiddenId, selected || '#2563eb');
}

function openEditCalendar(calId) {
  _editingCalId = calId;
  const cal = S.calendars.find(c => c.id === calId);
  document.getElementById('cal-modal-title').textContent = '編輯行事曆';
  document.getElementById('cal-name').value = cal.name;
  buildColorPicker('cal-color-picker', 'cal-color', cal.color);
  openModal('new-cal');
}

function openModal_newCal() {
  _editingCalId = null;
  document.getElementById('cal-modal-title').textContent = '新增行事曆';
  document.getElementById('cal-name').value = '';
  buildColorPicker('cal-color-picker', 'cal-color', THEME_COLORS[0].value);
  openModal('new-cal');
}

async function deleteCalendar(calId) {
  const cal = S.calendars.find(c => c.id === calId);
  if (!cal) return;
  if (!confirm(`確定刪除「${cal.name}」行事曆？\n（此行事曆內的所有任務也會一併刪除）`)) return;
  try {
    await API.deleteCalendar(calId);
    S.calendars = S.calendars.filter(c => c.id !== calId);
    S.visibleCalIds = S.visibleCalIds.filter(id => id !== calId);
    S.categories = S.categories.filter(c => c.calendar_id !== calId);
    await reloadData();
    renderApp();
    showToast('行事曆已刪除');
  } catch(err) { showToast('錯誤：' + err.message); }
}

async function saveCalendar() {
  const name = document.getElementById('cal-name').value.trim();
  if (!name) { showToast('請輸入行事曆名稱'); return; }
  const color = document.getElementById('cal-color').value;
  try {
    if (_editingCalId) {
      await API.updateCalendar(_editingCalId, { name, color });
    } else {
      const cal = await API.createCalendar({ name, color });
      S.calendars.push(cal);
      S.visibleCalIds.push(cal.id);
    }
    S.calendars = await API.getCalendars();
    if (!_editingCalId && S.calendars.length > 0) {
      const newest = S.calendars[S.calendars.length - 1];
      if (!S.visibleCalIds.includes(newest.id)) S.visibleCalIds.push(newest.id);
    }
    S.categories = await API.getCategories();
    closeModal('modal-new-cal');
    renderApp();
    showToast('已儲存');
  } catch (err) {
    showToast('錯誤：' + err.message);
  }
}

// ── Small Modal helpers ─────────────────────────────────────────────
function showSmallModal(title, bodyHtml, footerHtml) {
  document.getElementById('small-modal-title').textContent = title;
  document.getElementById('small-modal-body').innerHTML = bodyHtml;
  document.getElementById('small-modal-footer').innerHTML = footerHtml;
  openModal('small');
}

// Add category
function openAddCategory() {
  const calSel = document.getElementById('settings-cat-calendar');
  const calId = calSel ? calSel.value : S.calendars[0]?.id;
  showSmallModal('新增分類',
    `<div><label>名稱</label><input type="text" id="sm-cat-name" placeholder="分類名稱"/></div>
     <div><label>顏色</label><div class="color-picker-row" id="sm-cat-colors"></div><input type="hidden" id="sm-cat-color" value="${THEME_COLORS[0].value}"/></div>`,
    `<button class="btn" onclick="closeModal('modal-small')">取消</button>
     <button class="btn btn-primary" onclick="doAddCategory(${calId})">新增</button>`
  );
  buildColorPicker('sm-cat-colors', 'sm-cat-color', THEME_COLORS[2].value);
  setTimeout(() => document.getElementById('sm-cat-name').focus(), 80);
}

async function doAddCategory(calId) {
  const name = document.getElementById('sm-cat-name').value.trim();
  const color = document.getElementById('sm-cat-color').value;
  if (!name) { showToast('請輸入分類名稱'); return; }
  const cat = await API.createCategory({ calendar_id: calId, name, color });
  S.categories.push(cat);
  closeModal('modal-small');
  renderSettingsCategories();
  showToast('分類已新增');
}

// Edit category
function openEditCategory(catId) {
  const cat = S.categories.find(c => c.id === catId);
  showSmallModal('編輯分類',
    `<div><label>名稱</label><input type="text" id="sm-cat-name" value="${escHtml(cat.name)}"/></div>
     <div><label>顏色</label><div class="color-picker-row" id="sm-cat-colors"></div><input type="hidden" id="sm-cat-color" value="${cat.color}"/></div>`,
    `<button class="btn btn-danger" style="margin-right:auto" onclick="doDeleteCategory(${catId})">刪除</button>
     <button class="btn" onclick="closeModal('modal-small')">取消</button>
     <button class="btn btn-primary" onclick="doEditCategory(${catId})">儲存</button>`
  );
  buildColorPicker('sm-cat-colors', 'sm-cat-color', cat.color);
}

async function doEditCategory(catId) {
  const name = document.getElementById('sm-cat-name').value.trim();
  const color = document.getElementById('sm-cat-color').value;
  await API.updateCategory(catId, { name, color });
  const cat = S.categories.find(c => c.id === catId);
  if (cat) { cat.name = name; cat.color = color; }
  closeModal('modal-small');
  renderSettingsCategories();
  showToast('已更新');
}

async function doDeleteCategory(catId) {
  if (!confirm('刪除此分類？（任務不會被刪除，只是移除分類標記）')) return;
  await API.deleteCategory(catId);
  S.categories = S.categories.filter(c => c.id !== catId);
  closeModal('modal-small');
  renderSettingsCategories();
  showToast('已刪除');
}

// Invite member
function openInviteMember() {
  const calSel = document.getElementById('settings-mem-calendar');
  const calId = calSel ? parseInt(calSel.value) : S.calendars[0]?.id;
  const already = (S.calendars.find(c=>c.id===calId)?.members || []).map(m=>m.user_id);
  const eligible = S.allUsers.filter(u => !already.includes(u.id));
  showSmallModal('邀請成員',
    `<div><label>選擇用戶</label><select id="sm-invite-user">
      ${eligible.map(u=>`<option value="${u.id}">${u.display_name} (@${u.username})</option>`).join('') || '<option disabled>沒有可邀請的用戶</option>'}
    </select></div>
    <div><label>角色</label><select id="sm-invite-role"><option value="member">成員</option><option value="admin">管理員</option></select></div>`,
    `<button class="btn" onclick="closeModal('modal-small')">取消</button>
     <button class="btn btn-primary" onclick="doInviteMember(${calId})">邀請</button>`
  );
}

async function doInviteMember(calId) {
  const userId = document.getElementById('sm-invite-user').value;
  const role = document.getElementById('sm-invite-role').value;
  await API.addMember(calId, { user_id: userId, role });
  S.calendars = await API.getCalendars();
  closeModal('modal-small');
  renderSettingsMembers();
  showToast('已邀請');
}

// Add user (admin)
function openAddUser() {
  showSmallModal('新增帳號',
    `<div><label>帳號</label><input type="text" id="sm-user-name" autocomplete="off"/></div>
     <div><label>顯示名稱</label><input type="text" id="sm-user-display"/></div>
     <div><label>初始密碼</label><div class="pw-wrap"><input type="password" id="sm-user-pass"/><button type="button" class="pw-eye" onclick="togglePw('sm-user-pass',this)" tabindex="-1">🙈</button></div></div>
     <div style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="sm-user-admin" style="width:auto"/><label style="display:inline;margin:0">管理員權限</label></div>`,
    `<button class="btn" onclick="closeModal('modal-small')">取消</button>
     <button class="btn btn-primary" onclick="doAddUser()">新增</button>`
  );
}

async function doAddUser() {
  const username = document.getElementById('sm-user-name').value.trim();
  const display_name = document.getElementById('sm-user-display').value.trim() || username;
  const password = document.getElementById('sm-user-pass').value;
  const is_admin = document.getElementById('sm-user-admin').checked;
  if (!username || !password) { showToast('請填入帳號與密碼'); return; }
  try {
    const user = await API.createUser({ username, display_name, password, is_admin, avatar_color: THEME_COLORS[Math.floor(Math.random()*THEME_COLORS.length)].value });
    S.allUsers.push(user);
    closeModal('modal-small');
    renderUserList();
    showToast(`帳號 ${username} 已建立`);
  } catch(err) { showToast('錯誤：' + err.message); }
}

// Change password
function openChangePassword() {
  showSmallModal('修改密碼',
    `<div><label>目前密碼</label><div class="pw-wrap"><input type="password" id="sm-cur-pass"/><button type="button" class="pw-eye" onclick="togglePw('sm-cur-pass',this)" tabindex="-1">🙈</button></div></div>
     <div><label>新密碼</label><div class="pw-wrap"><input type="password" id="sm-new-pass"/><button type="button" class="pw-eye" onclick="togglePw('sm-new-pass',this)" tabindex="-1">🙈</button></div></div>
     <div><label>確認新密碼</label><div class="pw-wrap"><input type="password" id="sm-new-pass2"/><button type="button" class="pw-eye" onclick="togglePw('sm-new-pass2',this)" tabindex="-1">🙈</button></div></div>`,
    `<button class="btn" onclick="closeModal('modal-small')">取消</button>
     <button class="btn btn-primary" onclick="doChangePassword()">儲存</button>`
  );
}

async function doChangePassword() {
  const cur = document.getElementById('sm-cur-pass').value;
  const np = document.getElementById('sm-new-pass').value;
  const np2 = document.getElementById('sm-new-pass2').value;
  if (np !== np2) { showToast('新密碼不一致'); return; }
  if (np.length < 6) { showToast('新密碼至少 6 碼'); return; }
  try {
    await API.changePassword(cur, np);
    closeModal('modal-small');
    showToast('密碼已更新');
  } catch(err) { showToast('錯誤：' + err.message); }
}
