/* ============================================================
 * app.js — 合心（云端版）
 * 登录 → 拉全量入缓存 → 同步渲染；写操作 await 云端并回读校验
 * ============================================================ */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const state = {
    mgmt: false,
    diaryEdit: null, draftDiaryImgs: [],
    placeEdit: null, draftPlaceImgs: [], placeCat: 'other',
    map: null, mapReady: false,
    calYear: new Date().getFullYear(), calMonth: new Date().getMonth(), dayKey: null,
    loveEdit: null, draftLoveImgs: [],
    timerInterval: null, joyImg: null, stickyColor: 'pink'
  };

  /* ---------- 工具 ---------- */
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function openModal(id) { $('#' + id).classList.add('show'); }
  function closeModal(id) { $('#' + id).classList.remove('show'); }
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }

  /* ---------- 视图切换 ---------- */
  function switchView(name) {
    exitLoveView();
    $$('.view').forEach((v) => v.classList.remove('active'));
    const sec = $('#view-' + name); if (sec) sec.classList.add('active');
    $$('.nav-link').forEach((l) => l.classList.toggle('active', l.dataset.view === name));
    if (name === 'places') initMapIfNeeded();
    if (name === 'calendar') renderCalendar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.nav-link').forEach((l) => l.addEventListener('click', (e) => { e.preventDefault(); switchView(l.dataset.view); }));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); switchView(b.dataset.goto); }));
  $('#brandBtn').addEventListener('click', () => switchView('index'));

  /* ---------- 管理（登录即可编辑，无需二次密码） ---------- */
  function updateMgmtUI() {
    document.body.classList.toggle('mgmt', state.mgmt);
    $('#mgmtToggle').textContent = state.mgmt ? '只读' : '编辑';
  }
  $('#mgmtToggle').addEventListener('click', () => {
    state.mgmt = !state.mgmt;
    updateMgmtUI(); renderAll();
    toast(state.mgmt ? '可编辑' : '已切到只读');
  });

  /* ---------- 封面 ---------- */
  function formatTogether(set) {
    if (!set.since) return { days: 0, timer: '00:00:00' };
    const start = new Date(set.since + 'T00:00:00').getTime();
    const diff = Date.now() - start;
    const days = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return { days: days >= 0 ? days : 0, timer: pad(h) + ':' + pad(m) + ':' + pad(s) };
  }
  function renderCover() {
    const set = Store.getSettings();
    const a = set.nameA || '', b = set.nameB || '';
    $('#coverNames').textContent = (a && b) ? `${a} 与 ${b}` : '合心';
    const t = formatTogether(set);
    $('#coverDays').innerHTML = `<span class='days-num'>${t.days}</span><small>天</small><span class='timer'>${t.timer}</span>`;
    $('#navDays').textContent = t.days ? `在一起 ${t.days} 天` : '';
    $('#coverSub').textContent = set.since ? `自 ${Store.fmtDate(set.since)} 起` : '';
    const diary = Store.getDiary(), notes = Store.getNotes(), places = Store.getPlaces();
    $('#idxDiary').textContent = diary.length ? diary[0].title : '还没有';
    $('#idxNotes').textContent = `${notes.length} 则`;
    $('#idxCal').textContent = set.since ? `自 ${Store.fmtDate(set.since)}` : '—';
    $('#idxPlaces').textContent = `${places.length} 处`;
    renderStickers();
    clearInterval(state.timerInterval);
    if (set.since) {
      state.timerInterval = setInterval(() => {
        const nt = formatTogether(Store.getSettings());
        const cd = $('#coverDays');
        if (cd) cd.innerHTML = `<span class='days-num'>${nt.days}</span><small>天</small><span class='timer'>${nt.timer}</span>`;
      }, 1000);
    }
  }

  function renderJoyPreview() {
    const box = $('#joyPreview'); if (!box) return;
    box.innerHTML = state.joyImg ? `<img src='${state.joyImg}' alt=''><button class='rm' id='joyRmImg' title='移除'>×</button>` : '';
    const rm = $('#joyRmImg'); if (rm) rm.addEventListener('click', () => { state.joyImg = null; renderJoyPreview(); });
  }
  function onJoyFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      compressImage(f).then((url) => { state.joyImg = url; renderJoyPreview(); });
    }
  }
  async function saveJoy() {
    const text = $('#joyText').value.trim();
    if (!text && !state.joyImg) { toast('写点什么或贴张图再保存'); return; }
    const btn = $('#joySaveBtn'); const old = btn.textContent; btn.textContent = '保存中…';
    try {
      await Store.addNote({ text: text || '（一张图）', images: state.joyImg ? [state.joyImg] : [] });
      $('#joyText').value = ''; state.joyImg = null; renderJoyPreview();
      toast('已贴到随笔'); renderAll();
    } catch (e) { toast('保存失败：' + (e.message || '请重试')); }
    finally { btn.textContent = old; }
  }

  const STICKY_COLORS = ['pink', 'yellow', 'blue', 'green', 'lavender'];
  // 没有记录坐标的旧便签按"边缘环形"分布，避免每次渲染乱跳
  function fallbackPos(i) {
    const zones = [[10, 14], [84, 18], [16, 70], [80, 66], [50, 8], [46, 82], [6, 44], [90, 46]];
    const z = zones[i % zones.length];
    return { x: z[0] + (i >= zones.length ? (i % 5) * 2 : 0), y: z[1] + (i >= zones.length ? (i % 3) * 4 : 0) };
  }
  function renderStickers() {
    const box = $('#stickyLayer'); if (!box) return;
    box.innerHTML = '';
    const list = Store.getStickers();
    const today = todayISO();
    list.forEach((s, i) => {
      const el = document.createElement('div');
      const color = STICKY_COLORS.includes(s.color) ? s.color : 'pink';
      const pos = (s.x != null && s.y != null) ? { x: s.x, y: s.y } : fallbackPos(i);
      el.className = 'sticky ' + color + (s.date === today ? '' : ' expired');
      el.style.setProperty('--x', pos.x + '%');
      el.style.setProperty('--y', pos.y + '%');
      el.style.animationDelay = (i * 0.04) + 's';
      el.innerHTML = `<span class='s-text'>${esc(s.text)}</span><button class='del' title='删除'>×</button>`;
      el.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('删除这张便签？')) { Store.removeSticker(s.id).then(() => { toast('已删除'); renderAll(); }); }
      });
      box.appendChild(el);
    });
  }
  function toggleStickyForm(show) {
    const form = $('#stickyForm'); const btn = $('#stickyAddBtn');
    if (!form) return;
    const open = (typeof show === 'boolean') ? show : form.hidden;
    form.hidden = !open;
    if (btn) btn.hidden = open;
    if (open && $('#stickyText')) $('#stickyText').focus();
  }
  // 在背景的"安全区"随机取点：避开正中（合心/天数）区域，偏向左右边缘与上下角
  function pickStickyPos() {
    const safe = [
      [0.04, 0.10, 0.30, 0.40], [0.68, 0.10, 0.94, 0.40],
      [0.06, 0.62, 0.32, 0.90], [0.66, 0.62, 0.92, 0.90],
      [0.34, 0.04, 0.62, 0.10]
    ];
    const r = safe[Math.floor(Math.random() * safe.length)];
    const x = +(r[0] + Math.random() * (r[2] - r[0])).toFixed(2);
    const y = +(r[1] + Math.random() * (r[3] - r[1])).toFixed(2);
    return { x: Math.round(x * 100), y: Math.round(y * 100) };
  }
  async function saveSticky() {
    const text = $('#stickyText').value.trim();
    if (!text) { toast('便签写点什么'); return; }
    const btn = $('#stickySaveBtn'); const old = btn.textContent; btn.textContent = '贴上…';
    try {
      const pos = pickStickyPos();
      await Store.addSticker({ text, color: state.stickyColor, date: todayISO(), x: pos.x, y: pos.y });
      $('#stickyText').value = ''; toggleStickyForm(false); toast('便签已贴上'); renderAll();
    } catch (e) { toast('保存失败：' + (e.message || '请重试')); }
    finally { btn.textContent = old; }
  }

  /* ---------- 日记 ---------- */
  function renderDiary() {
    const list = Store.getDiary();
    const box = $('#diaryList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p style="color:var(--ink-soft);padding:20px 4px">还没有日记，去写第一篇吧。</p>'; return; }
    list.forEach((d, i) => {
      const el = document.createElement('div');
      el.className = 'entry';
      el.style.animationDelay = (i * 0.05) + 's';
      let imgs = '';
      if (d.images && d.images.length) imgs = `<div class="entry-imgs">${d.images.slice(0, 4).map((img) => `<img src="${img}" alt="">`).join('')}</div>`;
      el.innerHTML = `
        <div class="entry-date">${Store.fmtDate(d.date)}</div>
        <div class="entry-title">${esc(d.title)}</div>
        <div class="entry-excerpt">${esc(d.content || '').slice(0, 90)}</div>
        ${imgs}
        <div class="entry-actions mgmt-only">
          <button class="link" data-edit>编辑</button>
          <button class="link danger" data-del>删除</button>
        </div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit]')) { e.stopPropagation(); openDiaryModal(d); return; }
        if (e.target.closest('[data-del]')) { e.stopPropagation(); delDiary(d); return; }
        openRead('diary', d.id);
      });
      $$('img', el).forEach((imgEl) => {
        imgEl.addEventListener('click', (e) => { e.stopPropagation(); viewImage(imgEl.src); });
      });
      box.appendChild(el);
    });
  }
  async function openDiaryModal(entry, presetDate) {
    state.diaryEdit = entry || null;
    state.draftDiaryImgs = [];
    $('#diaryModalTitle').textContent = entry ? '编辑日记' : '写日记';
    $('#dTitle').value = entry ? entry.title : '';
    $('#dDate').value = entry ? entry.date : (presetDate || todayISO());
    $('#dMood').value = entry ? (entry.mood || '') : '';
    $('#dContent').value = entry ? entry.content : '';
    if (entry && entry.images) for (const img of entry.images) { state.draftDiaryImgs.push({ url: img }); }
    renderDiaryThumbs(); openModal('diaryModal');
  }
  function renderDiaryThumbs() {
    const row = $('#dThumbs'); row.innerHTML = '';
    state.draftDiaryImgs.forEach((it) => {
      const t = document.createElement('div'); t.className = 'thumb';
      t.innerHTML = `<img src="${it.url}" alt=""><button class="rm" title="移除">×</button>`;
      t.querySelector('.rm').addEventListener('click', () => {
        state.draftDiaryImgs = state.draftDiaryImgs.filter((x) => x !== it);
        renderDiaryThumbs();
      });
      row.appendChild(t);
    });
  }
  function onDiaryFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      compressImage(f).then((dataURL) => { state.draftDiaryImgs.push({ url: dataURL }); renderDiaryThumbs(); });
    }
  }
  async function saveDiary() {
    const title = $('#dTitle').value.trim();
    if (!title) { toast('先写个标题'); return; }
    const btn = $('#dSave'); const old = btn.textContent; btn.textContent = '保存中…';
    try {
      const imgIds = state.draftDiaryImgs.map((it) => it.url);
      const data = { title, date: $('#dDate').value || todayISO(), mood: $('#dMood').value.trim(), content: $('#dContent').value, images: imgIds };
      if (state.diaryEdit) { await Store.updateDiary(state.diaryEdit.id, data); toast('已更新'); }
      else { await Store.addDiary(data); toast('已保存'); }
      closeModal('diaryModal'); renderAll();
    } catch (e) { toast('保存失败：' + (e.message || '网络问题，请重试')); }
    finally { btn.textContent = old; }
  }
  async function delDiary(d) {
    if (!confirm(`删除日记「${d.title}」？此操作不可恢复。`)) return;
    try { await Store.removeDiary(d.id); toast('已删除'); renderAll(); }
    catch (e) { toast('删除失败：' + (e.message || '请重试')); }
  }

  /* ---------- 随笔 ---------- */
  function renderNotes() {
    const list = Store.getNotes();
    const box = $('#notesList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p style="color:var(--ink-soft);padding:20px 4px">还没有随笔，此刻想到什么就写一句吧。</p>'; return; }
    list.forEach((n, i) => {
      const el = document.createElement('div');
      el.className = 'note';
      el.style.animationDelay = (i * 0.05) + 's';
      el.innerHTML = `<div class="note-text">${esc(n.text)}</div>
        <div class="note-meta"><span>${Store.fmtDateTime(n.createdAt)}</span>
        <button class="link danger note-del mgmt-only" data-del>删除</button></div>`;
      const db = el.querySelector('[data-del]');
      if (db) db.addEventListener('click', async (e) => {
        e.stopPropagation(); if (!confirm('删除这条随笔？')) return;
        try { await Store.removeNote(n.id); renderAll(); } catch (err) { toast('删除失败：' + (err.message || '请重试')); }
      });
      box.appendChild(el);
    });
  }
  async function saveNote() {
    const text = $('#noteInput').value.trim();
    if (!text) { toast('写点什么再留存'); return; }
    const btn = $('#noteSave'); const old = btn.textContent; btn.textContent = '留存中…';
    try { await Store.addNote({ text }); $('#noteInput').value = ''; $('#noteHint').textContent = ''; toast('已留存'); renderAll(); }
    catch (e) { toast('留存失败：' + (e.message || '请重试')); }
    finally { btn.textContent = old; }
  }

  /* ---------- 私爱 ---------- */
  function renderLove() {
    const list = Store.getLove();
    const box = $('#loveList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p style="color:var(--ink-soft);padding:20px 4px">还没有写下的话，点上方「发布」收进来吧。</p>'; return; }
    list.forEach((v, i) => {
      const el = document.createElement('div');
      el.className = 'entry love-entry';
      el.style.animationDelay = (i * 0.05) + 's';
      let imgs = '';
      if (v.images && v.images.length) imgs = `<div class="entry-imgs">${v.images.slice(0, 4).map((img) => `<img src="${img}" alt="">`).join('')}</div>`;
      const titleHtml = v.title ? `<div class="entry-title">${esc(v.title)}</div>` : '';
      el.innerHTML = `
        <div class="entry-date">${Store.fmtDate(v.date)}</div>
        ${titleHtml}
        <div class="entry-excerpt">${esc(v.content || '').slice(0, 90)}</div>
        ${imgs}
        <div class="entry-actions mgmt-only">
          <button class="link" data-edit>编辑</button>
          <button class="link danger" data-del>删除</button>
        </div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit]')) { e.stopPropagation(); openLoveModal(v); return; }
        if (e.target.closest('[data-del]')) { e.stopPropagation(); delLove(v); return; }
        openRead('love', v.id);
      });
      $$('img', el).forEach((imgEl) => {
        imgEl.addEventListener('click', (e) => { e.stopPropagation(); viewImage(imgEl.src); });
      });
      box.appendChild(el);
    });
  }
  function exitLoveView() {
    const lv = $('#loveView'); if (lv) lv.hidden = true;
    const dl = $('#diaryList'); if (dl) dl.style.display = '';
    document.body.classList.remove('love-open');
  }
  function enterLoveView() {
    $('#diaryList').style.display = 'none';
    $('#loveView').hidden = false;
    document.body.classList.add('love-open');
    renderLove();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toggleLoveView() {
    if (document.body.classList.contains('love-open')) exitLoveView();
    else enterLoveView();
  }
  async function openLoveModal(entry) {
    state.loveEdit = entry || null;
    state.draftLoveImgs = [];
    $('#loveModalTitle').textContent = entry ? '编辑' : '发布';
    $('#lvTitle').value = entry ? entry.title : '';
    $('#lvDate').value = entry ? entry.date : todayISO();
    $('#lvMood').value = entry ? (entry.mood || '') : '';
    $('#lvContent').value = entry ? entry.content : '';
    if (entry && entry.images) for (const img of entry.images) { state.draftLoveImgs.push({ url: img }); }
    renderLoveThumbs(); openModal('loveModal');
  }
  function renderLoveThumbs() {
    const row = $('#lvThumbs'); row.innerHTML = '';
    state.draftLoveImgs.forEach((it) => {
      const t = document.createElement('div'); t.className = 'thumb';
      t.innerHTML = `<img src="${it.url}" alt=""><button class="rm" title="移除">×</button>`;
      t.querySelector('.rm').addEventListener('click', () => {
        state.draftLoveImgs = state.draftLoveImgs.filter((x) => x !== it);
        renderLoveThumbs();
      });
      row.appendChild(t);
    });
  }
  function onLoveFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      compressImage(f).then((dataURL) => { state.draftLoveImgs.push({ url: dataURL }); renderLoveThumbs(); });
    }
  }
  async function saveLove() {
    const content = $('#lvContent').value.trim();
    if (!content) { toast('先写点什么'); return; }
    const btn = $('#lvSave'); const old = btn.textContent; btn.textContent = '保存中…';
    try {
      const imgIds = state.draftLoveImgs.map((it) => it.url);
      const data = { title: $('#lvTitle').value.trim(), date: $('#lvDate').value || todayISO(), mood: $('#lvMood').value.trim(), content, images: imgIds };
      if (state.loveEdit) { await Store.updateLove(state.loveEdit.id, data); toast('已更新'); }
      else { await Store.addLove(data); toast('已发布'); }
      closeModal('loveModal'); renderAll(); renderLove();
    } catch (e) { toast('保存失败：' + (e.message || '网络问题，请重试')); }
    finally { btn.textContent = old; }
  }
  async function delLove(v) {
    if (!confirm('删除这条私密文字？此操作不可恢复。')) return;
    try { await Store.removeLove(v.id); toast('已删除'); renderAll(); renderLove(); }
    catch (e) { toast('删除失败：' + (e.message || '请重试')); }
  }

  /* ---------- 日历 ---------- */
  function buildDayIndex() {
    const map = {};
    const touch = (k) => (map[k] = map[k] || { diary: 0, note: 0, place: 0 });
    Store.getDiary().forEach((d) => { if (d.date) touch(d.date).diary++; });
    Store.getPlaces().forEach((p) => { if (p.date) touch(p.date).place++; });
    Store.getNotes().forEach((n) => { touch(Store.dayKeyOf('note', n)).note++; });
    return map;
  }
  function renderCalendar() {
    const y = state.calYear, m = state.calMonth;
    $('#calMonth').textContent = `${y} 年 ${m + 1} 月`;
    const set = Store.getSettings();
    const days = Store.daysTogether(set.since);
    $('#calTogether').textContent = days ? `在一起 ${days} 天` : '';
    const startDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const idx = buildDayIndex();
    const since = set.since, todayK = todayISO();
    const grid = $('#calGrid'); grid.innerHTML = '';
    for (let i = 0; i < startDow; i++) { const c = document.createElement('div'); c.className = 'cal-cell empty'; grid.appendChild(c); }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cal-cell';
      cell.dataset.key = key;
      if (key === todayK) cell.classList.add('today');
      if (key === since) cell.classList.add('anchor');
      const marks = idx[key];
      if (marks && (marks.diary || marks.note || marks.place)) {
        let dots = '';
        if (marks.diary) dots += '<i class="dot d-diary"></i>';
        if (marks.note) dots += '<i class="dot d-note"></i>';
        if (marks.place) dots += '<i class="dot d-place"></i>';
        cell.classList.add('has');
        cell.innerHTML = `<span class="cal-num">${d}</span><span class="cal-dots">${dots}</span>`;
      } else {
        cell.innerHTML = `<span class="cal-num">${d}</span>`;
      }
      cell.style.animationDelay = ((startDow + d - 1) * 0.012) + 's';
      cell.addEventListener('click', () => openDayPanel(key));
      grid.appendChild(cell);
    }
    if (state.dayKey) { const sel = grid.querySelector(`[data-key="${state.dayKey}"]`); if (sel) sel.classList.add('sel'); }
  }
  function openDayPanel(key) {
    state.dayKey = key;
    $$('.cal-cell.sel').forEach((c) => c.classList.remove('sel'));
    const cell = $('#calGrid').querySelector(`[data-key="${key}"]`); if (cell) cell.classList.add('sel');
    const dt = new Date(key + 'T00:00:00');
    $('#dayPanelTitle').textContent = `${Store.fmtDate(key)} · ${WEEK[dt.getDay()]}`;
    const diary = Store.getDiary().filter((d) => d.date === key);
    const places = Store.getPlaces().filter((p) => p.date === key);
    const notes = Store.getNotes().filter((n) => Store.dayKeyOf('note', n) === key);
    const body = $('#dayPanelBody');
    if (!diary.length && !places.length && !notes.length) {
      body.innerHTML = '<p class="day-empty">这一天还没有记录。</p>';
    } else {
      let html = '';
      diary.forEach((d) => { html += `<div class="day-item" data-kind="diary" data-id="${d.id}"><span class="di-tag">日记</span><span class="di-title">${esc(d.title)}</span><span class="di-ex">${esc((d.content || '').slice(0, 40))}</span></div>`; });
      places.forEach((p) => { html += `<div class="day-item" data-kind="place" data-id="${p.id}"><span class="di-tag">足迹</span><span class="di-title">${Store.catOf(p.cat).icon} ${esc(p.name)}</span><span class="di-ex">${esc(p.address || '')}</span></div>`; });
      notes.forEach((n) => { html += `<div class="day-item note-item"><span class="di-tag">随笔</span><span class="di-note">${esc(n.text)}</span></div>`; });
      body.innerHTML = html;
      $$('.day-item[data-kind]', body).forEach((it) => it.addEventListener('click', () => openRead(it.dataset.kind, it.dataset.id)));
    }
    const foot = $('#dayPanelFoot');
    foot.innerHTML = `<button class="link" id="dayAddDiary">在这天写日记</button><button class="link" id="dayAddPlace">在这天加足迹</button>`;
    $('#dayAddDiary').addEventListener('click', () => openDiaryModal(null, key));
    $('#dayAddPlace').addEventListener('click', () => openPlaceModal(null, key));
    const panel = $('#dayPanel');
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
  }
  function closeDayPanel() {
    const panel = $('#dayPanel'); panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
    state.dayKey = null;
    $$('.cal-cell.sel').forEach((c) => c.classList.remove('sel'));
  }

  /* ---------- 足迹地图 ---------- */
  function initMapIfNeeded() {
    if (typeof L === 'undefined') { toast('地图需联网加载'); return; }
    if (state.mapReady) { setTimeout(() => state.map.invalidateSize(), 60); renderMapMarkers(); return; }
    const map = L.map('map', { scrollWheelZoom: false }).setView([30, 115], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    state.map = map; state.mapReady = true;
    setTimeout(() => map.invalidateSize(), 60);
    renderMapMarkers();
  }
  function renderMapMarkers() {
    if (!state.map) return;
    state.map.eachLayer((l) => { if (l instanceof L.Marker) state.map.removeLayer(l); });
    const places = Store.getPlaces().filter((p) => p.lat && p.lng);
    const bounds = [];
    places.forEach((p) => {
      const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      bounds.push([lat, lng]);
      const links = mapLinks(p);
      const cat = Store.catOf(p.cat);
      L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="pin"><span class="pin-emoji">${cat.icon}</span></div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) })
        .addTo(state.map).bindPopup(
          `<div class="pin-pop-title">${cat.icon} ${esc(p.name)}</div>
           <div class="pin-pop-sub">${esc(p.address || '')} · ${Store.fmtDate(p.date)}</div>
           <div class="pin-pop-links">
             <a href="${links.amap}" target="_blank">高德</a>
             <a href="${links.baidu}" target="_blank">百度</a>
             <a href="${links.google}" target="_blank">Google</a>
             <a href="${links.apple}" target="_blank">Apple</a>
           </div>`);
    });
    if (bounds.length === 1) state.map.setView(bounds[0], 12);
    else if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [50, 50] });
  }
  function mapLinks(p) {
    const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
    const name = encodeURIComponent(p.name || ''), addr = encodeURIComponent(p.address || '');
    return {
      amap: `https://uri.amap.com/marker?position=${lng},${lat}&name=${name}&src=ourdiary&coordinate=wgs84&callnative=1`,
      baidu: `http://api.map.baidu.com/marker?location=${lat},${lng}&title=${name}&content=${addr}&output=html&coord_type=wgs84&src=ourdiary`,
      google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      apple: `https://maps.apple.com/?q=${lat},${lng}`
    };
  }
  function renderPlaces() {
    const list = Store.getPlaces();
    const box = $('#placesList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p style="color:var(--ink-soft);padding:20px 4px">还没有足迹，去标记一个地方吧。</p>'; return; }
    list.forEach((p, i) => {
      const el = document.createElement('div'); el.className = 'entry';
      el.style.animationDelay = (i * 0.05) + 's';
      let imgs = '';
      if (p.images && p.images.length) imgs = `<div class="entry-imgs">${p.images.slice(0, 4).map((img) => `<img src="${img}" alt="">`).join('')}</div>`;
      el.innerHTML = `
        <div class="entry-date">${Store.fmtDate(p.date)}</div>
        <div class="entry-title"><span class="entry-icon">${Store.catOf(p.cat).icon}</span>${esc(p.name)}</div>
        <div class="entry-excerpt">${esc(p.address || (p.note || '')).slice(0, 60)}</div>
        ${imgs}
        <div class="entry-actions mgmt-only">
          <button class="link" data-edit>编辑</button>
          <button class="link danger" data-del>删除</button>
        </div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit]')) { e.stopPropagation(); openPlaceModal(p); return; }
        if (e.target.closest('[data-del]')) { e.stopPropagation(); delPlace(p); return; }
        openRead('place', p.id);
      });
      $$('img', el).forEach((imgEl) => {
        imgEl.addEventListener('click', (e) => { e.stopPropagation(); viewImage(imgEl.src); });
      });
      box.appendChild(el);
    });
  }
  async function openPlaceModal(entry, presetDate) {
    state.placeEdit = entry || null;
    state.draftPlaceImgs = [];
    state.placeCat = entry ? (entry.cat || 'other') : 'other';
    $('#placeModalTitle').textContent = entry ? '编辑足迹' : '添加足迹';
    $('#pName').value = entry ? entry.name : '';
    $('#pSearch').value = '';
    $('#pLat').value = entry ? entry.lat : '';
    $('#pLng').value = entry ? entry.lng : '';
    $('#pAddress').value = entry ? entry.address : '';
    $('#pDate').value = entry ? entry.date : (presetDate || todayISO());
    $('#pNote').value = entry ? entry.note : '';
    renderPlaceCats();
    if (entry && entry.images) for (const img of entry.images) { state.draftPlaceImgs.push({ url: img }); }
    renderPlaceThumbs(); openModal('placeModal');
  }
  function renderPlaceCats() {
    const box = $('#pCats'); box.innerHTML = '';
    Store.PLACE_CATS.forEach((c) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cat-chip' + (c.id === state.placeCat ? ' active' : '');
      el.innerHTML = `<span class="ci">${c.icon}</span>${c.label}`;
      el.addEventListener('click', () => { state.placeCat = c.id; renderPlaceCats(); });
      box.appendChild(el);
    });
  }
  function renderPlaceThumbs() {
    const row = $('#pThumbs'); row.innerHTML = '';
    state.draftPlaceImgs.forEach((it) => {
      const t = document.createElement('div'); t.className = 'thumb';
      t.innerHTML = `<img src="${it.url}" alt=""><button class="rm" title="移除">×</button>`;
      t.querySelector('.rm').addEventListener('click', () => {
        state.draftPlaceImgs = state.draftPlaceImgs.filter((x) => x !== it);
        renderPlaceThumbs();
      });
      row.appendChild(t);
    });
  }
  function onPlaceFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      compressImage(f).then((dataURL) => { state.draftPlaceImgs.push({ url: dataURL }); renderPlaceThumbs(); });
    }
  }
  async function geocode() {
    const q = $('#pSearch').value.trim();
    if (!q) { toast('先输入地点名'); return; }
    const btn = $('#pSearchBtn'); const old = btn.textContent; btn.textContent = '定位中';
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(q), { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!data.length) { toast('未找到，可手动填写经纬度'); return; }
      const item = data[0];
      $('#pLat').value = parseFloat(item.lat).toFixed(6);
      $('#pLng').value = parseFloat(item.lon).toFixed(6);
      if (!$('#pName').value) $('#pName').value = item.name || item.display_name.split(',')[0];
      if (!$('#pAddress').value) $('#pAddress').value = item.display_name;
      toast('已定位');
    } catch (e) { toast('定位失败，可手动填写'); }
    finally { btn.textContent = old; }
  }
  async function savePlace() {
    const name = $('#pName').value.trim();
    if (!name) { toast('先写地点名'); return; }
    const lat = parseFloat($('#pLat').value), lng = parseFloat($('#pLng').value);
    if (isNaN(lat) || isNaN(lng)) { toast('先定位或填写经纬度'); return; }
    const btn = $('#pSave'); const old = btn.textContent; btn.textContent = '保存中…';
    try {
      const imgIds = state.draftPlaceImgs.map((it) => it.url);
      const data = { name, lat: lat.toFixed(6), lng: lng.toFixed(6), address: $('#pAddress').value, date: $('#pDate').value || todayISO(), note: $('#pNote').value, cat: state.placeCat, images: imgIds };
      if (state.placeEdit) { await Store.updatePlace(state.placeEdit.id, data); toast('已更新'); }
      else { await Store.addPlace(data); toast('已添加'); }
      closeModal('placeModal'); renderAll();
    } catch (e) { toast('保存失败：' + (e.message || '网络问题，请重试')); }
    finally { btn.textContent = old; }
  }
  async function delPlace(p) {
    if (!confirm(`删除足迹「${p.name}」？`)) return;
    try { await Store.removePlace(p.id); toast('已删除'); renderAll(); }
    catch (e) { toast('删除失败：' + (e.message || '请重试')); }
  }

  /* ---------- 阅读 / 详情 ---------- */
  async function openRead(kind, id) {
    let obj, html = '';
    if (kind === 'diary') {
      obj = Store.getDiary().find((d) => d.id === id); if (!obj) return;
      $('#detailTitle').textContent = obj.title;
      let imgs = '';
      if (obj.images && obj.images.length) { const wrap = document.createElement('div'); wrap.className = 'd-imgs';
        for (const iid of obj.images) { const u = await Store.getImageURL(iid); if (!u) continue; const im = document.createElement('img'); im.src = u; im.addEventListener('click', () => viewImage(iid)); wrap.appendChild(im); }
        imgs = wrap.outerHTML; }
      html = `<div class="d-meta">${Store.fmtDate(obj.date)}${obj.mood ? ' · ' + esc(obj.mood) : ''}</div>
        <div class="d-content">${linkify(obj.content || '')}</div>${imgs}`;
    } else if (kind === 'love') {
      obj = Store.getLove().find((v) => v.id === id); if (!obj) return;
      $('#detailTitle').textContent = obj.title || '';
      let imgs = '';
      if (obj.images && obj.images.length) { const wrap = document.createElement('div'); wrap.className = 'd-imgs';
        for (const src of obj.images) { const im = document.createElement('img'); im.src = src; im.addEventListener('click', () => viewImage(src)); wrap.appendChild(im); }
        imgs = wrap.outerHTML; }
      html = `<div class="d-meta">${Store.fmtDate(obj.date)}${obj.mood ? ' · ' + esc(obj.mood) : ''}</div>
        <div class="d-content love-content">${linkify(obj.content || '')}</div>${imgs}`;
    } else {
      obj = Store.getPlaces().find((p) => p.id === id); if (!obj) return;
      $('#detailTitle').textContent = Store.catOf(obj.cat).icon + ' ' + obj.name;
      const links = mapLinks(obj);
      let imgs = '';
      if (obj.images && obj.images.length) { const wrap = document.createElement('div'); wrap.className = 'd-imgs';
        for (const src of obj.images) { const im = document.createElement('img'); im.src = src; im.addEventListener('click', () => viewImage(src)); wrap.appendChild(im); }
        imgs = wrap.outerHTML; }
      html = `<div class="d-meta">${Store.fmtDate(obj.date)} · ${esc(obj.address || '')}</div>
        <div class="d-content">${linkify(obj.note || '')}</div>${imgs}
        <div class="map-links">
          <a href="${links.amap}" target="_blank">高德地图</a>
          <a href="${links.baidu}" target="_blank">百度地图</a>
          <a href="${links.google}" target="_blank">Google 地图</a>
          <a href="${links.apple}" target="_blank">Apple 地图</a>
        </div>`;
    }
    $('#detailBody').innerHTML = html;
    if (state.mgmt) {
      $('#detailFoot').innerHTML = `<button class="link" id="dEdit">编辑</button><button class="link danger" id="dDelete">删除</button>`;
      $('#dEdit').addEventListener('click', () => { closeModal('detailModal'); if (kind === 'diary') openDiaryModal(obj); else if (kind === 'love') openLoveModal(obj); else openPlaceModal(obj); });
      $('#dDelete').addEventListener('click', () => { closeModal('detailModal'); if (kind === 'diary') delDiary(obj); else if (kind === 'love') delLove(obj); else delPlace(obj); });
    } else { $('#detailFoot').innerHTML = ''; }
    openModal('detailModal');
  }
  function viewImage(src) {
    $('#imgBig').src = src; openModal('imgModal');
  }

  /* ---------- 设置 / 备份 ---------- */
  function loadSettingsForm() {
    const s = Store.getSettings();
    $('#setNameA').value = s.nameA || '';
    $('#setNameB').value = s.nameB || '';
    $('#setSince').value = s.since || '';
  }
  async function saveSettings() {
    const s = Store.getSettings();
    s.nameA = $('#setNameA').value.trim();
    s.nameB = $('#setNameB').value.trim();
    s.since = $('#setSince').value;
    try { await Store.saveSettings(s); toast('已保存'); renderAll(); }
    catch (e) { toast('保存失败：' + (e.message || '请重试')); }
  }
  async function doExport() {
    try {
      const data = await Store.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'hearts-diary-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); URL.revokeObjectURL(url);
      toast('已导出备份');
    } catch (e) { toast('导出失败：' + (e.message || '请重试')); }
  }
  function doImport() { $('#importFile').click(); }
  async function onImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      await Store.importAll(JSON.parse(text));
      toast('已从备份恢复'); renderAll();
    } catch (err) { toast('恢复失败：' + err.message); }
    finally { e.target.value = ''; }
  }

  /* ---------- 统一渲染 ---------- */
  function renderAll() {
    renderCover(); renderDiary(); renderNotes(); renderPlaces();
    if (state.mapReady) renderMapMarkers();
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    $('#addDiaryBtn').addEventListener('click', () => openDiaryModal(null));
    $('#addPlaceBtn').addEventListener('click', () => openPlaceModal(null));
    $('#loveEnterBtn').addEventListener('click', toggleLoveView);
    $('#addLoveBtn').addEventListener('click', () => openLoveModal(null));
    $('#lvSave').addEventListener('click', saveLove);
    $('#lvPick').addEventListener('click', () => $('#lvFiles').click());
    $('#lvFiles').addEventListener('change', (e) => { onLoveFiles(e.target.files); e.target.value = ''; });
    $('#dSave').addEventListener('click', saveDiary);
    $('#pSave').addEventListener('click', savePlace);
    $('#dPick').addEventListener('click', () => $('#dFiles').click());
    $('#pPick').addEventListener('click', () => $('#pFiles').click());
    $('#dFiles').addEventListener('change', (e) => { onDiaryFiles(e.target.files); e.target.value = ''; });
    $('#pFiles').addEventListener('change', (e) => { onPlaceFiles(e.target.files); e.target.value = ''; });
    $('#pSearchBtn').addEventListener('click', geocode);
    $('#pSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); geocode(); } });
    $('#noteSave').addEventListener('click', saveNote);
    $('#noteInput').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveNote(); });
    $('#noteInput').addEventListener('focus', () => { $('#noteHint').textContent = Store.fmtDateTime(Date.now()); });
    $('#noteInput').addEventListener('blur', () => { if (!$('#noteInput').value) $('#noteHint').textContent = ''; });

    /* 今日喜事 */
    $('#joyImgBtn').addEventListener('click', () => $('#joyFile').click());
    $('#joyFile').addEventListener('change', (e) => { onJoyFiles(e.target.files); e.target.value = ''; });
    $('#joySaveBtn').addEventListener('click', saveJoy);
    $('#joyText').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveJoy(); });

    /* 便签墙 */
    $('#stickyAddBtn').addEventListener('click', () => toggleStickyForm(true));
    $('#stickyCancel').addEventListener('click', () => toggleStickyForm(false));
    $('#stickySaveBtn').addEventListener('click', saveSticky);
    $('#stickyText').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveSticky(); });
    $$('.sticky-colors .col').forEach((c) => c.addEventListener('click', () => {
      $$('.sticky-colors .col').forEach((x) => x.classList.remove('sel'));
      c.classList.add('sel');
      state.stickyColor = c.dataset.color;
    }));

    $('#saveSettingsBtn').addEventListener('click', saveSettings);
    $('#exportBtn').addEventListener('click', doExport);
    $('#importBtn').addEventListener('click', doImport);
    $('#importFile').addEventListener('change', onImportFile);
    $('#seedBtn').addEventListener('click', async () => { try { await Store.seedSamples(); toast('已载入示例'); renderAll(); } catch (e) { toast('载入失败：' + (e.message || '请重试')); } });
    $('#resetBtn').addEventListener('click', async () => {
      if (!confirm('清空全部日记、随笔、足迹与设置？不可恢复！')) return;
      try { await Store.resetAll(); state.mgmt = true; document.body.classList.add('mgmt'); updateMgmtUI(); renderAll(); loadSettingsForm(); toast('已清空'); }
      catch (e) { toast('清空失败：' + (e.message || '请重试')); }
    });
    $('#calPrev').addEventListener('click', () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(); });
    $('#calNext').addEventListener('click', () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(); });
    $('#dayPanelClose').addEventListener('click', closeDayPanel);

    /* 登录 / 登出 / 迁移 */
    $('#authBtn').addEventListener('click', login);
    $('#authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('#logoutBtn').addEventListener('click', logout);
    $('#migrateBtn').addEventListener('click', doMigrate);
    const lw = document.getElementById('localWarnClose'); if (lw) lw.addEventListener('click', () => { const w = document.getElementById('localWarn'); if (w) w.hidden = true; });

    $('#year').textContent = new Date().getFullYear();
  }

  async function login() {
    const pw = $('#authPassword').value;
    const ok = (window.APP_CONFIG && window.APP_CONFIG.APP_PASSWORD) || 'hearts';
    if (pw !== ok) { $('#authErr').textContent = '密码不对'; return; }
    $('#authBtn').textContent = '进入中…'; $('#authErr').textContent = '';
    try {
      await Store.loadAll();
      await enterApp();
    } catch (e) {
      $('#authBtn').textContent = '进入';
      $('#authErr').textContent = (e && e.message) ? ('加载失败：' + e.message) : '加载失败，请检查网络或安全域名配置';
    }
  }
  async function logout() {
    try { await Store.auth.signOut(); } catch (e) {}
    document.body.classList.remove('authed', 'mgmt');
    state.mgmt = false;
    $('#authErr').textContent = '';
    toast('已退出');
  }
  async function doMigrate() {
    try {
      const r = await Store.migrateLegacyLocal();
      $('#migrateHint').hidden = true;
      toast(`已迁移 ${r.diary} 篇日记 / ${r.notes} 则随笔 / ${r.places} 处足迹`);
      renderAll();
    } catch (e) { toast('迁移失败：' + (e.message || '请重试')); }
  }
  async function enterApp() {
    document.body.classList.add('authed');
    state.mgmt = true; document.body.classList.add('mgmt');
    updateMgmtUI();
    try { await Store.loadAll(); } catch (e) { toast('加载失败：' + (e.message || '请重试')); }
    loadSettingsForm(); renderAll();
    updateCloudBadge();
    if (Store.hasLegacyLocal()) $('#migrateHint').hidden = false;
  }

  /* ---------- 图片压缩（转 dataURL 内联存储，省去独立图片桶） ---------- */
  function compressImage(file, maxW = 780, quality = 0.55) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxW) { height = Math.round(height * maxW / width); width = maxW; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          try { resolve(canvas.toDataURL('image/jpeg', quality)); }
          catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---------- 红条（本地预览提示）控制 ---------- */
  // 是否显示由真实探测结果决定：登录后 loadAll() 跑完，再调用本函数
  function updateCloudBadge() {
    const w = document.getElementById('localWarn');
    if (!w) return;
    if (Store.useLocal) {
      w.hidden = false;
      const span = w.querySelector('span');
      if (span) {
        const err = window.__probeError || '未知原因';
        span.innerHTML = '⚠ 本地预览模式：当前内容仅存于本机浏览器，换设备 / 清缓存即丢失，且无法与 TA 共享。<b style="color:#9c2b4a">[探测失败：' + err + ']</b>';
      }
    } else {
      w.hidden = true;
    }
  }

  /* ---------- 启动 ---------- */
  async function init() {
    bind();
    // 红条不在页面加载时显示：此时 Store.loadAll 还没探测云端，
    // Store.useLocal 只是初始值 true，不代表真进了本地模式。
    // 是否显示等 login() → loadAll() 探测完，由 updateCloudBadge() 决定。
    document.body.classList.remove('authed');
  }
  // 防御式启动：若 DOM 已就绪（DOMContentLoaded 已触发）则立即执行，否则等事件
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
