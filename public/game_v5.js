/* =========================================================================
   RHYTHM ARENA — game.js (cliente)
   Menús, personajes, opciones, modo solo y multijugador, vida, audio
   progresivo, escenario con la banda y pantallas en vivo de los compañeros.
   ========================================================================= */
(function () {
  'use strict';

  if (typeof RA === 'undefined' || typeof RC === 'undefined') {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;color:#fff">' +
      'No se pudieron cargar <b>engine.js</b> / <b>characters.js</b>. Deben estar junto a index.html.</p>';
    return;
  }

  var DIFFICULTIES = RA.DIFFICULTIES;
  var MISS_WINDOW = RA.MISS_WINDOW;
  var MAX_LANES = RA.MAX_LANES;
  var LANE_COLORS = ['#00e5ff', '#ff2d95', '#ffd400', '#7cff4d', '#ff8a3d', '#b46bff'];
  var DEFAULT_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH'];
  var DEFAULT_GAMEPAD = [14, 13, 12, 15, 4, 5];
  var ARROWS = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
  var TAIL_SECONDS = 2.0;

  function keyLabel(code) {
    if (!code) return '—';
    if (code.indexOf('Key') === 0) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    var map = {
      Space: 'ESPACIO', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', BracketLeft: '[',
      BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', ShiftLeft: 'MAYÚS izq',
      ShiftRight: 'MAYÚS der', ControlLeft: 'CTRL izq', ControlRight: 'CTRL der'
    };
    return map[code] || code.toUpperCase();
  }

  function padLabel(index) {
    if (index == null) return '—';
    var map = {
      0: 'A/Cruz', 1: 'B/Cír', 2: 'X/Cua', 3: 'Y/Tri',
      4: 'LB/L1', 5: 'RB/R1', 6: 'LT/L2', 7: 'RT/R2',
      8: 'Share', 9: 'Option', 10: 'L3', 11: 'R3',
      12: 'D-Pad ↑', 13: 'D-Pad ↓', 14: 'D-Pad ←', 15: 'D-Pad →'
    };
    return map[index] || ('Mando ' + index);
  }

  /* ------------------------------ ajustes ------------------------------ */

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) {}
  }

  var OPT = {
    keys: (function () {
      var k = loadJSON('ra_keys', null);
      if (!Array.isArray(k) || k.length !== MAX_LANES) return DEFAULT_KEYS.slice();
      return k;
    })(),
    gamepad: (function () {
      var g = loadJSON('ra_gamepad', null);
      if (!Array.isArray(g) || g.length !== MAX_LANES) return DEFAULT_GAMEPAD.slice();
      return g;
    })(),
    offsetMs: Number(localStorage.getItem('ra_offset') || 0),
    volume: Number(localStorage.getItem('ra_volume') || 90),
    progressive: loadJSON('ra_progressive', true),
    health: loadJSON('ra_health', true),
    stage: loadJSON('ra_stage', true),
    minis: loadJSON('ra_minis', true)
  };

  /* ------------------------------- estado ------------------------------ */

  var S = {
    socket: null,
    youId: null,
    room: null,
    isHost: false,
    mode: 'solo',                 // 'solo' | 'multi'
    clockOffset: 0,
    name: localStorage.getItem('ra_name') || '',
    characterId: localStorage.getItem('ra_char') || RC.ROSTER[0].id,
    lastRoom: null,
    ctx: null, master: null, musicGain: null, filter: null,
    audioBuffer: null,
    rawAudio: null,
    songName: '',
    fileType: 'audio/mpeg',
    beatmap: null,
    lanes: 4,
    bpm: 0,
    difficulty: 'normal',
    soloDifficulty: 'normal',
    duration: 0,
    analyzing: false,
    launching: false,
    charReturn: 'menu',
    lastResults: null
  };

  var G = {
    running: false, finished: false, dead: false,
    notes: [], cursor: 0, lanes: 4,
    score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0,
    perfect: 0, great: 0, good: 0,
    health: RA.HEALTH.start,
    musicOn: true,
    startCtxTime: 0, source: null, raf: 0, progressTimer: 0,
    laneFlash: [], laneHold: [], pressMask: 0,
    popups: [], particles: [], pointerLane: {},
    peers: {}, peerOrder: [],
    charState: 'play', lastHitAt: 0
  };

  /* --------------------------------- DOM ------------------------------- */

  var $ = function (id) { return document.getElementById(id); };
  var SCREENS = ['menu', 'solo', 'multi', 'characters', 'options', 'lobby', 'game', 'results'];
  var isActive = function (n) { return $('screen-' + n).classList.contains('active'); };
  var currentScreen = function () {
    for (var i = 0; i < SCREENS.length; i++) if (isActive(SCREENS[i])) return SCREENS[i];
    return 'menu';
  };

  function showScreen(name) {
    SCREENS.forEach(function (k) { $('screen-' + k).classList.toggle('active', k === name); });
    if (name === 'game') resizeCanvas();
    if (name === 'characters') renderCharacterGrid();
    if (name === 'solo') drawSoloPreview();
    if (name === 'options') renderKeyList();
  }

  function toast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    $('toast-stack').appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 3400);
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmt = function (n) { return Number(n || 0).toLocaleString('es-ES'); };
  var diffLabel = function (k) { return (DIFFICULTIES[k] || {}).label || k || '—'; };
  var lanesOf = function (k) { return RA.lanesFor(k); };

  /* -------------------------------- audio ------------------------------ */

  function ensureCtx() {
    if (!S.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Este navegador no soporta Web Audio API');
      S.ctx = new AC();
      S.master = S.ctx.createGain();
      S.master.gain.value = OPT.volume / 100;
      S.filter = S.ctx.createBiquadFilter();
      S.filter.type = 'lowpass';
      S.filter.frequency.value = 20000;
      S.musicGain = S.ctx.createGain();
      S.musicGain.gain.value = 1;
      S.musicGain.connect(S.filter);
      S.filter.connect(S.master);
      S.master.connect(S.ctx.destination);
    }
    if (S.ctx.state === 'suspended' && S.ctx.resume) S.ctx.resume();
    return S.ctx;
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { try { ensureCtx(); } catch (e) {} }, { once: true, passive: true });
  });

  /* Audio progresivo: la música se corta al fallar y vuelve al acertar. */
  function setMusic(on, hard) {
    if (!S.ctx || !S.musicGain) return;
    if (!OPT.progressive && !hard) on = true;
    G.musicOn = on;
    var t = S.ctx.currentTime;
    var target = on ? 1 : 0.0;
    S.musicGain.gain.cancelScheduledValues(t);
    S.musicGain.gain.setTargetAtTime(target, t, on ? 0.02 : 0.012);
    S.filter.frequency.cancelScheduledValues(t);
    S.filter.frequency.setTargetAtTime(on ? 20000 : 420, t, on ? 0.03 : 0.02);
  }

  function decodeAudio(arrayBuffer) {
    var ctx = ensureCtx();
    var copy = arrayBuffer.slice(0);
    return new Promise(function (resolve, reject) {
      var p = ctx.decodeAudioData(copy, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  var rafYield = function () {
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
  };

  /* ------------------------------ sincronía ---------------------------- */

  function syncClock(samples) {
    if (!S.socket || !S.socket.connected) return Promise.resolve(0);
    var total = samples || 7;
    var results = [];
    return new Promise(function (resolve) {
      var done = 0, cancelled = false;
      var timeout = setTimeout(function () { cancelled = true; finish(); }, 3000);
      function finish() {
        if (results.length) {
          results.sort(function (a, b) { return a.rtt - b.rtt; });
          var best = results.slice(0, Math.max(1, Math.ceil(results.length / 2)));
          S.clockOffset = best.reduce(function (s, r) { return s + r.offset; }, 0) / best.length;
        }
        clearTimeout(timeout);
        resolve(S.clockOffset);
      }
      function tick() {
        if (cancelled) return;
        var t0 = Date.now();
        S.socket.emit('sync:ping', t0, function (res) {
          if (cancelled || !res) return;
          var t1 = Date.now(), rtt = t1 - t0;
          results.push({ offset: res.serverTime + rtt / 2 - t1, rtt: rtt });
          done++;
          if (done >= total) finish(); else setTimeout(tick, 55);
        });
      }
      tick();
    });
  }
  var serverNow = function () { return Date.now() + S.clockOffset; };

  /* ---------------------------- personajes UI -------------------------- */

  var charAnim = { raf: 0, t: 0, previewId: null };

  function takenCharacters() {
    var taken = {};
    if (S.mode === 'multi' && S.room) {
      S.room.players.forEach(function (p) {
        if (p.id !== S.youId && p.character) taken[p.character] = p.name;
      });
    }
    return taken;
  }

  function renderCharacterGrid() {
    var grid = $('char-grid');
    var taken = takenCharacters();
    grid.innerHTML = '';
    RC.ROSTER.forEach(function (ch) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'char-card' +
        (ch.id === S.characterId ? ' selected' : '') +
        (taken[ch.id] ? ' taken' : '');
      card.dataset.id = ch.id;
      var img = document.createElement('img');
      var chIndex = RC.ROSTER.findIndex(function(c) { return c.id === ch.id; }) + 1;
      img.src = 'assets/Persojanes/' + chIndex + '.png';
      card.appendChild(img);
      var flag = document.createElement('span');
      flag.className = 'cc-flag';
      flag.textContent = ch.id === S.characterId ? 'Tuyo' : (taken[ch.id] ? 'Ocupado' : 'Libre');
      card.appendChild(flag);
      var nm = document.createElement('span');
      nm.className = 'cc-name'; nm.textContent = ch.name;
      card.appendChild(nm);
      var rl = document.createElement('span');
      rl.className = 'cc-role'; rl.textContent = ch.role;
      card.appendChild(rl);
      card.addEventListener('click', function () {
        if (taken[ch.id]) { toast(taken[ch.id] + ' ya eligió a ' + ch.name, 'error'); return; }
        charAnim.previewId = ch.id;
        showCharacterDetail(ch.id);
        startCharAnim();
      });
      grid.appendChild(card);
      // Removed RC.drawPortrait
    });
    $('char-count').textContent = RC.ROSTER.length + ' disponibles';
    charAnim.previewId = charAnim.previewId || S.characterId;
    showCharacterDetail(charAnim.previewId);
    startCharAnim();
  }

  function showCharacterDetail(id) {
    var ch = RC.get(id);
    var taken = takenCharacters();
    $('char-name').textContent = ch.name;
    $('char-role').textContent = ch.role;
    $('char-bio').textContent = ch.bio;
    var instNames = { guitar: 'Guitarra', bass: 'Bajo', keytar: 'Keytar', drums: 'Batería', mic: 'Voz', dj: 'Tornamesa' };
    $('char-inst').textContent = instNames[ch.instrument] || ch.instrument;
    $('char-status').textContent = taken[ch.id] ? 'Ocupado por ' + taken[ch.id]
      : (ch.id === S.characterId ? 'Es tu personaje' : 'Disponible');
    var btn = $('btn-char-pick');
    btn.disabled = !!taken[ch.id];
    btn.textContent = ch.id === S.characterId ? 'Personaje actual' : 'Elegir personaje';
  }

  function startCharAnim() {
    var big = $('char-big');
    var ch = RC.get(charAnim.previewId);
    var chIndex = RC.ROSTER.findIndex(function(c) { return c.id === ch.id; }) + 1;
    big.src = 'assets/Persojanes/' + chIndex + '.png';
  }

  function drawSoloPreview() {
    var img = $('solo-char-canvas');
    var ch = RC.get(S.characterId);
    var chIndex = RC.ROSTER.findIndex(function(c) { return c.id === ch.id; }) + 1;
    img.src = 'assets/Persojanes/' + chIndex + '.png';
    $('solo-char-name').textContent = ch.name;
    $('solo-char-role').textContent = ch.role + ' · ' + ch.bio;
  }

  function applyCharacter(id) {
    S.characterId = id;
    save('ra_char', id);
    $('menu-char-name').textContent = RC.get(id).name;
    if (S.mode === 'multi' && S.socket && S.socket.connected && S.room) {
      S.socket.emit('room:character', { character: id }, function (res) {
        if (res && !res.ok) toast(res.error || 'No se pudo elegir ese personaje', 'error');
      });
    }
    drawSoloPreview();
  }

  /* ------------------------------ opciones ----------------------------- */

  var listening = -1;
  var listeningType = '';

  function renderKeyList() {
    var keyList = $('key-list');
    var padList = $('pad-list');
    if (!padList) return;
    keyList.innerHTML = '';
    padList.innerHTML = '';
    for (var i = 0; i < MAX_LANES; i++) {
      (function (lane) {
        var labelHTML =
          '<span class="key-dot" style="background:' + LANE_COLORS[lane] + ';color:' + LANE_COLORS[lane] + '"></span>' +
          '<span class="key-label">Carril ' + (lane + 1) +
          '<small>' + (lane < 4 ? 'Todas las dificultades' : (lane === 4 ? 'Difícil y Experto' : 'Solo Experto')) + '</small></span>';

        // Keyboard Row
        var keyLi = document.createElement('li');
        keyLi.className = 'key-row';
        keyLi.innerHTML = labelHTML;
        var keyBtn = document.createElement('button');
        keyBtn.type = 'button';
        keyBtn.className = 'key-btn' + (listening === lane && listeningType === 'key' ? ' listening' : '');
        keyBtn.textContent = (listening === lane && listeningType === 'key') ? 'Pulsa tecla…' : keyLabel(OPT.keys[lane]);
        keyBtn.addEventListener('click', function () {
          listening = (listening === lane && listeningType === 'key') ? -1 : lane;
          listeningType = 'key';
          renderKeyList();
        });
        keyLi.appendChild(keyBtn);
        keyList.appendChild(keyLi);

        // Gamepad Row
        var padLi = document.createElement('li');
        padLi.className = 'key-row';
        padLi.innerHTML = labelHTML;
        var padBtn = document.createElement('button');
        padBtn.type = 'button';
        padBtn.className = 'key-btn' + (listening === lane && listeningType === 'pad' ? ' listening' : '');
        padBtn.textContent = (listening === lane && listeningType === 'pad') ? 'Pulsa botón…' : padLabel(OPT.gamepad[lane]);
        padBtn.addEventListener('click', function () {
          listening = (listening === lane && listeningType === 'pad') ? -1 : lane;
          listeningType = 'pad';
          renderKeyList();
        });
        padLi.appendChild(padBtn);
        padList.appendChild(padLi);

      })(i);
    }
  }

  function assignKey(lane, code) {
    if (listeningType !== 'key') return;
    for (var i = 0; i < OPT.keys.length; i++) if (OPT.keys[i] === code && i !== lane) OPT.keys[i] = null;
    OPT.keys[lane] = code;
    save('ra_keys', OPT.keys);
    listening = -1;
    renderKeyList();
    toast('Carril ' + (lane + 1) + ' → ' + keyLabel(code), 'ok');
  }

  function assignGamepad(lane, index) {
    if (listeningType !== 'pad') return;
    for (var i = 0; i < OPT.gamepad.length; i++) if (OPT.gamepad[i] === index && i !== lane) OPT.gamepad[i] = null;
    OPT.gamepad[lane] = index;
    save('ra_gamepad', OPT.gamepad);
    listening = -1;
    renderKeyList();
    toast('Carril ' + (lane + 1) + ' → ' + padLabel(index), 'ok');
  }

  function laneForKey(code) {
    for (var i = 0; i < G.lanes; i++) if (OPT.keys[i] === code) return i;
    if (G.lanes === 4 && ARROWS[code] !== undefined) return ARROWS[code];
    return -1;
  }

  function laneForGamepad(index) {
    for (var i = 0; i < G.lanes; i++) if (OPT.gamepad[i] === index) return i;
    return -1;
  }

  /* ------------------------------ lobby UI ----------------------------- */

  function renderLobby(room) {
    S.room = room;
    S.isHost = room.hostId === S.youId;
    if (!S.analyzing) S.difficulty = room.difficulty;

    $('room-code').textContent = room.code;
    $('player-count').textContent = room.players.length + '/' + room.maxPlayers;

    var list = $('player-list');
    list.innerHTML = '';
    room.players.forEach(function (p) {
      var ch = RC.get(p.character);
      var li = document.createElement('li');
      var cv = document.createElement('canvas');
      cv.width = 46; cv.height = 52;
      li.appendChild(cv);
      var info = document.createElement('span');
      info.className = 'p-name';
      info.innerHTML = esc(p.name) + '<small>' + esc(ch.name) + ' · ' + esc(ch.role) + '</small>';
      li.appendChild(info);
      if (p.isHost) li.insertAdjacentHTML('beforeend', '<span class="tag host">Anfitrión</span>');
      if (p.id === S.youId) li.insertAdjacentHTML('beforeend', '<span class="tag you">Tú</span>');
      list.appendChild(li);
      RC.drawPortrait(cv.getContext('2d'), ch, cv.width, cv.height, 0, { full: true, energy: 0.4 });
    });

    $('host-controls').classList.toggle('hidden', !S.isHost);
    $('guest-controls').classList.toggle('hidden', S.isHost);
    setDiffButtons('room', S.difficulty);

    if (!S.isHost) {
      $('guest-song').textContent = room.songName
        ? 'Última canción: ' + room.songName + ' · ' + diffLabel(room.difficulty)
        : '';
    }
    $('btn-start').disabled = !(S.isHost && S.beatmap && S.beatmap.length && !S.analyzing && !S.launching);
  }

  function setDiffButtons(group, diff) {
    document.querySelectorAll('.diff-group[data-group="' + group + '"] .diff').forEach(function (b) {
      b.classList.toggle('active', b.dataset.diff === diff);
    });
  }

  /* --------------------------- marcador en vivo ------------------------ */

  function renderLiveScores(players) {
    var ul = $('live-scores');
    var sorted = players.slice().sort(function (a, b) {
      return ((a.dead ? 1 : 0) - (b.dead ? 1 : 0)) || (b.score - a.score);
    });
    ul.innerHTML = '';
    sorted.forEach(function (p) {
      var li = document.createElement('li');
      li.className = (p.id === S.youId ? 'me ' : '') + (p.dead ? 'dead' : '');
      li.innerHTML =
        '<div class="ls-top"><span class="ls-name">' + esc(p.name) + '</span>' +
        '<span class="ls-score">' + fmt(p.score) + '</span></div>' +
        '<div class="ls-sub"><span>' + (p.dead ? 'Eliminado' : 'Combo x' + (p.combo || 0)) + '</span>' +
        '<span>' + (p.accuracy == null ? 100 : p.accuracy) + '%</span></div>';
      ul.appendChild(li);
    });
  }

  /* ------------------------ minipantallas de la banda ------------------ */

  function setupMinis(players) {
    var box = $('minis');
    box.innerHTML = '';
    G.peers = {};
    G.peerOrder = [];
    var others = (players || []).filter(function (p) { return p.id !== S.youId; });
    var show = OPT.minis && S.mode === 'multi' && others.length > 0;
    $('minis-title').classList.toggle('hidden', !show);
    box.classList.toggle('hidden', !show);
    if (!show) return;

    others.forEach(function (p) {
      var wrap = document.createElement('div');
      wrap.className = 'mini';
      var cv = document.createElement('canvas');
      cv.width = 108; cv.height = 150;
      wrap.appendChild(cv);
      var nm = document.createElement('div');
      nm.className = 'mini-name';
      nm.textContent = p.name;
      wrap.appendChild(nm);
      box.appendChild(wrap);
      G.peers[p.id] = {
        id: p.id, name: p.name, el: wrap, ctx: cv.getContext('2d'), w: cv.width, h: cv.height,
        score: 0, combo: 0, health: RA.HEALTH.start, dead: false,
        flash: [0, 0, 0, 0, 0, 0], character: p.character
      };
      G.peerOrder.push(p.id);
    });
  }

  function updatePeer(p) {
    var peer = G.peers[p.id];
    if (!peer) return;
    peer.score = p.score;
    peer.combo = p.combo;
    peer.health = p.health == null ? peer.health : p.health;
    if (p.dead && !peer.dead) peer.el.classList.add('dead');
    peer.dead = !!p.dead;
    var mask = p.presses || 0;
    for (var i = 0; i < G.lanes; i++) if (mask & (1 << i)) peer.flash[i] = performance.now();
  }

  function drawMini(peer, songTime) {
    var c = peer.ctx, w = peer.w, h = peer.h;
    var cfg = DIFFICULTIES[S.difficulty] || DIFFICULTIES.normal;
    var hitY = h - 26;
    var pxPerSec = hitY / cfg.approach;
    var laneW = w / G.lanes;
    var now = performance.now();

    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,.04)';
    c.fillRect(0, 0, w, h);

    for (var i = G.cursor; i < G.notes.length; i++) {
      var n = G.notes[i];
      var dt = n.t - songTime;
      if (dt > cfg.approach) break;
      var y = hitY - dt * pxPerSec;
      if (y < -6 || y > hitY + 6) continue;
      c.fillStyle = LANE_COLORS[n.lane];
      c.globalAlpha = 0.85;
      c.fillRect(n.lane * laneW + 2, y - 3, laneW - 4, 6);
      c.globalAlpha = 1;
    }

    for (var l = 0; l < G.lanes; l++) {
      var life = Math.max(0, 1 - (now - peer.flash[l]) / 220);
      c.fillStyle = 'rgba(255,255,255,' + (0.10 + life * 0.7) + ')';
      c.fillRect(l * laneW + 2, hitY, laneW - 4, 5);
    }

    c.fillStyle = 'rgba(255,255,255,.12)';
    c.fillRect(4, 6, w - 8, 5);
    var hp = Math.max(0, Math.min(1, peer.health / RA.HEALTH.max));
    c.fillStyle = hp > 0.5 ? '#7cff4d' : hp > 0.25 ? '#ffd400' : '#ff4d5e';
    c.fillRect(4, 6, (w - 8) * hp, 5);

    c.fillStyle = '#ffd400';
    c.font = '700 11px ' + fontFamily;
    c.textAlign = 'right';
    c.fillText(fmt(peer.score), w - 5, 26);
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,.65)';
    c.fillText('x' + peer.combo, 5, 26);
  }

  /* ------------------------------- canvas ------------------------------ */

  var canvas = $('track');
  var c2d = canvas.getContext('2d');
  var view = { w: 0, h: 0, trackX: 0, trackW: 0, laneW: 0, hitY: 0 };
  var fontFamily = '"Segoe UI", Roboto, Arial, sans-serif';

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = Math.max(280, rect.width || window.innerWidth);
    view.h = Math.max(280, rect.height || window.innerHeight * 0.7);
    canvas.width = Math.floor(view.w * dpr);
    canvas.height = Math.floor(view.h * dpr);
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.trackW = Math.min(view.w * 0.96, 96 * G.lanes + 60);
    view.trackX = (view.w - view.trackW) / 2;
    view.laneW = view.trackW / G.lanes;
    view.hitY = view.h - Math.max(90, Math.min(150, view.h * 0.17));
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () { setTimeout(resizeCanvas, 200); });

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' +
      parseInt(h.substr(4, 2), 16) + ',' + a + ')';
  }
  function roundRect(c, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }
  function spawnParticles(lane, color) {
    var x = view.trackX + lane * view.laneW + view.laneW / 2;
    for (var i = 0; i < 10; i++) {
      G.particles.push({
        x: x, y: view.hitY,
        vx: (Math.random() - 0.5) * 2.6, vy: -Math.random() * 1.9 - 0.4,
        r: 2 + Math.random() * 3.2, color: color,
        born: performance.now(), life: 380 + Math.random() * 240
      });
    }
  }

  /* ----------------------- banda sobre el escenario -------------------- */

  function bandMembers() {
    if (S.mode === 'multi' && S.room && S.room.players.length) {
      return S.room.players.map(function (p) {
        return { name: p.name, character: p.character || RC.ROSTER[0].id, me: p.id === S.youId };
      });
    }
    return [{ name: S.name || 'Tú', character: S.characterId, me: true }];
  }

  function drawBand(c, t) {
    var band = bandMembers();
    var floorY = view.h * 0.70;
    var height = Math.min(view.h * 0.30, 170);
    var slots = band.length;
    var usable = view.w;
    band.forEach(function (m, i) {
      var spread = slots === 1 ? 0.5 : (i + 0.5) / slots;
      var x = usable * (0.12 + spread * 0.76);
      // evita tapar la pista en pantallas estrechas
      if (Math.abs(x - view.w / 2) < view.trackW / 2 + 40) {
        x = x < view.w / 2 ? view.trackX - 60 - (i * 10) : view.trackX + view.trackW + 60 + (i * 10);
      }
      if (x < 40 || x > view.w - 40) return;
      var peer = G.peers[Object.keys(G.peers).filter(function (k) { return G.peers[k].name === m.name; })[0]];
      var state = m.me
        ? (G.dead ? 'miss' : (performance.now() - G.lastHitAt < 260 ? 'play' : (G.combo > 0 ? 'play' : 'idle')))
        : (peer && peer.dead ? 'miss' : 'play');
      var energy = m.me ? Math.min(1, 0.25 + G.combo / 40) : 0.6;
      RC.drawCharacter(c, RC.get(m.character), x, floorY + height * 0.08, height, {
        t: t, energy: energy, state: state
      });
      c.fillStyle = m.me ? '#ffd400' : 'rgba(255,255,255,.75)';
      c.font = '700 11px ' + fontFamily;
      c.textAlign = 'center';
      c.fillText(m.name, x, floorY + height * 0.08 + 16);
    });
  }

  /* ------------------------------ render ------------------------------- */

  function drawFrame(songTime) {
    var cfg = DIFFICULTIES[S.difficulty] || DIFFICULTIES.normal;
    var pxPerSec = view.hitY / cfg.approach;
    var now = performance.now();
    var c = c2d, i;
    var t = now / 1000;

    c.clearRect(0, 0, view.w, view.h);

    if (OPT.stage) {
      drawBand(c, t);
    } else {
      c.fillStyle = '#0a0714';
      c.fillRect(0, 0, view.w, view.h);
    }

    var horizonY = view.h * 0.20; 
    var hitY = view.hitY;
    var trackWTop = view.trackW * 0.15; 
    var trackWBottom = view.trackW * 1.5;

    function proj(dt, lane) {
      var z = dt / cfg.approach; 
      var yPct = 1 - z;
      var y = horizonY + yPct * (hitY - horizonY);
      var tw = trackWTop + yPct * (trackWBottom - trackWTop);
      var tx = view.w / 2 - tw / 2;
      var lw = tw / G.lanes;
      var x = tx + lane * lw;
      return { x: x, y: y, w: lw, tx: tx, tw: tw };
    }

    // pista translúcida trapezoidal
    var bg = c.createLinearGradient(0, horizonY, 0, view.h);
    bg.addColorStop(0, 'rgba(4,3,10,0.40)');
    bg.addColorStop(1, 'rgba(4,3,10,0.88)');
    c.fillStyle = bg;
    c.beginPath();
    var pTop = proj(cfg.approach, 0);
    var pBot = proj(0, 0);
    c.moveTo(pTop.tx, horizonY);
    c.lineTo(pTop.tx + pTop.tw, horizonY);
    c.lineTo(pBot.tx + pBot.tw, view.h);
    c.lineTo(pBot.tx, view.h);
    c.fill();

    c.strokeStyle = 'rgba(255,255,255,0.15)';
    c.lineWidth = 1.5;
    for (i = 0; i <= G.lanes; i++) {
      var p1 = proj(cfg.approach, i);
      var p2 = proj(-0.5, i);
      c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
    }

    for (i = 0; i < G.lanes; i++) {
      var life = Math.max(0, 1 - (now - G.laneFlash[i]) / 260);
      if (life <= 0 && !G.laneHold[i]) continue;
      var alpha = Math.max(life * 0.22, G.laneHold[i] ? 0.15 : 0);
      var ptTop = proj(cfg.approach * 0.6, i);
      var ptBot = proj(0, i);
      var gl = c.createLinearGradient(0, ptTop.y, 0, ptBot.y);
      gl.addColorStop(0, 'rgba(0,0,0,0)');
      gl.addColorStop(1, hexA(LANE_COLORS[i], alpha));
      c.fillStyle = gl;
      c.beginPath();
      c.moveTo(ptTop.x + 1, ptTop.y);
      c.lineTo(ptTop.x + ptTop.w - 1, ptTop.y);
      c.lineTo(ptBot.x + ptBot.w - 1, ptBot.y);
      c.lineTo(ptBot.x + 1, ptBot.y);
      c.fill();
    }

    c.save();
    c.shadowBlur = 18; c.shadowColor = 'rgba(255,255,255,.65)';
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(pBot.tx, view.hitY); c.lineTo(pBot.tx + pBot.tw, view.hitY); c.stroke();
    c.restore();

    for (i = 0; i < G.lanes; i++) {
      var pr = proj(0, i);
      var fl = Math.max(0, 1 - (now - G.laneFlash[i]) / 200);
      var col = LANE_COLORS[i];
      
      var targetW = pr.w * 0.75;
      var targetH = targetW * 0.35;
      var nx = pr.x + pr.w / 2;
      var ny = pr.y;

      c.save();
      
      if (fl > 0) {
        c.shadowBlur = 20 * fl;
        c.shadowColor = col;
      }
      
      // Base (grosor) de la diana
      c.fillStyle = hexA(col, 0.15);
      c.beginPath();
      c.ellipse(nx, ny + targetW * 0.08, targetW / 2, targetH / 2, 0, 0, Math.PI * 2);
      c.fill();
      
      // Anillo superior de la diana
      c.strokeStyle = hexA(col, 0.5 + fl * 0.5);
      c.lineWidth = 3 + fl * 3;
      c.fillStyle = hexA(col, 0.05 + fl * 0.3);
      c.beginPath();
      c.ellipse(nx, ny, targetW / 2, targetH / 2, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      
      c.restore();

      c.fillStyle = hexA('#ffffff', 0.5 + fl * 0.5);
      c.font = '700 ' + Math.max(11, Math.min(16, pr.w * 0.28)) + 'px ' + fontFamily;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      var text = keyLabel(OPT.keys[i]);
      if (OPT.gamepad[i] != null) text += ' / ' + padLabel(OPT.gamepad[i]);
      c.fillText(text, nx, pr.y);
    }

    var endIndex = G.cursor;
    for (i = G.cursor; i < G.notes.length; i++) {
      if (G.notes[i].t - songTime > cfg.approach + 0.35) break;
      endIndex = i;
    }

    for (i = endIndex; i >= G.cursor; i--) {
      var n = G.notes[i];
      var dt = n.t - songTime;
      var isHold = n.duration > 0;
      var holdEndDt = isHold ? (n.t + n.duration - songTime) : dt;

      if (n.judged && !isHold) continue;
      if (n.judged && isHold && holdEndDt < 0) continue;

      var headDt = n.judged ? 0 : Math.max(0, dt);
      var tailDt = Math.min(cfg.approach, holdEndDt);
      if (tailDt < 0) continue;

      var pH = proj(headDt, n.lane);
      var pT = proj(tailDt, n.lane);
      var color = LANE_COLORS[n.lane];

      if (isHold) {
         c.save();
         var alpha = n.holding ? 0.8 : 0.4;
         var hwStart = pH.w * 0.2; 
         var hwEnd = pT.w * 0.2;   
         var nxStart = pH.x + pH.w / 2;
         var nxEnd = pT.x + pT.w / 2;
         
         c.shadowBlur = 10; 
         c.shadowColor = color;
         c.fillStyle = hexA(color, alpha);
         c.beginPath();
         c.moveTo(nxStart - hwStart, pH.y);
         c.lineTo(nxEnd - hwEnd, pT.y);
         c.lineTo(nxEnd + hwEnd, pT.y);
         c.lineTo(nxStart + hwStart, pH.y);
         c.fill();
         c.restore();
      }

      if (!n.judged) {
        var noteW = pH.w * 0.75; 
        var noteH = noteW * 0.35; 
        var thickness = noteW * 0.15; 
        var nx = pH.x + pH.w / 2; 
        var ny = pH.y; 
        
        c.save();
        c.shadowBlur = 12; 
        c.shadowColor = color;
        
        // Base oscura / Lado del cilindro 3D
        c.fillStyle = hexA(color, 0.5);
        c.beginPath();
        c.ellipse(nx, ny + thickness, Math.max(0.1, Math.abs(noteW / 2)), Math.max(0.1, Math.abs(noteH / 2)), 0, 0, Math.PI * 2);
        c.fill();
        
        c.beginPath();
        c.moveTo(nx - noteW / 2, ny);
        c.lineTo(nx - noteW / 2, ny + thickness);
        c.lineTo(nx + noteW / 2, ny + thickness);
        c.lineTo(nx + noteW / 2, ny);
        c.fill();
        
        // Anillo exterior de color
        var ringW = noteW * 0.22;
        c.lineWidth = Math.max(0.1, Math.abs(ringW));
        c.strokeStyle = color;
        c.beginPath();
        c.ellipse(nx, ny, Math.max(0.1, Math.abs((noteW - ringW) / 2)), Math.max(0.1, Math.abs((noteH - ringW) / 2)), 0, 0, Math.PI * 2);
        c.stroke();
        
        // Interior oscuro de la nota
        c.shadowBlur = 0;
        c.fillStyle = '#111';
        c.beginPath();
        c.ellipse(nx, ny, Math.max(0.1, Math.abs((noteW - ringW * 2) / 2)), Math.max(0.1, Math.abs((noteH - ringW * 2 * 0.35) / 2)), 0, 0, Math.PI * 2);
        c.fill();
        
        // Centro blanco brillante
        c.shadowBlur = 12; 
        c.shadowColor = '#fff';
        c.fillStyle = '#fff';
        c.beginPath();
        c.ellipse(nx, ny, Math.max(0.1, Math.abs((noteW - ringW * 2.8) / 2)), Math.max(0.1, Math.abs((noteH - ringW * 2.8 * 0.35) / 2)), 0, 0, Math.PI * 2);
        c.fill();
        
        c.restore();
      }
    }

    for (i = G.particles.length - 1; i >= 0; i--) {
      var p = G.particles[i];
      var age = (now - p.born) / p.life;
      if (age >= 1) { G.particles.splice(i, 1); continue; }
      c.globalAlpha = 1 - age;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x + p.vx * age * 60, p.y + p.vy * age * 60 + age * age * 95, Math.max(0.5, p.r * (1 - age)), 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }

    for (i = G.popups.length - 1; i >= 0; i--) {
      var pu = G.popups[i];
      var pa = (now - pu.born) / 620;
      if (pa >= 1) { G.popups.splice(i, 1); continue; }
      c.globalAlpha = 1 - pa;
      c.fillStyle = pu.color;
      c.font = '900 ' + (26 - pa * 6) + 'px ' + fontFamily;
      c.textAlign = 'center';
      c.fillText(pu.text, view.trackX + view.trackW / 2, view.hitY - 108 - pa * 26);
      c.globalAlpha = 1;
    }

    if (G.combo > 1) {
      c.globalAlpha = .92;
      c.fillStyle = '#fff';
      c.font = '900 38px ' + fontFamily;
      c.textAlign = 'center';
      c.fillText('x' + G.combo, view.trackX + view.trackW / 2, view.hitY - 180);
      c.globalAlpha = .55;
      c.font = '700 12px ' + fontFamily;
      c.fillText('COMBO', view.trackX + view.trackW / 2, view.hitY - 158);
      c.globalAlpha = 1;
    }

    if (OPT.progressive && !G.musicOn && !G.dead && G.running) {
      c.globalAlpha = .75;
      c.fillStyle = '#ff4d5e';
      c.font = '800 13px ' + fontFamily;
      c.textAlign = 'center';
      c.fillText('LA MÚSICA SE DETUVO — ACIERTA PARA SEGUIR TOCANDO', view.w / 2, 26);
      c.globalAlpha = 1;
    }
  }

  /* ------------------------------- motor ------------------------------- */

  function songTimeNow() {
    if (!S.ctx) return 0;
    return S.ctx.currentTime - G.startCtxTime + OPT.offsetMs / 1000;
  }

  function updateHud() {
    $('hud-score').textContent = fmt(G.score);
    $('hud-combo').textContent = 'x' + G.combo;
    $('hud-acc').textContent = RA.accuracy(G.hits, G.misses) + '%';
    $('hud-mult').textContent = 'x' + RA.multiplier(G.combo);
    var pct = Math.max(0, Math.min(100, G.health));
    var fill = $('health-fill');
    fill.style.width = pct + '%';
    fill.className = 'health-fill' + (pct <= 25 ? ' crit' : pct <= 55 ? ' warn' : '');
  }

  function applyJudge(note, delta) {
    var j = RA.judgeDelta(delta);
    if (!j) return false;
    note.judged = true;
    G.score += RA.scoreFor(j.base, G.combo);
    G.combo++;
    G.maxCombo = Math.max(G.maxCombo, G.combo);
    G.hits++;
    G[j.key]++;
    G.lastHitAt = performance.now();
    if (OPT.health) G.health = RA.healthAfter(G.health, j, S.difficulty);
    G.popups.push({ text: j.name, color: j.color, born: performance.now() });
    spawnParticles(note.lane, LANE_COLORS[note.lane]);
    if (!G.musicOn) setMusic(true);
    updateHud();
    return true;
  }

  function registerMiss(note) {
    note.judged = true;
    G.misses++;
    G.combo = 0;
    if (OPT.health) G.health = RA.healthAfter(G.health, null, S.difficulty);
    G.popups.push({ text: 'MISS', color: '#ff4d5e', born: performance.now() });
    setMusic(false);
    updateHud();
    if (OPT.health && G.health <= 0) playerDied();
  }

  function playerDied() {
    if (G.dead) return;
    G.dead = true;
    G.combo = 0;
    setMusic(false, true);
    if (S.mode === 'solo') {
      G.running = false;
      cancelAnimationFrame(G.raf);
      stopSource();
      showGameOver(false);
    } else {
      // online: la canción continúa; el jugador queda inactivo y mira a los demás
      showGameOver(true);
      sendProgress(true);
    }
  }

  function showGameOver(online) {
    var go = $('gameover');
    go.classList.remove('hidden');
    // reinicia la animación de puertas
    var l = go.querySelector('.door-left'), r = go.querySelector('.door-right');
    [l, r].forEach(function (d) { d.style.animation = 'none'; void d.offsetWidth; d.style.animation = ''; });
    $('gameover-sub').textContent = online
      ? 'Te quedaste sin vida. La canción sigue: mira cómo va tu banda.'
      : 'Te quedaste sin vida.';
    $('btn-retry').classList.toggle('hidden', online);
    $('btn-gameover-menu').textContent = online ? 'Seguir mirando' : 'Menú principal';
  }

  function hideGameOver() { $('gameover').classList.add('hidden'); }

  function pressLane(lane) {
    if (lane < 0 || lane >= G.lanes) return;
    G.laneFlash[lane] = performance.now();
    G.laneHold[lane] = true;
    G.pressMask |= (1 << lane);
    if (!G.running || G.dead) return;
    var t = songTimeNow();
    var best = null, bestDelta = Infinity;
    for (var i = G.cursor; i < G.notes.length; i++) {
      var n = G.notes[i];
      if (n.t - t > MISS_WINDOW) break;
      if (n.judged || n.lane !== lane) continue;
      var d = n.t - t;
      if (Math.abs(d) <= MISS_WINDOW && Math.abs(d) < Math.abs(bestDelta)) { best = n; bestDelta = d; }
    }
    if (best) {
      applyJudge(best, bestDelta);
      if (best.duration > 0) {
        best.holding = true;
        G.laneHoldNote[lane] = best;
      }
    } else {
      if (OPT.health && t > 1.0) {
        G.health = Math.max(0, G.health - 2);
        updateHud();
        if (G.health <= 0) playerDied();
      }
    }
  }

  function releaseLane(lane) { 
    if (lane >= 0 && lane < G.lanes) {
      if (G.laneHold) G.laneHold[lane] = false; 
      if (G.laneHoldNote) {
        var hn = G.laneHoldNote[lane];
        if (hn) {
          hn.holding = false;
          G.laneHoldNote[lane] = null;
        }
      }
    }
  }

  function sendProgress(force) {
    if (S.mode !== 'multi' || !S.socket || !S.socket.connected) return;
    if (!G.running && !force) return;
    S.socket.emit('game:progress', {
      score: G.score, combo: G.combo, maxCombo: G.maxCombo,
      hits: G.hits, misses: G.misses,
      health: Math.round(G.health), dead: G.dead, presses: G.pressMask
    });
    G.pressMask = 0;
  }

  function loop() {
    if (!G.running) return;
    var t = songTimeNow();
    var now = performance.now();

    while (G.cursor < G.notes.length) {
      var n = G.notes[G.cursor];
      var endTime = n.t + (n.duration || 0);
      if (n.judged && t > endTime) {
        G.cursor++;
      } else if (!n.judged && t > n.t + MISS_WINDOW) {
        if (G.dead) n.judged = true;
        else registerMiss(n);
        G.cursor++;
      } else {
        break;
      }
    }

    for (var i = 0; i < G.lanes; i++) {
      var hn = G.laneHoldNote[i];
      if (hn && hn.holding) {
        if (now - (hn.lastTick || 0) > 100) {
          G.score += 5 * RA.multiplier(G.combo);
          hn.lastTick = now;
          updateHud();
        }
        if (t >= hn.t + hn.duration) {
          hn.holding = false;
          G.laneHoldNote[i] = null;
        }
      }
    }

    drawFrame(t);

    if (OPT.minis && S.mode === 'multi') {
      G.peerOrder.forEach(function (id) { drawMini(G.peers[id], t); });
    }

    $('time-fill').style.width = (S.duration ? Math.min(100, Math.max(0, (t / S.duration) * 100)) : 0) + '%';

    if (t >= S.duration + TAIL_SECONDS) { finishGame(); return; }
    G.raf = requestAnimationFrame(loop);
  }

  function startGame(startAtServer) {
    hideGameOver();
    G.lanes = lanesOf(S.difficulty);
    showScreen('game');
    resizeCanvas();

    $('game-song').textContent = S.songName || 'Canción';
    $('game-diff').textContent = diffLabel(S.difficulty) + ' · ' + G.lanes + ' carriles · ' +
      S.beatmap.length + ' notas' + (S.bpm ? ' · ' + S.bpm + ' BPM' : '');

    G.running = false; G.finished = false; G.dead = false;
    G.notes = S.beatmap.map(function (n) { return { t: n.t, lane: n.lane, judged: false }; });
    G.cursor = 0;
    G.score = 0; G.combo = 0; G.maxCombo = 0; G.hits = 0; G.misses = 0;
    G.perfect = 0; G.great = 0; G.good = 0;
    G.health = RA.HEALTH.start;
    G.popups = []; G.particles = [];
    G.laneFlash = []; G.laneHold = []; G.laneHoldNote = [];
    for (var i = 0; i < MAX_LANES; i++) { 
      G.laneFlash.push(0); G.laneHold.push(false); G.laneHoldNote.push(null);
    }
    G.pressMask = 0;
    G.musicOn = true;
    updateHud();
    $('time-fill').style.width = '0%';

    var ctx = ensureCtx();
    setMusic(true, true);

    var waitSec = S.mode === 'multi'
      ? Math.max(0.15, (startAtServer - serverNow()) / 1000)
      : 3.0;
    var startCtxTime = ctx.currentTime + waitSec;

    stopSource();
    var source = ctx.createBufferSource();
    source.buffer = S.audioBuffer;
    source.connect(S.musicGain);
    source.start(startCtxTime);
    G.source = source;
    G.startCtxTime = startCtxTime;

    var overlay = $('overlay');
    overlay.classList.remove('hide');

    (function countdown() {
      var remain = startCtxTime - ctx.currentTime;
      if (remain > 0.02) {
        $('overlay-title').textContent = remain <= 3.2 ? String(Math.ceil(remain)) : '¡Prepárate!';
        $('overlay-sub').textContent = laneKeysText();
        requestAnimationFrame(countdown);
      } else {
        $('overlay-title').textContent = '¡YA!';
        $('overlay-sub').textContent = '';
        setTimeout(function () { overlay.classList.add('hide'); }, 300);
        G.running = true;
        G.raf = requestAnimationFrame(loop);
      }
    })();

    clearInterval(G.progressTimer);
    if (S.mode === 'multi') G.progressTimer = setInterval(function () { sendProgress(); }, 140);
  }

  function laneKeysText() {
    var out = [];
    for (var i = 0; i < G.lanes; i++) out.push(keyLabel(OPT.keys[i]));
    return out.join(' · ');
  }

  function stopSource() {
    if (G.source) {
      try { G.source.onended = null; G.source.stop(); } catch (e) {}
      G.source = null;
    }
  }

  function finishGame(aborted) {
    if (G.finished) return;
    G.finished = true;
    G.running = false;
    cancelAnimationFrame(G.raf);
    clearInterval(G.progressTimer);
    stopSource();

    for (var i = G.cursor; i < G.notes.length; i++) {
      if (!G.notes[i].judged) { G.notes[i].judged = true; if (!G.dead) G.misses++; }
    }

    var stats = {
      score: G.score, hits: G.hits, misses: G.misses, maxCombo: G.maxCombo,
      perfect: G.perfect, great: G.great, good: G.good,
      health: Math.round(G.health), dead: G.dead
    };

    if (S.mode === 'multi') {
      $('overlay').classList.remove('hide');
      $('overlay-title').textContent = aborted ? 'Abandonaste' : 'Fin';
      $('overlay-sub').textContent = 'Calculando resultados…';
      S.socket.emit('game:finish', stats);
    } else {
      hideGameOver();
      renderResults({
        songName: S.songName, difficulty: S.difficulty, bpm: S.bpm, noteCount: S.beatmap.length,
        ranking: [Object.assign({
          id: 'me', name: S.name || 'Tú', character: S.characterId, position: 1,
          accuracy: RA.accuracy(G.hits, G.misses)
        }, stats)]
      });
    }
  }

  function resetGameToLobby() {
    G.running = false;
    G.finished = true;
    cancelAnimationFrame(G.raf);
    clearInterval(G.progressTimer);
    stopSource();
    hideGameOver();
  }

  /* ----------------------------- resultados ---------------------------- */

  function renderResults(data) {
    S.lastResults = data;
    $('results-song').textContent = data.songName || 'Canción';
    $('results-diff').textContent =
      'Dificultad: ' + diffLabel(data.difficulty) + ' · ' + lanesOf(data.difficulty) + ' carriles' +
      (data.noteCount ? ' · ' + data.noteCount + ' notas' : '') +
      (data.bpm ? ' · ' + data.bpm + ' BPM' : '');

    var medals = ['🥇', '🥈', '🥉', '4º'];
    var podium = $('podium');
    podium.innerHTML = '';
    data.ranking.slice(0, 4).forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'podium-card' + (i === 0 && !p.dead ? ' first' : '');
      var cv = document.createElement('img');
      var ch = typeof p.character === 'string' ? RC.get(p.character) : p.character;
      var chIndex = ch ? (RC.ROSTER.findIndex(function(c) { return c.id === ch.id; }) + 1) : 1;
      cv.src = 'assets/Persojanes/' + chIndex + '.png';
      cv.style.width = '120px';
      cv.style.height = '130px';
      cv.style.objectFit = 'contain';
      cv.style.borderRadius = '12px';
      cv.style.background = '#0b0813';
      card.appendChild(cv);
      var info = document.createElement('div');
      info.innerHTML =
        '<div class="medal">' + (data.ranking.length > 1 ? medals[i] : '🎸') + '</div>' +
        '<div class="podium-name">' + esc(p.name) + (p.id === S.youId ? ' (tú)' : '') + '</div>' +
        '<div class="podium-score">' + fmt(p.score) + '</div>' +
        '<div class="podium-sub">' + (p.dead ? 'Eliminado · ' : '') + 'Combo x' + p.maxCombo + ' · ' + p.accuracy + '%</div>';
      card.appendChild(info);
      podium.appendChild(card);
    });

    var body = $('rank-body');
    body.innerHTML = '';
    data.ranking.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.className = (p.id === S.youId ? 'me ' : '') + (p.dead ? 'dead' : '');
      tr.innerHTML =
        '<td class="pos">' + p.position + 'º</td>' +
        '<td>' + esc(p.name) + (p.dead ? ' <span class="tag dead">Eliminado</span>' : '') +
        (p.id === S.youId ? ' <span class="tag you">Tú</span>' : '') + '</td>' +
        '<td class="num">' + fmt(p.score) + '</td>' +
        '<td class="num">' + p.hits + '</td>' +
        '<td class="num">' + p.misses + '</td>' +
        '<td class="num">x' + p.maxCombo + '</td>' +
        '<td class="num">' + p.accuracy + '%</td>' +
        '<td class="num hide-mobile">' + p.perfect + ' / ' + p.great + ' / ' + p.good + '</td>';
      body.appendChild(tr);
    });

    $('btn-lobby').textContent = S.mode === 'multi' ? 'Volver al lobby' : 'Otra canción';
    showScreen('results');
  }

  /* -------------------------------- input ------------------------------ */

  document.addEventListener('keydown', function (e) {
    if (listening >= 0 && listeningType === 'key' && isActive('options')) {
      e.preventDefault();
      if (e.code === 'Escape') { listening = -1; renderKeyList(); return; }
      assignKey(listening, e.code);
      return;
    }
    if (e.code === 'Escape' && isActive('game') && G.running) { finishGame(true); return; }
    if (e.repeat || !isActive('game')) return;
    var lane = laneForKey(e.code);
    if (lane < 0) return;
    e.preventDefault();
    pressLane(lane);
  });

  document.addEventListener('keyup', function (e) {
    var lane = laneForKey(e.code);
    if (lane >= 0) releaseLane(lane);
  });

  var lastGamepadState = [];
  function pollGamepads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p) continue;
      if (!lastGamepadState[i]) lastGamepadState[i] = [];
      for (var b = 0; b < p.buttons.length; b++) {
        var pressed = p.buttons[b].pressed;
        if (pressed && !lastGamepadState[i][b]) {
          if (listening >= 0 && listeningType === 'pad' && isActive('options')) {
            assignGamepad(listening, b);
          } else if (isActive('game') && G.running) {
            var lane = laneForGamepad(b);
            if (lane >= 0) pressLane(lane);
          }
        } else if (!pressed && lastGamepadState[i][b]) {
          if (isActive('game')) {
            var lane = laneForGamepad(b);
            if (lane >= 0) releaseLane(lane);
          }
        }
        lastGamepadState[i][b] = pressed;
      }
    }
    requestAnimationFrame(pollGamepads);
  }
  requestAnimationFrame(pollGamepads);

  function laneFromPointer(e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) - view.trackX;
    var lane = Math.floor(x / view.laneW);
    return lane >= 0 && lane < G.lanes ? lane : -1;
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var lane = laneFromPointer(e);
    if (lane >= 0) { G.pointerLane[e.pointerId] = lane; pressLane(lane); }
  });
  canvas.addEventListener('pointerup', function (e) {
    var lane = G.pointerLane[e.pointerId];
    if (lane !== undefined) { releaseLane(lane); delete G.pointerLane[e.pointerId]; }
  });
  canvas.addEventListener('pointercancel', function () {
    G.laneHold = G.laneHold.map(function () { return false; });
    G.pointerLane = {};
  });
  document.addEventListener('contextmenu', function (e) { if (isActive('game')) e.preventDefault(); });

  /* -------------------------------- socket ----------------------------- */

  function connect() {
    if (typeof io !== 'function') {
      $('conn-text').textContent = 'Sin servidor (solo modo individual)';
      return;
    }
    S.socket = io({ transports: ['websocket', 'polling'], reconnectionAttempts: 20 });

    S.socket.on('connect', function () {
      $('conn-dot').classList.add('on');
      $('conn-text').textContent = 'Conectado';
      syncClock();
      if (S.lastRoom && S.mode === 'multi' && !isActive('menu')) {
        S.socket.emit('room:join', { code: S.lastRoom, name: S.name, character: S.characterId }, function (res) {
          if (res && res.ok) {
            S.youId = res.youId;
            renderLobby(res.room);
            showScreen('lobby');
            toast('Reconectado a la sala ' + res.code, 'ok');
          } else {
            S.lastRoom = null;
            showScreen('menu');
            toast('No se pudo reconectar: ' + ((res && res.error) || 'sala cerrada'), 'error');
          }
        });
      }
    });

    S.socket.on('disconnect', function () {
      $('conn-dot').classList.remove('on');
      $('conn-text').textContent = 'Desconectado — reintentando…';
      if (isActive('game') && S.mode === 'multi') {
        resetGameToLobby();
        $('overlay').classList.remove('hide');
        $('overlay-title').textContent = 'Sin conexión';
        $('overlay-sub').textContent = 'Reintentando…';
      }
    });

    S.socket.on('room:state', function (room) {
      S.room = room;
      S.isHost = room.hostId === S.youId;
      var me = room.players.filter(function (p) { return p.id === S.youId; })[0];
      if (me && me.character && me.character !== S.characterId) {
        S.characterId = me.character;
        save('ra_char', S.characterId);
        $('menu-char-name').textContent = RC.get(S.characterId).name;
      }
      if (isActive('lobby')) renderLobby(room);
      if (isActive('characters')) renderCharacterGrid();
      if (isActive('game')) renderLiveScores(room.players);
    });

    S.socket.on('room:notice', function (n) { toast(n.message, n.type === 'leave' ? '' : 'ok'); });

    S.socket.on('game:prepare', function (payload) {
      S.mode = 'multi';
      S.difficulty = payload.difficulty;
      S.duration = payload.duration;
      S.beatmap = payload.beatmap;
      S.songName = payload.songName;
      S.bpm = payload.bpm || 0;
      S.lanes = payload.lanes || lanesOf(payload.difficulty);
      G.lanes = S.lanes;
      S.launching = false;

      hideGameOver();
      showScreen('game');
      $('overlay').classList.remove('hide');
      $('overlay-title').textContent = 'Cargando…';
      $('overlay-sub').textContent = payload.hasAudio ? 'Recibiendo audio del anfitrión' : 'Preparando pista';
      $('game-song').textContent = payload.songName;
      $('game-diff').textContent = diffLabel(payload.difficulty) + ' · ' + S.lanes + ' carriles · ' + payload.beatmap.length + ' notas';
      renderLiveScores((S.room && S.room.players) || []);
      setupMinis((S.room && S.room.players) || []);

      Promise.resolve()
        .then(function () {
          if (payload.hasAudio && payload.audio) {
            var buf = payload.audio instanceof ArrayBuffer ? payload.audio : (payload.audio.buffer || payload.audio);
            return decodeAudio(buf).then(function (ab) { S.audioBuffer = ab; });
          }
          if (!S.audioBuffer) throw new Error('El audio no está disponible en este cliente');
        })
        .then(function () { return syncClock(5); })
        .then(function () {
          $('overlay-title').textContent = 'Sincronizando…';
          $('overlay-sub').textContent = 'Esperando a los demás jugadores';
          S.socket.emit('game:loaded');
        })
        .catch(function (err) {
          console.error(err);
          toast('Error de audio: ' + err.message, 'error');
          S.socket.emit('game:error', { message: err.message });
        });
    });

    S.socket.on('game:start', function (data) { startGame(data.startAt); });

    S.socket.on('game:scores', function (data) {
      if (!isActive('game')) return;
      renderLiveScores(data.players);
      data.players.forEach(function (p) { if (p.id !== S.youId) updatePeer(p); });
    });

    S.socket.on('game:results', function (data) {
      resetGameToLobby();
      renderResults(data);
    });

    S.socket.on('game:abort', function (data) {
      resetGameToLobby();
      toast(data.message || 'Partida cancelada', 'error');
    });

    S.socket.on('room:lobby', function (room) {
      resetGameToLobby();
      S.beatmap = null;
      S.bpm = 0;
      if (!S.isHost) { S.audioBuffer = null; S.rawAudio = null; }
      $('analysis-bar').style.width = '0%';
      $('analysis-text').textContent = 'Esperando archivo de audio…';
      var input = $('input-audio');
      if (input) input.value = '';
      renderLobby(room);
      showScreen('lobby');
    });

    S.socket.on('room:left', function () {
      S.room = null; S.lastRoom = null; S.beatmap = null;
      resetGameToLobby();
      showScreen('menu');
    });
  }

  /* ------------------------------ análisis ----------------------------- */

  function readFile(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('No se pudo leer el archivo')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function analyzeAudio(difficulty, bar, text, onDone) {
    if (!S.audioBuffer || S.analyzing) return Promise.resolve();
    S.analyzing = true;
    S.beatmap = null;
    document.querySelectorAll('.diff').forEach(function (b) { b.disabled = true; });
    text.textContent = 'Analizando picos de energía (FFT multibanda)…';

    return RA.analyze(S.audioBuffer, S.audioBuffer.sampleRate, difficulty, {
      yieldFn: rafYield,
      onProgress: function (p) { bar.style.width = Math.round(p * 100) + '%'; }
    }).then(function (result) {
      S.beatmap = result.notes;
      S.duration = result.duration;
      S.bpm = result.bpm;
      S.lanes = result.lanes;
      S.analyzing = false;
      document.querySelectorAll('.diff').forEach(function (b) { b.disabled = false; });
      var mins = Math.floor(S.duration / 60);
      var secs = String(Math.floor(S.duration % 60));
      if (secs.length < 2) secs = '0' + secs;
      bar.style.width = '100%';
      text.textContent = S.songName + ' · ' + mins + ':' + secs + ' · ' + S.beatmap.length + ' notas · ' +
        diffLabel(difficulty) + ' (' + result.lanes + ' carriles)' + (S.bpm ? ' · ' + S.bpm + ' BPM' : '');
      if (!S.beatmap.length) toast('No se detectaron picos claros en esta pista', 'error');
      if (onDone) onDone();
    }).catch(function (err) {
      console.error(err);
      S.analyzing = false;
      document.querySelectorAll('.diff').forEach(function (b) { b.disabled = false; });
      text.textContent = 'Error al analizar el audio.';
      toast('Error al analizar: ' + err.message, 'error');
    });
  }

  /* ------------------------------ eventos UI --------------------------- */

  // navegación
  document.querySelectorAll('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.back;
      if (btn.id === 'btn-char-back') target = S.charReturn;
      showScreen(target);
    });
  });

  $('btn-menu-solo').addEventListener('click', function () {
    S.mode = 'solo';
    try { ensureCtx(); } catch (e) { toast(e.message, 'error'); }
    setDiffButtons('solo', S.soloDifficulty);
    showScreen('solo');
  });
  $('btn-menu-multi').addEventListener('click', function () {
    S.mode = 'multi';
    try { ensureCtx(); } catch (e) {}
    showScreen('multi');
  });
  $('btn-menu-chars').addEventListener('click', function () {
    S.charReturn = 'menu';
    showScreen('characters');
  });
  $('btn-menu-options').addEventListener('click', function () { showScreen('options'); });
  $('btn-solo-char').addEventListener('click', function () { S.charReturn = 'solo'; showScreen('characters'); });
  $('btn-lobby-char').addEventListener('click', function () { S.charReturn = 'lobby'; showScreen('characters'); });

  $('btn-char-pick').addEventListener('click', function () {
    applyCharacter(charAnim.previewId || S.characterId);
    renderCharacterGrid();
    toast('Personaje: ' + RC.get(S.characterId).name, 'ok');
    showScreen(S.charReturn);
  });

  // opciones
  if ($('tab-keyboard')) {
    $('tab-keyboard').addEventListener('click', function () {
      $('tab-keyboard').classList.add('active');
      $('tab-keyboard').style.background = '#fff';
      $('tab-keyboard').style.color = '#000';
      $('tab-gamepad').classList.remove('active');
      $('tab-gamepad').style.background = '';
      $('tab-gamepad').style.color = '';
      $('controls-keyboard').classList.remove('hidden');
      $('controls-gamepad').classList.add('hidden');
    });
    $('tab-gamepad').addEventListener('click', function () {
      $('tab-gamepad').classList.add('active');
      $('tab-gamepad').style.background = '#fff';
      $('tab-gamepad').style.color = '#000';
      $('tab-keyboard').classList.remove('active');
      $('tab-keyboard').style.background = '';
      $('tab-keyboard').style.color = '';
      $('controls-gamepad').classList.remove('hidden');
      $('controls-keyboard').classList.add('hidden');
    });
  }

  $('input-offset').value = OPT.offsetMs;
  $('offset-value').textContent = OPT.offsetMs;
  $('input-volume').value = OPT.volume;
  $('volume-value').textContent = OPT.volume;
  $('opt-progressive').checked = OPT.progressive;
  $('opt-health').checked = OPT.health;
  $('opt-stage').checked = OPT.stage;
  $('opt-minis').checked = OPT.minis;

  $('input-offset').addEventListener('input', function (e) {
    OPT.offsetMs = Number(e.target.value);
    $('offset-value').textContent = OPT.offsetMs;
    save('ra_offset', String(OPT.offsetMs));
  });
  $('input-volume').addEventListener('input', function (e) {
    OPT.volume = Number(e.target.value);
    $('volume-value').textContent = OPT.volume;
    save('ra_volume', String(OPT.volume));
    if (S.master) S.master.gain.value = OPT.volume / 100;
  });
  $('opt-progressive').addEventListener('change', function (e) {
    OPT.progressive = e.target.checked; save('ra_progressive', OPT.progressive);
    if (OPT.progressive === false) setMusic(true, true);
  });
  $('opt-health').addEventListener('change', function (e) { OPT.health = e.target.checked; save('ra_health', OPT.health); });
  $('opt-stage').addEventListener('change', function (e) { OPT.stage = e.target.checked; save('ra_stage', OPT.stage); });
  $('opt-minis').addEventListener('change', function (e) { OPT.minis = e.target.checked; save('ra_minis', OPT.minis); });
  $('btn-keys-reset').addEventListener('click', function () {
    OPT.keys = DEFAULT_KEYS.slice();
    save('ra_keys', OPT.keys);
    OPT.gamepad = DEFAULT_GAMEPAD.slice();
    save('ra_gamepad', OPT.gamepad);
    listening = -1;
    renderKeyList();
    toast('Controles restaurados', 'ok');
  });

  // dificultad
  document.querySelectorAll('.diff-group').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.diff') : null;
      if (!btn || btn.disabled) return;
      var diff = btn.dataset.diff;
      if (group.dataset.group === 'solo') {
        S.soloDifficulty = diff;
        setDiffButtons('solo', diff);
        if (S.audioBuffer) analyzeAudio(diff, $('solo-bar'), $('solo-text'), function () {
          $('btn-solo-start').disabled = !(S.beatmap && S.beatmap.length);
        });
      } else {
        if (!S.isHost || S.analyzing) return;
        S.difficulty = diff;
        setDiffButtons('room', diff);
        S.socket.emit('room:difficulty', { difficulty: diff });
        if (S.audioBuffer) analyzeAudio(diff, $('analysis-bar'), $('analysis-text'), function () {
          $('btn-start').disabled = !(S.beatmap && S.beatmap.length);
        });
      }
    });
  });

  // solo: archivo y arranque
  $('solo-audio').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 45 * 1024 * 1024) return toast('El archivo supera los 45 MB', 'error');
    try { ensureCtx(); } catch (err) { return toast(err.message, 'error'); }
    S.mode = 'solo';
    S.songName = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
    S.fileType = file.type || 'audio/mpeg';
    $('btn-solo-start').disabled = true;
    $('solo-bar').style.width = '5%';
    $('solo-text').textContent = 'Decodificando audio…';
    readFile(file)
      .then(function (buf) { S.rawAudio = buf; return decodeAudio(buf); })
      .then(function (ab) {
        S.audioBuffer = ab;
        S.duration = ab.duration;
        return analyzeAudio(S.soloDifficulty, $('solo-bar'), $('solo-text'), function () {
          $('btn-solo-start').disabled = !(S.beatmap && S.beatmap.length);
        });
      })
      .catch(function (err) {
        console.error(err);
        S.audioBuffer = null;
        $('solo-bar').style.width = '0%';
        $('solo-text').textContent = 'No se pudo procesar el archivo.';
        toast('Formato de audio no soportado por el navegador', 'error');
      });
  });

  function startSolo() {
    if (!S.beatmap || !S.beatmap.length || !S.audioBuffer) return;
    S.mode = 'solo';
    S.difficulty = S.soloDifficulty;
    setupMinis([]);
    renderLiveScores([{ id: 'me', name: S.name || 'Tú', score: 0, combo: 0, accuracy: 100 }]);
    startGame(0);
  }
  $('btn-solo-start').addEventListener('click', startSolo);
  $('btn-retry').addEventListener('click', function () {
    hideGameOver();
    if (S.mode === 'solo') startSolo();
  });
  $('btn-gameover-menu').addEventListener('click', function () {
    if (S.mode === 'multi') { hideGameOver(); return; }
    resetGameToLobby();
    showScreen('menu');
  });

  // multijugador
  function currentName(fallback) {
    var n = ($('input-name').value || '').trim() || fallback;
    S.name = n;
    save('ra_name', n);
    return n;
  }
  $('input-name').value = S.name;

  $('btn-create').addEventListener('click', function () {
    if (!S.socket) return toast('No hay conexión con el servidor', 'error');
    try { ensureCtx(); } catch (e) { return toast(e.message, 'error'); }
    S.mode = 'multi';
    S.socket.emit('room:create', { name: currentName('Anfitrión'), character: S.characterId }, function (res) {
      if (!res || !res.ok) return toast((res && res.error) || 'Error al crear la sala', 'error');
      S.youId = res.youId;
      S.lastRoom = res.code;
      renderLobby(res.room);
      showScreen('lobby');
      toast('Sala ' + res.code + ' creada', 'ok');
    });
  });

  function joinRoom() {
    if (!S.socket) return toast('No hay conexión con el servidor', 'error');
    var code = ($('input-code').value || '').trim().toUpperCase();
    if (code.length !== 4) return toast('El código tiene 4 caracteres', 'error');
    try { ensureCtx(); } catch (e) { return toast(e.message, 'error'); }
    S.mode = 'multi';
    S.socket.emit('room:join', { code: code, name: currentName('Jugador'), character: S.characterId }, function (res) {
      if (!res || !res.ok) return toast((res && res.error) || 'No se pudo unir', 'error');
      S.youId = res.youId;
      S.lastRoom = res.code;
      renderLobby(res.room);
      showScreen('lobby');
    });
  }
  $('btn-join').addEventListener('click', joinRoom);
  $('input-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') joinRoom(); });
  $('input-code').addEventListener('input', function (e) {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('btn-copy').addEventListener('click', function () {
    var code = $('room-code').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast('Código copiado: ' + code, 'ok'); },
        function () { toast('Código: ' + code); });
    } else toast('Código: ' + code);
  });

  function leave() {
    S.lastRoom = null;
    resetGameToLobby();
    if (S.socket) S.socket.emit('room:leave');
    showScreen('menu');
  }
  $('btn-leave').addEventListener('click', leave);
  $('btn-exit').addEventListener('click', function () {
    if (S.mode === 'multi') leave();
    else { resetGameToLobby(); showScreen('menu'); }
  });
  $('btn-lobby').addEventListener('click', function () {
    if (S.mode === 'multi') S.socket.emit('room:backToLobby');
    else showScreen('solo');
  });

  $('input-audio').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 45 * 1024 * 1024) return toast('El archivo supera los 45 MB', 'error');
    try { ensureCtx(); } catch (err) { return toast(err.message, 'error'); }
    $('btn-start').disabled = true;
    $('analysis-bar').style.width = '5%';
    $('analysis-text').textContent = 'Decodificando audio…';
    S.songName = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
    S.fileType = file.type || 'audio/mpeg';
    readFile(file)
      .then(function (buf) { S.rawAudio = buf; return decodeAudio(buf); })
      .then(function (ab) {
        S.audioBuffer = ab;
        S.duration = ab.duration;
        return analyzeAudio(S.difficulty, $('analysis-bar'), $('analysis-text'), function () {
          $('btn-start').disabled = !(S.beatmap && S.beatmap.length);
        });
      })
      .catch(function (err) {
        console.error(err);
        S.audioBuffer = null; S.rawAudio = null; S.beatmap = null;
        $('analysis-bar').style.width = '0%';
        $('analysis-text').textContent = 'No se pudo procesar el archivo.';
        toast('Formato de audio no soportado por el navegador', 'error');
      });
  });

  $('btn-start').addEventListener('click', function () {
    if (!S.isHost || !S.beatmap || !S.beatmap.length || !S.rawAudio || S.launching) return;
    S.launching = true;
    $('btn-start').disabled = true;
    $('analysis-text').textContent = 'Enviando canción a la sala…';
    S.socket.emit('game:launch', {
      difficulty: S.difficulty, songName: S.songName, duration: S.duration, bpm: S.bpm,
      beatmap: S.beatmap, audioType: S.fileType, audio: S.rawAudio
    }, function (res) {
      if (!res || !res.ok) {
        S.launching = false;
        $('btn-start').disabled = false;
        toast((res && res.error) || 'No se pudo iniciar la partida', 'error');
      }
    });
  });

  window.addEventListener('beforeunload', function () {
    if (S.socket && S.socket.connected) S.socket.emit('room:leave');
  });

  /* ------------------------------- arranque ---------------------------- */

  $('menu-char-name').textContent = RC.get(S.characterId).name;
  renderKeyList();
  resizeCanvas();
  connect();
})();
