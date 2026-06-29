/* nodex.pw — renderer app.js */
'use strict';

// ─── CONFIG ───────────────────────────────────────────────
const API = 'https://music.nodex.pw/api';

function authFetch(url, opts = {}) {
  const token = localStorage.getItem('nm_bearer');
  if (token) {
    opts.headers = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + token });
  }
  return fetch(url, opts);
}
const eAPI = window.electronAPI || null;

// ─── STATE ────────────────────────────────────────────────
const S = {
  user: null,
  track: null,
  queue: [],
  queueIdx: 0,
  playing: false,
  shuffle: false,
  repeat: 'none',
  volume: 1,
  favs: JSON.parse(localStorage.getItem('nm_favs') || '[]'),
  quality: localStorage.getItem('nm_quality') || '320',
  crossfade: parseInt(localStorage.getItem('nm_crossfade') || '0'),
  videoBg: localStorage.getItem('nm_videobg') !== 'false',
  normalize: localStorage.getItem('nm_normalize') !== 'false',
  theme: localStorage.getItem('nm_theme') || 'dark',
  preloadedUrl: null,
  preloadTimeout: null,
  crossfadeFired: false,
  currentPage: 'home',
  lyricsLines: [],
  lyricsSrc: 'lrclib',
  lyricsShowing: false,
  spatialOpen: false,
  spatialOn: false,
  spatialMode: '8d',
  spatialIntensity: 0.8,
  spatialSpeed: 0.3,
  spatialRoom: 'none',
  spatialAnimId: null,
  platform: 'all',
  searchResults: [],
  quickPicks: JSON.parse(localStorage.getItem('nm_quick_v1') || '[]'),
  playback: JSON.parse(localStorage.getItem('nm_playback_v2') || 'null'),
};

// Audio
let audioCtx = null, srcNode = null, pannerNode = null, gainNode = null, convolverNode = null;
const audio = document.getElementById('audio');

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(S.theme);
  initOnboarding();
  initTitlebar();
  initSidebar();
  initPlayer();
  initSearch();
  initSettings();
  initSpatial();
  initLyrics();
  initFullPlayer();
  renderQuickPicks();
  restorePlayback();
  setupMediaSession();
  checkForUpdate();
  hideSplash();
  updateUserUI();
});

// ─── SPLASH ───────────────────────────────────────────────
function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;

  function doClose() {
    s.style.transition = 'opacity 0.4s ease';
    s.style.opacity = '0';
    setTimeout(() => { try { s.remove(); } catch(_) {} }, 450);
  }

  // IPC listeners — close as soon as update check finishes
  if (window.electronAPI) {
    window.electronAPI.onUpdateAvailable(() => doClose());
    window.electronAPI.onUpdateNotAvailable(() => doClose());
    window.electronAPI.onUpdateError(() => doClose());
  }

  // Guaranteed close after 4 seconds no matter what
  setTimeout(doClose, 4000);
}

// ─── ONBOARDING ───────────────────────────────────────────
function initOnboarding() {
  const done = localStorage.getItem('nm_ob_done');
  const ob = document.getElementById('onboarding');
  if (!ob) return;
  if (done) { ob.classList.add('hidden'); return; }

  const steps = ob.querySelectorAll('.ob-step');
  const dots = ob.querySelectorAll('.ob-dot');
  let cur = 0;

  function goTo(n) {
    steps.forEach((s, i) => s.classList.toggle('active', i === n));
    dots.forEach((d, i) => d.classList.toggle('active', i === n));
    cur = n;
  }
  goTo(0);

  ob.querySelectorAll('.ob-next').forEach(btn => {
    btn.addEventListener('click', () => {
      if (cur < steps.length - 1) goTo(cur + 1);
      else { localStorage.setItem('nm_ob_done', '1'); ob.classList.add('hidden'); }
    });
  });
  ob.querySelectorAll('.ob-back').forEach(btn => {
    btn.addEventListener('click', () => { if (cur > 0) goTo(cur - 1); });
  });
  dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
}

// ─── TITLEBAR ─────────────────────────────────────────────
function initTitlebar() {
  // set version dynamically
  const verEl = document.querySelector('.tb-ver');
  if (verEl && eAPI?.appVersion) verEl.textContent = 'v' + eAPI.appVersion;

  document.getElementById('tb-min')?.addEventListener('click', () => eAPI?.minimize?.());
  document.getElementById('tb-max')?.addEventListener('click', () => eAPI?.maximize?.());
  document.getElementById('tb-close')?.addEventListener('click', () => eAPI?.close?.());
}

// ─── SIDEBAR ──────────────────────────────────────────────
function initSidebar() {
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  document.getElementById('login-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (S.user) showUserMenu(e); else showLoginModal();
  });
  document.addEventListener('click', () => closeUserMenu());
}

function showPage(page) {
  S.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const pageNames = { home: 'Главная', search: 'Поиск', library: 'Библиотека', downloads: 'Загрузки', settings: 'Настройки' };
  const tb = document.querySelector('.tb-center');
  if (tb) tb.textContent = pageNames[page] || '';
  if (page === 'home') initWave();
  if (page === 'library') renderLibrary();
  if (page === 'downloads') renderDownloads();
}

// ─── WAVE ANIMATION ───────────────────────────────────────
let waveAnimId = null;
function initWave() {
  const canvas = document.getElementById('wave-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  let particles = [];
  let W = 0, H = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = parent.offsetWidth; H = parent.offsetHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
  }

  function buildParticles() {
    particles = [];
    const n = Math.floor(W / 8);
    for (let i = 0; i < n; i++) {
      particles.push({
        x: (i / n) * W,
        baseY: H * (0.4 + Math.random() * 0.3),
        amp: 10 + Math.random() * 30,
        freq: 0.4 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        speed: 0.015 + Math.random() * 0.025,
        size: 1 + Math.random() * 2,
        alpha: 0.15 + Math.random() * 0.45,
      });
    }
  }

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    t += 0.5;
    for (let l = 0; l < 3; l++) {
      ctx.beginPath();
      const offset = l * 0.4;
      for (let xi = 0; xi <= W; xi += 2) {
        const y = H * (0.5 + l * 0.05) + Math.sin(xi * 0.01 + t * 0.02 + offset) * (25 - l * 6) + Math.cos(xi * 0.006 + t * 0.015) * (15 - l * 4);
        xi === 0 ? ctx.moveTo(xi, y) : ctx.lineTo(xi, y);
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.04 - l * 0.01})`;
      ctx.lineWidth = 1; ctx.stroke();
    }
    for (const p of particles) {
      const y = p.baseY + Math.sin(t * p.speed * 60 + p.phase) * p.amp * (S.playing ? 1.4 : 0.5);
      ctx.beginPath();
      ctx.arc(p.x, y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.alpha * (S.playing ? 1 : 0.4)})`;
      ctx.fill();
    }
    waveAnimId = requestAnimationFrame(draw);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(parent);
  resize();
  if (waveAnimId) cancelAnimationFrame(waveAnimId);
  draw();
}

// ─── AUDIO CONTEXT ────────────────────────────────────────
function initAudioCtx() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  srcNode = audioCtx.createMediaElementSource(audio);
  gainNode = audioCtx.createGain();
  pannerNode = audioCtx.createStereoPanner();
  convolverNode = audioCtx.createConvolver();
  srcNode.connect(gainNode);
  gainNode.connect(pannerNode);
  pannerNode.connect(audioCtx.destination);
  gainNode.gain.value = S.volume;
}

// ─── PLAY ─────────────────────────────────────────────────
async function play(track, fromQueue) {
  if (!track) return;
  S.track = track;
  S.crossfadeFired = false;
  S.preloadedUrl = null;
  if (!fromQueue) {
    const src = S.searchResults.length ? S.searchResults : S.quickPicks;
    const idx = src.findIndex(t => t.id === track.id);
    S.queue = [...src];
    S.queueIdx = idx >= 0 ? idx : 0;
  }

  updatePlayerUI(track, true);
  updateTray(track, false);
  setupMediaSession(track);
  saveQuickPick(track);
  savePlayback(track);
  setPlayerLoading(true);

  // fire lyrics + video in parallel immediately — don't wait for stream
  loadLyrics(track);
  loadVideoBackground(track);

  try {
    const payload = {
      url: track.url || '',
      search_query: track.search_query || `${track.artist} ${track.title}`,
      title: track.title || '',
      artist: track.artist || '',
      platform: track.platform || 'youtube',
      quality: S.quality || '192',
      cover_url: track.cover_url || track.thumbnail || ''
    };

    const streamUrl = await new Promise((resolve, reject) => {
      const wsUrl = API.replace(/^https?/, 'wss').replace(/^http/, 'ws').replace('/api', '') + '/ws/play';
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.close(); reject(new Error('ws timeout')); }, 35000);
      ws.onopen = () => ws.send(JSON.stringify(payload));
      ws.onmessage = ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.status === 'direct') { clearTimeout(timer); ws.close(); resolve(`${API}/proxy/${msg.job_id}`); }
        else if (msg.status === 'ready') { clearTimeout(timer); ws.close(); resolve(`${API}/stream/${msg.job_id}`); }
        else if (msg.status === 'error') { clearTimeout(timer); ws.close(); reject(new Error(msg.error || 'stream error')); }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
    });

    if (S.playing && S.crossfade > 0 && audioCtx) {
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + S.crossfade);
      await new Promise(r => setTimeout(r, S.crossfade * 1000));
    }

    audio.src = streamUrl;
    audio.volume = S.volume;

    if (!audioCtx) initAudioCtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    await audio.play();
    S.playing = true;
    setPlayerLoading(false);
    updatePlayBtn(true);
    updateTray(track, true);
    if (S.crossfade > 0 && audioCtx) {
      gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(S.volume, audioCtx.currentTime + S.crossfade);
    }
  } catch (err) {
    console.error('play error', err);
    setPlayerLoading(false);
    setTimeout(playNext, 2000);
  }
}

async function preloadNext() {
  const next = getNextTrack();
  if (!next || S.preloadedUrl === next.id) return;
  S.preloadedUrl = next.id;
  const url = `${API}/stream/${encodeURIComponent(next.id)}?quality=${S.quality}&platform=${next.platform || 'youtube'}`;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    await fetch(url, { headers: { Range: 'bytes=0-65536' }, signal: ctrl.signal });
  } catch (_) {}
}

function getNextTrack() {
  if (!S.queue.length) return null;
  if (S.shuffle) {
    const others = S.queue.filter((_, i) => i !== S.queueIdx);
    return others[Math.floor(Math.random() * others.length)] || null;
  }
  if (S.repeat === 'all') return S.queue[(S.queueIdx + 1) % S.queue.length];
  return S.queue[S.queueIdx + 1] || null;
}

function getPrevTrack() {
  if (!S.queue.length) return null;
  if (S.shuffle) return getNextTrack();
  return S.queue[S.queueIdx - 1] || null;
}

function playNext() {
  const next = getNextTrack();
  if (!next) return;
  S.queueIdx = S.queue.indexOf(next);
  play(next, true);
}

function playPrev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const prev = getPrevTrack();
  if (prev) { S.queueIdx = S.queue.indexOf(prev); play(prev, true); }
}

// ─── PLAYER UI ────────────────────────────────────────────
function initPlayer() {
  const progWrap = document.querySelector('.pb-prog-wrap');
  progWrap?.addEventListener('click', e => {
    if (!audio.duration) return;
    const r = progWrap.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  document.getElementById('pb-play')?.addEventListener('click', togglePlay);
  document.getElementById('pb-prev')?.addEventListener('click', playPrev);
  document.getElementById('pb-next')?.addEventListener('click', playNext);
  document.getElementById('pb-shuffle')?.addEventListener('click', toggleShuffle);
  document.getElementById('pb-repeat')?.addEventListener('click', cycleRepeat);
  document.getElementById('pb-fav')?.addEventListener('click', toggleFavCurrent);
  document.getElementById('pb-lyrics-btn')?.addEventListener('click', toggleLyrics);
  document.getElementById('pb-spatial-btn')?.addEventListener('click', toggleSpatial);
  document.getElementById('pb-expand')?.addEventListener('click', openFullPlayer);
  document.getElementById('pb-art-wrap')?.addEventListener('click', openFullPlayer);
  document.getElementById('pb-meta')?.addEventListener('click', openFullPlayer);

  const vol = document.getElementById('pb-vol');
  if (vol) {
    vol.value = S.volume * 100;
    vol.addEventListener('input', () => {
      S.volume = vol.value / 100;
      audio.volume = S.volume;
      if (gainNode) gainNode.gain.value = S.volume;
    });
  }

  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('canplay', () => setPlayerLoading(false));
  audio.addEventListener('error', () => { setPlayerLoading(false); setTimeout(playNext, 1500); });

  document.getElementById('wave-play-btn')?.addEventListener('click', () => {
    if (S.track) togglePlay();
    else playWave();
  });
  document.getElementById('wave-tune-btn')?.addEventListener('click', playWave);

  const homeQ = document.getElementById('home-q');
  homeQ?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const v = homeQ.value.trim();
      if (!v) return;
      showPage('search');
      const q = document.getElementById('q');
      if (q) q.value = v;
      doSearch(v);
    }
  });
}

function onTimeUpdate() {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  const fill = document.getElementById('pb-prog-fill');
  if (fill) fill.style.width = pct + '%';
  const fpFill = document.getElementById('fp-seek-fill');
  if (fpFill) fpFill.style.width = pct + '%';

  const cur = document.getElementById('pb-cur');
  const dur = document.getElementById('pb-dur');
  if (cur) cur.textContent = fmtTime(audio.currentTime);
  if (dur) dur.textContent = fmtTime(audio.duration);
  const fpCur = document.getElementById('fp-cur');
  const fpDur = document.getElementById('fp-dur');
  if (fpCur) fpCur.textContent = fmtTime(audio.currentTime);
  if (fpDur) fpDur.textContent = fmtTime(audio.duration);

  if (pct > 70) preloadNext();

  if (S.crossfade > 0 && audio.duration - audio.currentTime < S.crossfade + 0.1 && !S.crossfadeFired) {
    S.crossfadeFired = true;
    playNext();
  }

  if (S.lyricsShowing && S.lyricsLines.length) syncLyrics(audio.currentTime);
}

function onEnded() {
  S.playing = false;
  S.crossfadeFired = false;
  if (S.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  playNext();
}

function setPlayerLoading(v) {
  const loading = document.querySelector('.pb-prog-loading');
  const fill = document.getElementById('pb-prog-fill');
  if (loading) loading.style.display = v ? 'block' : 'none';
  if (fill) fill.style.display = v ? 'none' : 'block';
  const fpLoading = document.getElementById('fp-seek-loading');
  const fpFill = document.getElementById('fp-seek-fill');
  if (fpLoading) fpLoading.style.display = v ? 'block' : 'none';
  if (fpFill) fpFill.style.display = v ? 'none' : 'block';
}

function updatePlayBtn(playing) {
  S.playing = playing;
  const pause = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
  const play = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  document.querySelectorAll('#pb-play, #fp-play').forEach(btn => { if (btn) btn.innerHTML = playing ? pause : play; });
}

function togglePlay() {
  if (!S.track) return;
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  if (S.playing) { audio.pause(); S.playing = false; updatePlayBtn(false); updateTray(S.track, false); }
  else { audio.play(); S.playing = true; updatePlayBtn(true); updateTray(S.track, true); }
}

function toggleShuffle() {
  S.shuffle = !S.shuffle;
  document.getElementById('pb-shuffle')?.classList.toggle('active', S.shuffle);
}

function cycleRepeat() {
  const modes = ['none', 'all', 'one'];
  S.repeat = modes[(modes.indexOf(S.repeat) + 1) % modes.length];
  document.getElementById('pb-repeat')?.classList.toggle('active', S.repeat !== 'none');
}

function toggleFavCurrent() {
  if (!S.track) return;
  const idx = S.favs.findIndex(t => t.id === S.track.id);
  if (idx >= 0) S.favs.splice(idx, 1); else S.favs.unshift(S.track);
  localStorage.setItem('nm_favs', JSON.stringify(S.favs));
  updateFavBtn();
}

function updateFavBtn() {
  const active = S.track && S.favs.some(t => t.id === S.track.id);
  document.getElementById('pb-fav')?.classList.toggle('active', active);
  document.getElementById('fp-fav')?.classList.toggle('active', active);
}

function updatePlayerUI(track, loading) {
  if (!track) return;
  document.getElementById('player-bar')?.classList.add('visible');
  const art = document.getElementById('pb-art');
  const artPh = document.getElementById('pb-art-ph');
  if (art) art.src = track.thumbnail || '';
  if (art) art.style.display = track.thumbnail ? 'block' : 'none';
  if (artPh) artPh.style.display = track.thumbnail ? 'none' : 'flex';
  const title = document.getElementById('pb-title');
  const artist = document.getElementById('pb-artist');
  if (title) title.textContent = track.title || 'Неизвестно';
  if (artist) artist.textContent = track.artist || '';
  updateFavBtn();
  updateFullPlayerUI(track);
  if (loading) updatePlayBtn(false);
}

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─── TRAY ─────────────────────────────────────────────────
function updateTray(track, playing) {
  eAPI?.trayUpdate?.({ title: track?.title || 'nodex.pw', artist: track?.artist || '', playing });
}

// ─── MEDIA SESSION ────────────────────────────────────────
function setupMediaSession(track) {
  if (!navigator.mediaSession) return;
  if (track) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || '',
      artist: track.artist || '',
      artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: '256x256' }] : [],
    });
  }
  navigator.mediaSession.setActionHandler('play', () => { audio.play(); S.playing = true; updatePlayBtn(true); });
  navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); S.playing = false; updatePlayBtn(false); });
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack', playNext);
}

// ─── SEARCH ───────────────────────────────────────────────
let searchAbort = null, searchTimeout = null;
function initSearch() {
  const q = document.getElementById('q');
  if (!q) return;
  q.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const v = q.value.trim();
    if (!v) { showSearchEmpty(); return; }
    searchTimeout = setTimeout(() => doSearch(v), 250);
  });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(q.value.trim()); });
  document.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      S.platform = c.dataset.plat || 'all';
      const v = q.value.trim();
      if (v) doSearch(v);
    });
  });
}

async function doSearch(query) {
  if (!query) return;
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const wrap = document.getElementById('results-list');
  const empty = document.getElementById('search-empty');
  const resultsWrap = document.getElementById('results-wrap');
  if (empty) empty.style.display = 'none';
  if (resultsWrap) resultsWrap.style.display = 'block';
  if (wrap) wrap.innerHTML = '<div class="state-empty"><div class="spinner"></div></div>';
  try {
    const params = new URLSearchParams({ q: query, platform: S.platform, limit: 60 });
    const res = await fetch(`${API}/search?${params}`, { signal: searchAbort.signal });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    S.searchResults = data.results || data || [];
    renderResults(S.searchResults);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (wrap) wrap.innerHTML = '<div class="state-empty">Ошибка поиска</div>';
  }
}

function renderResults(results) {
  const wrap = document.getElementById('results-list');
  const count = document.getElementById('results-count');
  const label = document.getElementById('results-label');
  if (!wrap) return;
  if (!results.length) { wrap.innerHTML = '<div class="state-empty">Ничего не найдено</div>'; return; }
  if (count) count.textContent = results.length + ' треков';
  if (label) label.textContent = 'Результаты';
  wrap.innerHTML = results.map((t, i) => trackRowHTML(t, i + 1)).join('');
  wrap.querySelectorAll('.track-row').forEach((row, i) => {
    row.addEventListener('click', () => { S.queueIdx = i; play(results[i]); });
    row.addEventListener('contextmenu', e => showCtxMenu(e, results[i]));
  });
}

function trackRowHTML(t, idx) {
  const fav = S.favs.some(f => f.id === t.id);
  const active = S.track?.id === t.id;
  const platC = { youtube: '#ff0000', soundcloud: '#ff5500', applemusic: '#fc3c44' };
  const platL = { youtube: 'YT', soundcloud: 'SC', applemusic: 'AM' };
  return `<div class="track-row${active ? ' playing' : ''}" data-id="${t.id}">
    <div class="track-num">
      ${active ? `<div class="track-playing-bar"><span></span><span></span><span></span></div>` : `<span class="track-idx">${idx}</span>`}
      <span class="track-hover-play"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
    </div>
    <div class="track-art">
      ${(t.cover_url || t.thumbnail) ? `<img src="${t.cover_url || t.thumbnail}" loading="lazy" alt="">` : '<div class="track-art-ph"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
    </div>
    <div class="track-meta">
      <div class="track-name">${esc(t.title || 'Неизвестно')} <span class="plat-badge" style="color:${platC[t.platform]||'#aaa'}">${platL[t.platform]||'?'}</span></div>
      <div class="track-artist">${esc(t.artist || '')}</div>
    </div>
    <div class="track-dur">
      <button class="pb-icon-btn" title="${fav ? 'Убрать' : 'В избранное'}" onclick="toggleFav(event,'${t.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
      ${t.duration ? `<span>${fmtTime(t.duration)}</span>` : ''}
    </div>
  </div>`;
}

function showSearchEmpty() {
  const empty = document.getElementById('search-empty');
  const resultsWrap = document.getElementById('results-wrap');
  if (empty) empty.style.display = '';
  if (resultsWrap) resultsWrap.style.display = 'none';
  const count = document.getElementById('results-count');
  if (count) count.textContent = '';
}

function toggleFav(e, id) {
  e.stopPropagation();
  const track = S.searchResults.find(t => t.id === id) || S.quickPicks.find(t => t.id === id) || S.favs.find(t => t.id === id);
  if (!track) return;
  const idx = S.favs.findIndex(t => t.id === id);
  if (idx >= 0) S.favs.splice(idx, 1); else S.favs.unshift(track);
  localStorage.setItem('nm_favs', JSON.stringify(S.favs));
  if (S.track?.id === id) updateFavBtn();
  renderResults(S.searchResults);
  if (S.currentPage === 'library') renderLibrary();
}
window.toggleFav = toggleFav;

// ─── LIBRARY ──────────────────────────────────────────────
function renderLibrary() {
  const wrap = document.getElementById('lib-list');
  const count = document.getElementById('lib-count');
  if (!wrap) return;
  if (!S.favs.length) { wrap.innerHTML = '<div class="state-box">Нет избранных треков</div>'; if (count) count.textContent = ''; return; }
  if (count) count.textContent = S.favs.length;
  wrap.innerHTML = S.favs.map((t, i) => trackRowHTML(t, i + 1)).join('');
  wrap.querySelectorAll('.track-row').forEach((row, i) => {
    row.addEventListener('click', () => { S.queue = [...S.favs]; S.queueIdx = i; play(S.favs[i], true); });
  });
}

// ─── DOWNLOADS ────────────────────────────────────────────
function renderDownloads() {
  const wrap = document.getElementById('dl-list');
  if (!wrap) return;
  const downloads = JSON.parse(localStorage.getItem('nm_downloads') || '[]');
  if (!downloads.length) { wrap.innerHTML = '<div class="state-box">Нет загруженных треков</div>'; return; }
  wrap.innerHTML = downloads.map((t, i) => trackRowHTML(t, i + 1)).join('');
  wrap.querySelectorAll('.track-row').forEach((row, i) => {
    row.addEventListener('click', () => { S.queue = [...downloads]; S.queueIdx = i; play(downloads[i], true); });
  });
}

// ─── WAVE ─────────────────────────────────────────────────
const WAVE_SEEDS = ['chill', 'pop hits', 'indie', 'electronic', 'hip hop', 'lo-fi', 'rock', 'jazz', 'r&b', 'ambient'];
async function playWave() {
  const seed = WAVE_SEEDS[Math.floor(Math.random() * WAVE_SEEDS.length)];
  const btn = document.getElementById('wave-play-btn');
  if (btn) btn.disabled = true;
  try {
    const params = new URLSearchParams({ q: seed, platform: 'all', limit: 30 });
    const res = await fetch(`${API}/search?${params}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const tracks = (data.results || data || []).sort(() => Math.random() - 0.5);
    if (!tracks.length) return;
    S.queue = tracks;
    S.queueIdx = 0;
    S.shuffle = true;
    play(tracks[0], true);
  } catch (_) {
    if (S.quickPicks.length) { S.queue = [...S.quickPicks]; S.queueIdx = 0; play(S.quickPicks[0], true); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── QUICK PICKS ──────────────────────────────────────────
function saveQuickPick(track) {
  const idx = S.quickPicks.findIndex(t => t.id === track.id);
  if (idx >= 0) S.quickPicks.splice(idx, 1);
  S.quickPicks.unshift(track);
  if (S.quickPicks.length > 16) S.quickPicks = S.quickPicks.slice(0, 16);
  localStorage.setItem('nm_quick_v1', JSON.stringify(S.quickPicks));
  renderQuickPicks();
}

function renderQuickPicks() {
  const wrap = document.getElementById('quick-picks');
  if (!wrap) return;
  if (!S.quickPicks.length) { wrap.innerHTML = '<div class="qp-empty">Слушай треки — они появятся тут</div>'; return; }
  wrap.innerHTML = S.quickPicks.slice(0, 8).map(t => `
    <div class="qp-card" data-id="${t.id}">
      ${(t.cover_url || t.thumbnail) ? `<img class="qp-art" src="${t.thumbnail}" alt="">` : '<div class="qp-art-ph"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'}
      <div class="qp-meta">
        <div class="qp-title">${esc(t.title || '?')}</div>
        <div class="qp-artist">${esc(t.artist || '')}</div>
      </div>
    </div>`).join('');
  wrap.querySelectorAll('.qp-card').forEach((card, i) => {
    card.addEventListener('click', () => play(S.quickPicks[i]));
  });
}

// ─── SAVE / RESTORE ───────────────────────────────────────
function savePlayback(track) {
  localStorage.setItem('nm_playback_v2', JSON.stringify({ track, ts: Date.now() }));
}

function restorePlayback() {
  if (!S.playback?.track) return;
  updatePlayerUI(S.playback.track, false);
  S.track = S.playback.track;
  document.getElementById('player-bar')?.classList.add('visible');
}

// ─── SPATIAL AUDIO ────────────────────────────────────────
function initSpatial() {
  document.getElementById('sp-power')?.addEventListener('click', () => {
    S.spatialOn = !S.spatialOn;
    document.getElementById('sp-power')?.classList.toggle('on', S.spatialOn);
    if (S.spatialOn) startSpatial(); else stopSpatial();
  });

  ['8d','12d','16d'].forEach(mode => {
    document.getElementById(`sp-mode-${mode}`)?.addEventListener('click', () => {
      S.spatialMode = mode;
      document.querySelectorAll('.sp-mode').forEach(b => b.classList.remove('active'));
      document.getElementById(`sp-mode-${mode}`)?.classList.add('active');
      if (S.spatialOn) { stopSpatial(); startSpatial(); }
    });
  });

  const intSlider = document.getElementById('sp-intensity');
  if (intSlider) {
    intSlider.value = S.spatialIntensity * 100;
    intSlider.addEventListener('input', () => {
      S.spatialIntensity = intSlider.value / 100;
      const v = document.getElementById('sp-intensity-val');
      if (v) v.textContent = Math.round(S.spatialIntensity * 100) + '%';
    });
  }
  const speedSlider = document.getElementById('sp-speed');
  if (speedSlider) {
    speedSlider.value = S.spatialSpeed * 100;
    speedSlider.addEventListener('input', () => {
      S.spatialSpeed = speedSlider.value / 100;
      const v = document.getElementById('sp-speed-val');
      if (v) v.textContent = Math.round(S.spatialSpeed * 100) + '%';
    });
  }

  document.querySelectorAll('.sp-room').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sp-room').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.spatialRoom = btn.dataset.room || 'none';
      applyRoom(S.spatialRoom);
    });
  });
}

function startSpatial() {
  if (!audioCtx) initAudioCtx();
  stopSpatial();
  const speeds = { '8d': 0.5, '12d': 1.0, '16d': 1.8 };
  const baseSpeed = (speeds[S.spatialMode] || 0.5) * S.spatialSpeed * 3;
  let angle = 0;
  function tick() {
    angle += baseSpeed * 0.016;
    const pan = Math.sin(angle) * S.spatialIntensity;
    if (pannerNode) pannerNode.pan.setTargetAtTime(pan, audioCtx.currentTime, 0.03);
    S.spatialAnimId = requestAnimationFrame(tick);
  }
  S.spatialAnimId = requestAnimationFrame(tick);
}

function stopSpatial() {
  if (S.spatialAnimId) { cancelAnimationFrame(S.spatialAnimId); S.spatialAnimId = null; }
  if (pannerNode && audioCtx) pannerNode.pan.setTargetAtTime(0, audioCtx.currentTime, 0.1);
}

function applyRoom(room) {
  if (!audioCtx || !convolverNode) return;
  pannerNode.disconnect();
  if (room === 'none') { pannerNode.connect(audioCtx.destination); return; }
  const lens = { small: 0.5, hall: 1.5, stadium: 3 };
  const len = lens[room] || 1;
  const rate = audioCtx.sampleRate;
  const ir = audioCtx.createBuffer(2, Math.floor(rate * len), rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
  }
  convolverNode.buffer = ir;
  pannerNode.connect(convolverNode);
  convolverNode.connect(audioCtx.destination);
}

function toggleSpatial() {
  S.spatialOpen = !S.spatialOpen;
  document.getElementById('spatial-panel')?.classList.toggle('open', S.spatialOpen);
  document.getElementById('pb-spatial-btn')?.classList.toggle('active', S.spatialOpen);
}

// ─── LYRICS ───────────────────────────────────────────────
function initLyrics() {
  document.getElementById('lp-close')?.addEventListener('click', closeLyrics);
  document.querySelectorAll('.lp-source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lp-source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.lyricsSrc = btn.dataset.src || 'lrclib';
      if (S.track) loadLyrics(S.track);
    });
  });
}

async function loadLyrics(track) {
  const wrap = document.getElementById('lp-inner');
  if (!wrap) return;
  wrap.innerHTML = '<div class="lp-empty">Загрузка...</div>';
  S.lyricsLines = [];
  lastLyricIdx = -1;
  renderKaraoke();
  try {
    const q = new URLSearchParams({ track_name: track.title || '', artist_name: track.artist || '' });
    const res = await fetch(`https://lrclib.net/api/search?${q}`);
    const data = await res.json();
    const lrc = data?.[0]?.syncedLyrics || data?.[0]?.plainLyrics;
    if (lrc) { S.lyricsLines = parseLRC(lrc); renderLyrics(); }
    else wrap.innerHTML = '<div class="lp-empty">Лирика не найдена</div>';
  } catch (_) {
    wrap.innerHTML = '<div class="lp-empty">Не удалось загрузить лирику</div>';
  }
}

function parseLRC(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
    if (m) lines.push({ time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() });
    else if (line.trim() && !line.startsWith('[')) lines.push({ time: null, text: line.trim() });
  }
  return lines.filter(l => l.text);
}

function renderLyrics() {
  // sidebar panel
  const wrap = document.getElementById('lp-inner');
  if (wrap) {
    wrap.innerHTML = S.lyricsLines.map((l, i) =>
      `<div class="lp-line" data-idx="${i}">${esc(l.text)}</div>`).join('');
    wrap.querySelectorAll('.lp-line').forEach((el, i) => {
      el.addEventListener('click', () => { const t = S.lyricsLines[i]?.time; if (t != null) audio.currentTime = t; });
    });
  }
  // karaoke inside full player
  renderKaraoke();
}

function renderKaraoke() {
  const inner = document.getElementById('fp-karaoke-inner');
  if (!inner) return;
  if (!S.lyricsLines.length) {
    inner.innerHTML = '<div class="fp-k-empty">текст не найден</div>'; return;
  }
  inner.innerHTML = S.lyricsLines.map((l, i) =>
    `<div class="fp-k-line" data-idx="${i}">${esc(l.text)}</div>`).join('');
  inner.querySelectorAll('.fp-k-line').forEach((el, i) => {
    el.addEventListener('click', () => { const t = S.lyricsLines[i]?.time; if (t != null) audio.currentTime = t; });
  });
}

let lastLyricIdx = -1;
function syncLyrics(ct) {
  if (!S.lyricsLines.length) return;
  let idx = -1;
  for (let i = 0; i < S.lyricsLines.length; i++) {
    if (S.lyricsLines[i].time != null && S.lyricsLines[i].time <= ct) idx = i;
  }
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;

  // sidebar panel sync
  const wrap = document.getElementById('lp-inner');
  if (wrap) {
    wrap.querySelectorAll('.lp-line').forEach((el, i) => el.classList.toggle('active', i === idx));
    wrap.querySelector('.lp-line.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // karaoke sync
  const inner = document.getElementById('fp-karaoke-inner');
  if (inner) {
    inner.querySelectorAll('.fp-k-line').forEach((el, i) => {
      el.classList.remove('active','prev1','prev2','next1','next2');
      if (i === idx) el.classList.add('active');
      else if (i === idx - 1) el.classList.add('prev1');
      else if (i === idx - 2) el.classList.add('prev2');
      else if (i === idx + 1) el.classList.add('next1');
      else if (i === idx + 2) el.classList.add('next2');
    });
    // scroll karaoke inner so active line is centered
    const lineH = 36;
    const offset = idx * lineH;
    inner.style.transform = `translateY(${-offset}px)`;
  }
}

function toggleLyrics() {
  S.lyricsShowing = !S.lyricsShowing;
  document.getElementById('lyrics-panel')?.classList.toggle('open', S.lyricsShowing);
  document.getElementById('pb-lyrics-btn')?.classList.toggle('active', S.lyricsShowing);
  if (S.lyricsShowing && S.track && !S.lyricsLines.length) loadLyrics(S.track);
}

function closeLyrics() {
  S.lyricsShowing = false;
  document.getElementById('lyrics-panel')?.classList.remove('open');
  document.getElementById('pb-lyrics-btn')?.classList.remove('active');
}

// karaoke toggle inside full player
let _karaokeOn = false;
function toggleKaraoke() {
  _karaokeOn = !_karaokeOn;
  document.getElementById('fp-karaoke')?.style && (document.getElementById('fp-karaoke').style.display = _karaokeOn ? '' : 'none');
  document.getElementById('fp-art-wrap')?.style && (document.getElementById('fp-art-wrap').style.display = _karaokeOn ? 'none' : '');
  document.getElementById('fp-lyrics-btn')?.classList.toggle('active', _karaokeOn);
  if (_karaokeOn && S.track && !S.lyricsLines.length) loadLyrics(S.track);
  if (_karaokeOn) renderKaraoke();
}

// ─── VIDEO BACKGROUND ─────────────────────────────────────
async function loadVideoBackground(track) {
  const videoBg = document.getElementById('fp-video-bg');
  const frame = document.getElementById('fp-yt-frame');
  if (!videoBg || !frame) return;
  if (!S.videoBg) { videoBg.classList.remove('has-video'); frame.src = ''; return; }

  let vid = track.platform === 'youtube' ? (track.youtube_id || track.id) : null;

  if (!vid) {
    const q = encodeURIComponent(`${track.artist} ${track.title}`);
    const instances = ['https://inv.tux.pizza', 'https://invidious.nerdvpn.de', 'https://invidious.privacyredirect.com'];
    try {
      vid = await Promise.any(instances.map(inst =>
        fetch(`${inst}/api/v1/search?q=${q}&type=video`, { signal: AbortSignal.timeout(3000) })
          .then(r => r.json())
          .then(d => { const v = d?.[0]?.videoId; if (!v) throw 0; return v; })
      ));
    } catch (_) {}
  }

  if (!vid) { videoBg.classList.remove('has-video'); frame.src = ''; return; }
  frame.src = `https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&controls=0&loop=1&playlist=${vid}&rel=0`;
  videoBg.classList.add('has-video');
}

// ─── FULL PLAYER ──────────────────────────────────────────
function initFullPlayer() {
  document.getElementById('fp-down')?.addEventListener('click', closeFullPlayer);
  document.getElementById('fp-play')?.addEventListener('click', togglePlay);
  document.getElementById('fp-prev')?.addEventListener('click', playPrev);
  document.getElementById('fp-next')?.addEventListener('click', playNext);
  document.getElementById('fp-fav')?.addEventListener('click', toggleFavCurrent);
  document.getElementById('fp-shuffle')?.addEventListener('click', toggleShuffle);
  document.getElementById('fp-repeat')?.addEventListener('click', cycleRepeat);
  document.getElementById('fp-lyrics-btn')?.addEventListener('click', toggleKaraoke);

  const fpSeek = document.getElementById('fp-seek-input');
  fpSeek?.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (fpSeek.value / 100) * audio.duration;
  });
  const fpSeekTrack = document.querySelector('.fp-seek-track');
  fpSeekTrack?.addEventListener('click', e => {
    if (!audio.duration) return;
    const r = fpSeekTrack.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  const fpVol = document.getElementById('fp-vol');
  if (fpVol) {
    fpVol.value = S.volume * 100;
    fpVol.addEventListener('input', () => {
      S.volume = fpVol.value / 100;
      audio.volume = S.volume;
      if (gainNode) gainNode.gain.value = S.volume;
    });
  }
}

function openFullPlayer() {
  document.getElementById('full-player')?.classList.add('visible');
  if (S.track) updateFullPlayerUI(S.track);
}

function closeFullPlayer() {
  document.getElementById('full-player')?.classList.remove('visible');
}

function updateFullPlayerUI(track) {
  if (!track) return;
  const art = document.getElementById('fp-art');
  const artPh = document.getElementById('fp-art-ph');
  const artBg = document.getElementById('fp-art-bg');
  if (art) art.src = track.thumbnail || '';
  if (art) art.style.display = track.thumbnail ? 'block' : 'none';
  if (artPh) artPh.style.display = track.thumbnail ? 'none' : 'flex';
  if (artBg) artBg.style.backgroundImage = track.thumbnail ? `url(${track.thumbnail})` : '';
  const title = document.getElementById('fp-title');
  const artist = document.getElementById('fp-artist');
  if (title) title.textContent = track.title || 'Неизвестно';
  if (artist) artist.textContent = track.artist || '';
  updateFavBtn();
}

// ─── SETTINGS ─────────────────────────────────────────────
function initSettings() {
  const verEl = document.getElementById('s-ver');
  if (verEl && eAPI?.appVersion) verEl.textContent = 'v' + eAPI.appVersion;

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  const qualSel = document.getElementById('s-quality');
  if (qualSel) {
    qualSel.value = S.quality;
    qualSel.addEventListener('change', () => { S.quality = qualSel.value; localStorage.setItem('nm_quality', S.quality); });
  }

  const volRange = document.getElementById('s-vol');
  const volVal = document.getElementById('s-vol-val');
  if (volRange) {
    volRange.value = S.volume * 100;
    if (volVal) volVal.textContent = Math.round(S.volume * 100) + '%';
    volRange.addEventListener('input', () => {
      S.volume = volRange.value / 100;
      audio.volume = S.volume;
      if (gainNode) gainNode.gain.value = S.volume;
      if (volVal) volVal.textContent = Math.round(S.volume * 100) + '%';
    });
  }

  const cfRange = document.getElementById('s-crossfade');
  const cfVal = document.getElementById('s-crossfade-val');
  if (cfRange) {
    cfRange.value = S.crossfade;
    if (cfVal) cfVal.textContent = S.crossfade + 'с';
    cfRange.addEventListener('input', () => {
      S.crossfade = parseInt(cfRange.value);
      localStorage.setItem('nm_crossfade', S.crossfade);
      if (cfVal) cfVal.textContent = S.crossfade + 'с';
    });
  }

  const vidToggle = document.getElementById('s-videobg');
  if (vidToggle) {
    vidToggle.checked = S.videoBg;
    vidToggle.addEventListener('change', () => { S.videoBg = vidToggle.checked; localStorage.setItem('nm_videobg', S.videoBg); });
  }
  const normToggle = document.getElementById('s-normalize');
  if (normToggle) {
    normToggle.checked = S.normalize;
    normToggle.addEventListener('change', () => { S.normalize = normToggle.checked; localStorage.setItem('nm_normalize', S.normalize); });
  }

  document.getElementById('s-clear-cache')?.addEventListener('click', () => {
    localStorage.removeItem('nm_cached_meta');
    localStorage.removeItem('nm_quick_v1');
    S.quickPicks = [];
    renderQuickPicks();
    alert('Кэш очищен');
  });

  document.getElementById('s-logout')?.addEventListener('click', () => {
    S.user = null; localStorage.removeItem('nm_token'); updateUserUI();
  });
}

function applyTheme(theme) {
  S.theme = theme;
  localStorage.setItem('nm_theme', theme);
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === theme));
}

// ─── USER / AUTH ──────────────────────────────────────────
let _authMode = 'login';

function showLoginModal() {
  const modal = document.getElementById('login-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  _setAuthMode('login');
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-pass').value = '';
  document.getElementById('auth-name').value = '';
  document.getElementById('auth-error').style.display = 'none';
}

function _setAuthMode(mode) {
  _authMode = mode;
  const nameEl = document.getElementById('auth-name');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');
  const submitBtn = document.getElementById('auth-submit-btn');
  const title = document.getElementById('login-tab-title');
  if (mode === 'login') {
    nameEl.style.display = 'none';
    tabLogin.style.background = 'var(--accent)'; tabLogin.style.color = '#fff'; tabLogin.style.border = 'none';
    tabReg.style.background = 'none'; tabReg.style.color = 'var(--dim)'; tabReg.style.border = '1px solid var(--border)';
    submitBtn.textContent = 'Войти';
    if (title) title.textContent = 'Войти';
  } else {
    nameEl.style.display = '';
    tabReg.style.background = 'var(--accent)'; tabReg.style.color = '#fff'; tabReg.style.border = 'none';
    tabLogin.style.background = 'none'; tabLogin.style.color = 'var(--dim)'; tabLogin.style.border = '1px solid var(--border)';
    submitBtn.textContent = 'Зарегистрироваться';
    if (title) title.textContent = 'Регистрация';
  }
}

// Google button → open browser, then show code view
document.getElementById('google-login-btn')?.addEventListener('click', () => {
  eAPI?.openExternal?.('https://music.nodex.pw/auth/google');
  _showCodeView();
});

function _showCodeView() {
  document.getElementById('auth-view-main').style.display = 'none';
  document.getElementById('auth-view-code').style.display = '';
  // reset boxes
  document.querySelectorAll('.code-box').forEach(b => { b.value = ''; b.classList.remove('filled'); });
  document.getElementById('code-error').style.display = 'none';
  setTimeout(() => document.querySelector('.code-box')?.focus(), 50);
}

document.getElementById('code-back-btn')?.addEventListener('click', () => {
  document.getElementById('auth-view-code').style.display = 'none';
  document.getElementById('auth-view-main').style.display = '';
});

// Code boxes — auto-advance on digit input
document.getElementById('code-boxes')?.addEventListener('input', e => {
  const boxes = [...document.querySelectorAll('.code-box')];
  const idx = boxes.indexOf(e.target);
  const val = e.target.value.replace(/\D/g, '');
  e.target.value = val.slice(-1);
  e.target.classList.toggle('filled', !!e.target.value);
  if (val && idx < boxes.length - 1) boxes[idx + 1].focus();
  // auto-submit when all filled
  if (boxes.every(b => b.value)) _submitCode();
});

document.getElementById('code-boxes')?.addEventListener('keydown', e => {
  const boxes = [...document.querySelectorAll('.code-box')];
  const idx = boxes.indexOf(e.target);
  if (e.key === 'Backspace' && !e.target.value && idx > 0) boxes[idx - 1].focus();
});

document.getElementById('code-submit-btn')?.addEventListener('click', _submitCode);

async function _submitCode() {
  const code = [...document.querySelectorAll('.code-box')].map(b => b.value).join('');
  if (code.length < 6) return;
  const errEl = document.getElementById('code-error');
  errEl.style.display = 'none';
  const btn = document.getElementById('code-submit-btn');
  btn.textContent = 'Проверяем…'; btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/poll/${code}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Ошибка');
    const user = data.user;
    S.user = user;
    localStorage.setItem('nm_token', JSON.stringify(user));
    updateUserUI();
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('auth-view-code').style.display = 'none';
    document.getElementById('auth-view-main').style.display = '';
  } catch(e) {
    errEl.textContent = e.message || 'Неверный или истёкший код';
    errEl.style.display = '';
  } finally {
    btn.textContent = 'Подтвердить'; btn.disabled = false;
  }
}

document.getElementById('tab-login')?.addEventListener('click', () => _setAuthMode('login'));
document.getElementById('tab-register')?.addEventListener('click', () => _setAuthMode('register'));

document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
  const username = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value;
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';
  if (!username || !pass) { errEl.textContent = 'Введите логин и пароль'; errEl.style.display = ''; return; }
  try {
    const endpoint = _authMode === 'login' ? `${API}/auth/login` : `${API}/auth/register`;
    const body = { username, password: pass };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || 'Ошибка входа'; errEl.style.display = ''; return; }
    const user = data.user || data;
    if (data.token) localStorage.setItem('nm_bearer', data.token);
    S.user = user;
    localStorage.setItem('nm_token', JSON.stringify(user));
    updateUserUI();
    document.getElementById('login-modal').style.display = 'none';
  } catch(e) {
    errEl.textContent = 'Нет соединения с сервером'; errEl.style.display = '';
  }
});

document.getElementById('guest-login-btn')?.addEventListener('click', () => {
  const m = document.getElementById('login-modal');
  if (m) m.style.display = 'none';
});

document.getElementById('modal-close')?.addEventListener('click', () => {
  const m = document.getElementById('login-modal');
  if (m) m.style.display = 'none';
});

function showUserMenu(e) {
  const menu = document.getElementById('umenu');
  if (!menu) return;
  menu.style.left = (e.clientX - 150) + 'px';
  menu.style.top = (e.clientY + 8) + 'px';
  menu.classList.add('open');
}

function closeUserMenu() {
  document.getElementById('umenu')?.classList.remove('open');
}



function updateUserUI() {
  const token = S.user || JSON.parse(localStorage.getItem('nm_token') || 'null');
  const btn = document.getElementById('login-btn');
  if (!token) {
    if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const menu = document.getElementById('umenu');
    if (menu) menu.innerHTML = '';
    return;
  }
  S.user = token;
  const av = token.avatar ? `<img src="${token.avatar}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:2px solid var(--accent)">` : `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  if (btn) btn.innerHTML = av;
  _renderUserMenu(token);
  const pName = document.getElementById('s-profile-name');
  const pEmail = document.getElementById('s-profile-email');
  if (pName) pName.textContent = token.name || 'Пользователь';
  if (pEmail) pEmail.textContent = token.email || '';
}

function _renderUserMenu(u) {
  const menu = document.getElementById('umenu');
  if (!menu) return;
  const avSrc = u.avatar || '';
  const handle = u.username ? '@' + u.username : (u.email || '');
  menu.innerHTML = `
    <div class="umenu-banner" id="umenu-banner-wrap" style="height:60px;background:var(--bg3);border-radius:8px 8px 0 0;overflow:hidden;position:relative;cursor:pointer" title="Изменить баннер">
      ${u.banner_url ? `<img src="${API.replace('/api','')}${u.banner_url}" style="width:100%;height:100%;object-fit:cover">` : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#4a6fff22,#8b5cf622)"></div>'}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:.15s;background:rgba(0,0,0,.4)" class="umenu-hover-overlay">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </div>
      <input type="file" id="banner-file-input" accept="image/*" style="display:none">
    </div>
    <div style="display:flex;align-items:flex-end;gap:10px;padding:0 14px;margin-top:-20px;margin-bottom:10px">
      <div style="position:relative;cursor:pointer" id="umenu-av-wrap" title="Изменить фото">
        ${avSrc ? `<img src="${avSrc}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:3px solid var(--bg2)">` : `<div style="width:48px;height:48px;border-radius:50%;background:var(--bg3);border:3px solid var(--bg2);display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`}
        <div style="position:absolute;bottom:0;right:0;width:18px;height:18px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" width="10" height="10"><path d="M12 5v14M5 12h14"/></svg>
        </div>
        <input type="file" id="avatar-file-input" accept="image/*" style="display:none">
      </div>
      <div style="flex:1;padding-bottom:2px">
        <div style="font-size:14px;font-weight:600">${esc(u.name || 'Пользователь')}</div>
        <div style="font-size:12px;color:var(--dim)">${esc(handle)}</div>
      </div>
    </div>
    <div style="padding:0 14px 8px;display:flex;flex-direction:column;gap:2px">
      <button id="umenu-edit-username" style="text-align:left;padding:8px 10px;background:none;border:none;cursor:pointer;color:var(--text);font-size:13px;font-family:inherit;border-radius:6px;transition:background .12s;width:100%">Изменить @username</button>
      <button id="umenu-logout" style="text-align:left;padding:8px 10px;background:none;border:none;cursor:pointer;color:#f56;font-size:13px;font-family:inherit;border-radius:6px;transition:background .12s;width:100%">Выйти</button>
    </div>`;

  menu.querySelectorAll('.umenu-hover-overlay').forEach(el => {
    el.closest('[id]')?.addEventListener('mouseenter', () => el.style.opacity = '1');
    el.closest('[id]')?.addEventListener('mouseleave', () => el.style.opacity = '0');
  });

  document.getElementById('umenu-av-wrap')?.addEventListener('click', () => document.getElementById('avatar-file-input')?.click());
  document.getElementById('avatar-file-input')?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await authFetch(`${API}/profile/avatar`, { method: 'POST', body: fd }).then(r => r.json()).catch(() => ({}));
    if (res.avatar_url) { S.user.avatar = API.replace('/api','') + res.avatar_url; localStorage.setItem('nm_token', JSON.stringify(S.user)); updateUserUI(); closeUserMenu(); }
  });

  document.getElementById('umenu-banner-wrap')?.addEventListener('click', () => document.getElementById('banner-file-input')?.click());
  document.getElementById('banner-file-input')?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await authFetch(`${API}/profile/banner`, { method: 'POST', body: fd }).then(r => r.json()).catch(() => ({}));
    if (res.banner_url) { S.user.banner_url = res.banner_url; localStorage.setItem('nm_token', JSON.stringify(S.user)); updateUserUI(); closeUserMenu(); }
  });

  document.getElementById('umenu-edit-username')?.addEventListener('click', () => {
    const cur = u.username || '';
    const val = prompt('Новый @username (a-z 0-9 _ .)', cur);
    if (!val) return;
    authFetch(`${API}/profile/username`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: val}) })
      .then(r => r.json()).then(d => { if (d.ok) { S.user.username = val; localStorage.setItem('nm_token', JSON.stringify(S.user)); updateUserUI(); closeUserMenu(); } else alert(d.detail || 'Ошибка'); });
  });

  document.getElementById('umenu-logout')?.addEventListener('click', () => {
    S.user = null; localStorage.removeItem('nm_token'); localStorage.removeItem('nm_bearer'); updateUserUI(); closeUserMenu();
  });
}

// ─── CTX MENU ─────────────────────────────────────────────
let ctxTarget = null;
function showCtxMenu(e, track) {
  e.preventDefault();
  ctxTarget = track;
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
  menu.style.display = 'block';
}

document.addEventListener('click', () => {
  const m = document.getElementById('ctx-menu');
  if (m) m.style.display = 'none';
  closeUserMenu();
});

document.getElementById('ctx-play')?.addEventListener('click', () => { if (ctxTarget) play(ctxTarget); });
document.getElementById('ctx-fav')?.addEventListener('click', () => {
  if (!ctxTarget) return;
  const idx = S.favs.findIndex(t => t.id === ctxTarget.id);
  if (idx >= 0) S.favs.splice(idx, 1); else S.favs.unshift(ctxTarget);
  localStorage.setItem('nm_favs', JSON.stringify(S.favs));
  renderResults(S.searchResults);
});
document.getElementById('ctx-queue')?.addEventListener('click', () => {
  if (ctxTarget && S.queue.length) S.queue.splice(S.queueIdx + 1, 0, ctxTarget);
});

// ─── UPDATES ──────────────────────────────────────────────
function showUpdateBar(ver, ready) {
  const bar = document.getElementById('update-bar');
  if (!bar) return;
  const msg = document.getElementById('update-msg');
  const btn = document.getElementById('update-action-btn');
  if (msg) msg.textContent = ready ? `v${ver} готово к установке` : `Скачиваем v${ver}…`;
  if (btn) {
    btn.textContent = ready ? 'Установить' : 'Скачать';
    btn.onclick = () => ready ? eAPI?.installUpdate?.() : eAPI?.downloadUpdate?.();
  }
  bar.style.display = 'flex';
  document.getElementById('update-dismiss')?.addEventListener('click', () => { bar.style.display = 'none'; }, { once: true });
}

eAPI?.onUpdateAvailable?.((info) => {
  showUpdateBar(info?.version || '…', false);
});

eAPI?.onUpdateDownloaded?.(() => {
  const msg = document.getElementById('update-msg');
  const btn = document.getElementById('update-action-btn');
  const ver = msg?.textContent?.match(/v([\d.]+)/)?.[1] || '…';
  if (msg) msg.textContent = `v${ver} готово к установке`;
  if (btn) { btn.textContent = 'Установить'; btn.onclick = () => eAPI?.installUpdate?.(); }
});

// ─── UTILS ────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
