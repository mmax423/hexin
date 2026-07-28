/* ============================================================
 * store.js — 数据层（Netlify 无服务器函数 + GitHub 私有仓 + 本地降级）
 * ------------------------------------------------------------
 *  - 部署到 Netlify 后，前端调用同域的 /api（一个无服务器函数），
 *    函数再把数据读写代理到你的 GitHub 私有仓库 hexin-data。
 *    GitHub 令牌只存在于 Netlify 服务器环境变量，前端不暴露任何密钥。
 *  - 连不上 /api（例如本地双击打开 html）→ 自动降级为 localStorage，
 *    立即能看能用，但换设备/清缓存会丢，且无法与 TA 共享。
 *  - 两者对外 API 完全一致，app.js 无需感知差异。
 *  - 图片采用「内联 base64」直接存进 JSON，免去图床与索引依赖。
 * ============================================================ */
(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG || {};
  const API_BASE = (CFG.API_BASE || '/api').replace(/\/+$/, '');
  const APP_PASSWORD = CFG.APP_PASSWORD || 'hearts';

  let useCloud = false;   // 部署在 Netlify（有 /api 函数）→ 云端模式
  let useLocal = true;    // 没连上 /api（本地双击）→ 本地降级
  const configured = true; // 已内置云端支持，部署后自动启用，无需手动填密钥

  /* ---------- 云端 API（Netlify Function）---------- */
  async function netGet(name) {
    const r = await fetch(API_BASE + '?c=' + encodeURIComponent(name), {
      headers: { 'x-password': APP_PASSWORD }
    });
    if (!r.ok) throw new Error('云端读取失败(' + r.status + ')');
    const j = await r.json();
    return (j && 'data' in j) ? j.data : null;
  }
  async function netSet(name, value) {
    const r = await fetch(API_BASE + '?c=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-password': APP_PASSWORD },
      body: JSON.stringify({ data: value })
    });
    if (!r.ok) throw new Error('云端写入失败(' + r.status + ')');
    return true;
  }
  async function probeCloud() {
    try {
      const r = await fetch(API_BASE + '?c=settings', { headers: { 'x-password': APP_PASSWORD } });
      if (!r.ok) {
        global.__probeError = 'HTTP ' + r.status + ' ' + (r.statusText || '');
        try {
          const t = await r.clone().text();
          global.__probeError += ' | ' + t.slice(0, 120);
        } catch (_) {}
      }
      return r.ok;
    } catch (e) {
      global.__probeError = String(e && e.message ? e.message : e);
      return false;
    }
  }

  /* ---------- 本地存储 helper ---------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) ?? d); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function persistLocal() {
    LS.set('wd_settings', cache.settings);
    LS.set('wd_diary', cache.diary);
    LS.set('wd_notes', cache.notes);
    LS.set('wd_places', cache.places);
    LS.set('wd_love', cache.love);
    LS.set('wd_stickers', cache.stickers);
  }

  /* ---------- 地点类型（图标集） ---------- */
  const PLACE_CATS = [
    { id: 'food', icon: '🍜', label: '美食' },
    { id: 'cafe', icon: '☕', label: '咖啡' },
    { id: 'travel', icon: '✈️', label: '旅行' },
    { id: 'photo', icon: '📷', label: '拍照' },
    { id: 'movie', icon: '🎬', label: '电影' },
    { id: 'home', icon: '🏠', label: '家' },
    { id: 'shop', icon: '🛍️', label: '逛街' },
    { id: 'other', icon: '💡', label: '其他' }
  ];
  function catOf(id) { return PLACE_CATS.find((c) => c.id === id) || PLACE_CATS[PLACE_CATS.length - 1]; }

  /* ---------- 内存缓存 ---------- */
  const cache = {
    diary: [],
    notes: [],
    places: [],
    love: [],
    stickers: [],
    settings: { nameA: '', nameB: '', since: '2026-03-27' }
  };
  let loaded = false;

  /* ---------- 云端文档 <-> 业务对象 映射（用业务 id，不再依赖 _id） ---------- */
  function rowToDiary(r) { return { id: r.id || r._id, createdAt: Number(r.createdAt) || 0, date: r.date || '', title: r.title || '', mood: r.mood || '', content: r.content || '', images: r.images || [] }; }
  function rowToNote(r) { return { id: r.id || r._id, createdAt: Number(r.createdAt) || 0, text: r.text || '', images: r.images || [] }; }
  function rowToPlace(r) { return { id: r.id || r._id, createdAt: Number(r.createdAt) || 0, date: r.date || '', name: r.name || '', address: r.address || '', lat: r.lat, lng: r.lng, note: r.note || '', cat: r.cat || 'other', images: r.images || [] }; }
  function rowToLove(r) { return { id: r.id || r._id, createdAt: Number(r.createdAt) || 0, date: r.date || '', title: r.title || '', mood: r.mood || '', content: r.content || '', images: r.images || [] }; }
  function rowToSticker(r) { return { id: r.id || r._id, createdAt: Number(r.createdAt) || 0, date: r.date || '', text: r.text || '', color: r.color || 'pink' }; }

  /* ---------- 鉴权（无登录，密码由前端校验） ---------- */
  const auth = {
    async signIn() { return { user: {} }; },
    async signOut() { loaded = false; cache.diary = []; cache.notes = []; cache.places = []; cache.love = []; cache.stickers = []; },
    async currentUser() { return {}; },
    onChange() { /* 无登录态变化 */ }
  };

  /* ---------- 载入全量 ---------- */
  async function loadAll() {
    // 先探测云端是否可用（部署后在 Netlify 上 /api 返回 200）
    useCloud = await probeCloud();
    useLocal = !useCloud;

    if (useCloud) {
      const [d, n, p, lo, st, s] = await Promise.all([
        netGet('diary'), netGet('notes'), netGet('places'), netGet('love'), netGet('stickers'), netGet('settings')
      ]);
      cache.diary = (Array.isArray(d) ? d : []).map(rowToDiary).sort((a, b) => b.createdAt - a.createdAt);
      cache.notes = (Array.isArray(n) ? n : []).map(rowToNote).sort((a, b) => b.createdAt - a.createdAt);
      cache.places = (Array.isArray(p) ? p : []).map(rowToPlace).sort((a, b) => b.createdAt - a.createdAt);
      cache.love = (Array.isArray(lo) ? lo : []).map(rowToLove).sort((a, b) => b.createdAt - a.createdAt);
      cache.stickers = (Array.isArray(st) ? st : []).map(rowToSticker).sort((a, b) => b.createdAt - a.createdAt);
      const sd = (s && typeof s === 'object') ? s : null;
      cache.settings = sd ? { nameA: sd.nameA || '', nameB: sd.nameB || '', since: sd.since || '2026-03-27' }
                            : { nameA: '', nameB: '', since: '2026-03-27' };
    } else {
      cache.settings = LS.get('wd_settings', { nameA: '', nameB: '', since: '2026-03-27' });
      cache.diary = LS.get('wd_diary', []);
      cache.notes = LS.get('wd_notes', []);
      cache.places = LS.get('wd_places', []);
      cache.love = LS.get('wd_love', []);
      cache.stickers = LS.get('wd_stickers', []);
    }
    loaded = true;
  }

  /* ---------- 设置 ---------- */
  function getSettings() { return Object.assign({ nameA: '', nameB: '', since: '2026-03-27' }, cache.settings); }
  async function saveSettings(s) {
    cache.settings = { nameA: s.nameA || '', nameB: s.nameB || '', since: s.since || '2026-03-27' };
    if (useCloud) await netSet('settings', cache.settings);
    else persistLocal();
  }

  /* ---------- 日记 ---------- */
  function getDiary() { return cache.diary; }
  async function addDiary(e) {
    e.id = uid('d'); e.createdAt = Date.now(); if (!e.images) e.images = [];
    cache.diary.unshift(Object.assign({}, e));
    cache.diary.sort((a, b) => b.createdAt - a.createdAt);
    if (useCloud) await netSet('diary', cache.diary); else persistLocal();
    return e;
  }
  async function updateDiary(id, patch) {
    const i = cache.diary.findIndex((e) => e.id === id); if (i < 0) return null;
    cache.diary[i] = Object.assign({}, cache.diary[i], patch, { images: patch.images || cache.diary[i].images });
    if (useCloud) await netSet('diary', cache.diary); else persistLocal();
    return cache.diary[i];
  }
  async function removeDiary(id) {
    cache.diary = cache.diary.filter((e) => e.id !== id);
    if (useCloud) await netSet('diary', cache.diary); else persistLocal();
  }

  /* ---------- 随笔 ---------- */
  function getNotes() { return cache.notes; }
  async function addNote(e) {
    e.id = uid('n'); e.createdAt = Date.now(); if (!e.images) e.images = [];
    cache.notes.unshift(Object.assign({}, e));
    if (useCloud) await netSet('notes', cache.notes); else persistLocal();
    return e;
  }
  async function removeNote(id) {
    cache.notes = cache.notes.filter((e) => e.id !== id);
    if (useCloud) await netSet('notes', cache.notes); else persistLocal();
  }

  /* ---------- 便签 ---------- */
  function getStickers() { return cache.stickers; }
  async function addSticker(e) {
    e.id = uid('s'); e.createdAt = Date.now();
    if (!e.date) e.date = new Date().toISOString().slice(0, 10);
    if (!e.color) e.color = 'pink';
    cache.stickers.unshift(Object.assign({}, e));
    if (useCloud) await netSet('stickers', cache.stickers); else persistLocal();
    return e;
  }
  async function updateSticker(id, patch) {
    const i = cache.stickers.findIndex((e) => e.id === id); if (i < 0) return null;
    cache.stickers[i] = Object.assign({}, cache.stickers[i], patch);
    if (useCloud) await netSet('stickers', cache.stickers); else persistLocal();
    return cache.stickers[i];
  }
  async function removeSticker(id) {
    cache.stickers = cache.stickers.filter((e) => e.id !== id);
    if (useCloud) await netSet('stickers', cache.stickers); else persistLocal();
  }

  /* ---------- 私爱 ---------- */
  function getLove() { return cache.love; }
  async function addLove(e) {
    e.id = uid('v'); e.createdAt = Date.now(); if (!e.images) e.images = [];
    cache.love.unshift(Object.assign({}, e));
    if (useCloud) await netSet('love', cache.love); else persistLocal();
    return e;
  }
  async function updateLove(id, patch) {
    const i = cache.love.findIndex((e) => e.id === id); if (i < 0) return null;
    cache.love[i] = Object.assign({}, cache.love[i], patch, { images: patch.images || cache.love[i].images });
    if (useCloud) await netSet('love', cache.love); else persistLocal();
    return cache.love[i];
  }
  async function removeLove(id) {
    cache.love = cache.love.filter((e) => e.id !== id);
    if (useCloud) await netSet('love', cache.love); else persistLocal();
  }

  /* ---------- 足迹 ---------- */
  function getPlaces() { return cache.places; }
  async function addPlace(e) {
    e.id = uid('p'); e.createdAt = Date.now(); if (!e.images) e.images = [];
    cache.places.unshift(Object.assign({}, e));
    if (useCloud) await netSet('places', cache.places); else persistLocal();
    return e;
  }
  async function updatePlace(id, patch) {
    const i = cache.places.findIndex((e) => e.id === id); if (i < 0) return null;
    cache.places[i] = Object.assign({}, cache.places[i], patch, { images: patch.images || cache.places[i].images });
    if (useCloud) await netSet('places', cache.places); else persistLocal();
    return cache.places[i];
  }
  async function removePlace(id) {
    cache.places = cache.places.filter((e) => e.id !== id);
    if (useCloud) await netSet('places', cache.places); else persistLocal();
  }

  /* ---------- 图片 URL（图片以 base64 dataURL 内联存储，id 即 dataURL） ---------- */
  function getImageURL(id) { return id || null; }

  /* ---------- 统计 / 工具 ---------- */
  function countPhotos() {
    let n = 0;
    cache.diary.forEach((d) => (n += (d.images || []).length));
    cache.places.forEach((p) => (n += (p.images || []).length));
    return n;
  }
  function daysTogether(since) {
    if (!since) return 0;
    const s = new Date(since + 'T00:00:00');
    const d = Math.floor((Date.now() - s.getTime()) / 86400000);
    return d >= 0 ? d : 0;
  }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fmtDate(d) { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`; }
  function fmtDateTime(ts) {
    const dt = new Date(ts);
    return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  }
  function dayKeyOf(kind, item) {
    if (kind === 'note') { const d = new Date(item.createdAt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    return item.date || '';
  }

  /* ---------- 示例 ---------- */
  async function seedSamples() {
    if (cache.diary.length || cache.notes.length || cache.places.length || cache.love.length) return;
    await addDiary({ title: '第一次一起看海', date: '2026-03-29', mood: '潮声很轻，你靠在我肩上睡着了。', content: '我们坐了很久。\n海浪一遍遍漫上来，像把今天反复地读。\n你说以后每年都要来一次，我点头，心里已经记下了。', images: [] });
    await addNote({ text: '今天路过花店，忽然很想你。', images: [] });
    await addPlace({ name: '外滩', date: '2026-04-02', address: '上海黄浦江畔', lat: 31.2397, lng: 121.4905, note: '晚风、灯影，和你。', cat: 'travel', images: [] });
    await addLove({ title: '只给你看的', date: '2026-04-10', mood: '夜深了，有些话只对一个人说。', content: '今天你睡着以后，我偷偷看了你好久。\n想把这些只属于我们的话，收进一个谁也看不到的角落。', images: [] });
  }

  /* ---------- 备份 / 恢复（图片已内联，无需独立图片集合） ---------- */
  async function exportAll() {
    return { app: 'our-diary', version: 5, exportedAt: new Date().toISOString(), settings: getSettings(), diary: cache.diary, notes: cache.notes, places: cache.places, love: cache.love, stickers: cache.stickers };
  }
  async function importAll(data) {
    if (!data || data.app !== 'our-diary') throw new Error('不是有效的备份文件');
    cache.diary = (data.diary || []).map((e) => Object.assign({}, e));
    cache.notes = (data.notes || []).map((e) => Object.assign({}, e));
    cache.places = (data.places || []).map((e) => Object.assign({}, e));
    cache.love = (data.love || []).map((e) => Object.assign({}, e));
    cache.stickers = (data.stickers || []).map((e) => Object.assign({}, e));
    if (data.settings) cache.settings = Object.assign({ nameA: '', nameB: '', since: '2026-03-27' }, data.settings);
    if (useCloud) {
      await Promise.all([
        netSet('diary', cache.diary), netSet('notes', cache.notes),
        netSet('places', cache.places), netSet('love', cache.love), netSet('stickers', cache.stickers), netSet('settings', cache.settings)
      ]);
    } else {
      persistLocal();
    }
    await loadAll();
  }
  async function resetAll() {
    cache.diary = []; cache.notes = []; cache.places = []; cache.love = []; cache.stickers = [];
    cache.settings = { nameA: '', nameB: '', since: '2026-03-27' };
    if (useCloud) {
      await Promise.all([
        netSet('diary', []), netSet('notes', []), netSet('places', []), netSet('love', []), netSet('stickers', []), netSet('settings', cache.settings)
      ]);
    } else {
      persistLocal();
    }
  }

  /* ---------- 旧本地数据迁移（仅本地降级模式有意义） ---------- */
  function hasLegacyLocal() {
    if (useCloud) return false;
    try { return !!(localStorage.getItem('wd_diary') || localStorage.getItem('wd_notes') || localStorage.getItem('wd_places')); } catch (e) { return false; }
  }
  async function migrateLegacyLocal() {
    if (useCloud) return { diary: 0, notes: 0, places: 0 };
    let diary = [], notes = [], places = [], settings = null;
    try { diary = JSON.parse(localStorage.getItem('wd_diary') || '[]'); } catch (e) {}
    try { notes = JSON.parse(localStorage.getItem('wd_notes') || '[]'); } catch (e) {}
    try { places = JSON.parse(localStorage.getItem('wd_places') || '[]'); } catch (e) {}
    try { settings = JSON.parse(localStorage.getItem('wd_settings') || 'null'); } catch (e) {}
    await importAll({ app: 'our-diary', version: 4, settings: settings || undefined, diary, notes, places, love: [] });
    return { diary: diary.length, notes: notes.length, places: places.length };
  }

  global.Store = {
    configured, useLocal, useCloud, isLoaded: () => loaded, auth, loadAll,
    getSettings, saveSettings,
    getDiary, addDiary, updateDiary, removeDiary,
    getNotes, addNote, removeNote,
    getStickers, addSticker, updateSticker, removeSticker,
    getLove, addLove, updateLove, removeLove,
    getPlaces, addPlace, updatePlace, removePlace,
    getImageURL,
    PLACE_CATS, catOf, dayKeyOf,
    countPhotos, daysTogether, uid, fmtDate, fmtDateTime,
    seedSamples, exportAll, importAll, resetAll,
    hasLegacyLocal, migrateLegacyLocal
  };
})(window);
