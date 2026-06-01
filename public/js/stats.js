'use strict';
async function renderStatsView(container) {
  const calIds = getVisibleCalIds();
  const year = S.cursor.getFullYear();
  const month = S.cursor.getMonth() + 1;

  container.innerHTML = '<div class="empty">載入統計中...</div>';

  let data = [];
  if (calIds.length) {
    try { data = await API.getStats(calIds, year, month); } catch(e) {}
  }

  const totalTasks = data.reduce((s, r) => s + parseInt(r.total), 0);
  const totalDone = data.reduce((s, r) => s + parseInt(r.completed), 0);
  const pct = totalTasks ? Math.round(totalDone / totalTasks * 100) : 0;
  const maxTotal = data.length ? Math.max(...data.map(r => parseInt(r.total))) : 1;

  let html = `<div class="stats-view">
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-num">${totalTasks}</div>
        <div class="stat-label">本月總任務</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="color:#16a34a">${totalDone}</div>
        <div class="stat-label">已完成</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="color:${pct>=80?'#16a34a':pct>=50?'var(--accent)':'#dc2626'}">${pct}%</div>
        <div class="stat-label">完成率</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="color:var(--text2)">${totalTasks - totalDone}</div>
        <div class="stat-label">未完成</div>
      </div>
    </div>`;

  if (data.length) {
    html += `<div class="chart-card">
      <div class="chart-title">分類統計 — ${year}年${month}月</div>
      <div class="bar-chart">`;

    for (const row of data) {
      const total = parseInt(row.total);
      const done = parseInt(row.completed);
      const pctRow = total ? Math.round(done / total * 100) : 0;
      const width = Math.round(total / maxTotal * 100);
      const color = row.category_color || '#9e9e99';
      html += `<div class="bar-row">
        <div class="bar-label" title="${escHtml(row.category_name)}">${escHtml(row.category_name)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color}">
            <span>${done}/${total}</span>
          </div>
        </div>
        <div class="bar-count">${pctRow}%</div>
      </div>`;
    }
    html += '</div></div>';
  } else {
    html += '<div class="chart-card"><div class="empty">本月尚無任務資料</div></div>';
  }

  html += '</div>';
  container.innerHTML = html;
}
