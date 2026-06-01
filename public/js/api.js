'use strict';
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const API = {
  me: () => apiFetch('/api/me'),
  login: (username, password) => apiFetch('/api/login', { method:'POST', body:{ username, password } }),
  logout: () => apiFetch('/api/logout', { method:'POST' }),
  changePassword: (current_password, new_password) => apiFetch('/api/me/password', { method:'PATCH', body:{ current_password, new_password } }),

  getSettings: () => apiFetch('/api/settings'),
  saveSettings: (data) => apiFetch('/api/settings', { method:'PUT', body: data }),

  getUsers: () => apiFetch('/api/users'),
  createUser: (data) => apiFetch('/api/users', { method:'POST', body: data }),
  updateUser: (id, data) => apiFetch(`/api/users/${id}`, { method:'PATCH', body: data }),
  deleteUser: (id) => apiFetch(`/api/users/${id}`, { method:'DELETE' }),

  getCalendars: () => apiFetch('/api/calendars'),
  createCalendar: (data) => apiFetch('/api/calendars', { method:'POST', body: data }),
  updateCalendar: (id, data) => apiFetch(`/api/calendars/${id}`, { method:'PATCH', body: data }),
  deleteCalendar: (id) => apiFetch(`/api/calendars/${id}`, { method:'DELETE' }),
  addMember: (calId, data) => apiFetch(`/api/calendars/${calId}/members`, { method:'POST', body: data }),
  removeMember: (calId, uid) => apiFetch(`/api/calendars/${calId}/members/${uid}`, { method:'DELETE' }),

  getCategories: (calId) => apiFetch(`/api/categories${calId ? '?calendar_id='+calId : ''}`),
  createCategory: (data) => apiFetch('/api/categories', { method:'POST', body: data }),
  updateCategory: (id, data) => apiFetch(`/api/categories/${id}`, { method:'PATCH', body: data }),
  deleteCategory: (id) => apiFetch(`/api/categories/${id}`, { method:'DELETE' }),

  getTasks: (calIds, dateFrom, dateTo) => apiFetch(`/api/tasks?calendar_ids=${calIds.join(',')}&date_from=${dateFrom}&date_to=${dateTo}`),
  createTask: (data) => apiFetch('/api/tasks', { method:'POST', body: data }),
  updateTask: (id, data) => apiFetch(`/api/tasks/${id}`, { method:'PATCH', body: data }),
  deleteTask: (id) => apiFetch(`/api/tasks/${id}`, { method:'DELETE' }),
  reorderTasks: (ordered_ids) => apiFetch('/api/tasks/reorder', { method:'POST', body:{ ordered_ids } }),

  getNotes: (calId, dateFrom, dateTo) => apiFetch(`/api/notes?calendar_id=${calId}&date_from=${dateFrom}&date_to=${dateTo}`),
  saveNote: (data) => apiFetch('/api/notes', { method:'PUT', body: data }),

  getStats: (calIds, year, month) => apiFetch(`/api/stats?calendar_ids=${calIds.join(',')}&year=${year}&month=${month}`),
};
