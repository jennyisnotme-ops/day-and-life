'use strict';
let _dragId = null;
let _dragSrcDate = null;

function onDragStart(e, taskId) {
  _dragId = taskId;
  const el = e.currentTarget;
  _dragSrcDate = el.dataset.date;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  setTimeout(() => el.classList.add('dragging'), 0);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

async function onDrop(e, targetDate) {
  e.preventDefault();
  if (!_dragId) return;

  const taskId = _dragId;
  _dragId = null;

  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

  const task = S.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (_dragSrcDate !== targetDate) {
    // Move to different date
    try {
      const updated = await API.updateTask(taskId, { date: targetDate });
      Object.assign(task, updated);
      showToast(`已移到 ${targetDate}`);
      await reloadData();
      renderApp();
    } catch (err) {
      showToast('移動失敗：' + err.message);
    }
  } else {
    // Reorder within same day
    const container = e.currentTarget;
    const items = [...container.querySelectorAll('[data-id]')];
    const draggedEl = container.querySelector(`[data-id="${taskId}"]`);
    if (!draggedEl) return;
    const dropTarget = e.target.closest('[data-id]');
    if (dropTarget && dropTarget !== draggedEl) {
      container.insertBefore(draggedEl, dropTarget);
    }
    const ordered_ids = [...container.querySelectorAll('[data-id]')].map(el => parseInt(el.dataset.id));
    await API.reorderTasks(ordered_ids);
    await reloadData();
  }
}

function initDragOnTasks() {
  document.querySelectorAll('[draggable=true]').forEach(el => {
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      _dragId = null;
    });
  });
}
