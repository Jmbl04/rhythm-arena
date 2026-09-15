'use strict';

/* =========================================================================
   RHYTHM ARENA — tests/audit.js
   Auditoría automática con 5 agentes independientes. Ejecuta:  npm run audit
   Requiere devDependency socket.io-client.
   ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RA = require(path.join(ROOT, 'public', 'engine.js'));

let ioClient = null;
try { ioClient = require('socket.io-client'); } catch (e) { /* se reporta luego */ }

const results = [];
const log = (...a) => console.log(...a);

function agent(name) {
  const rec = { name, checks: [], pass: 0, fail: 0 };
  results.push(rec);
  return {
    check(label, ok, detail) {
      rec.checks.push({ label, ok: !!ok, detail });
      ok ? rec.pass++ : rec.fail++;
      log(`   ${ok ? '✔' : '✘'} ${label}${detail ? '  ' + detail : ''}`);
      return !!ok;
    },
    record: rec
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getHttp(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function startServer(cwd, port, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(cwd, 'server.js')], {
      cwd,
      env: Object.assign({}, process.env, { PORT: String(port) }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error('timeout arrancando servidor: ' + out)), 8000);
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (out.includes('RHYTHM ARENA')) { clearTimeout(timer); setTimeout(() => resolve({ child, out }), 250); }
    });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('exit', () => { clearTimeout(timer); });
  });
}

/* ====================== AGENTE 1 — ESTRUCTURA / HTTP ==================== */

async function agentStructure() {
  log('\n▸ AGENTE 1 · Estructura y servidor HTTP');
  const A = agent('Estructura y HTTP');

  const files = ['package.json', 'server.js', 'public/index.html', 'public/style.css',
    'public/engine.js', 'public/characters.js', 'public/game.js', 'public/assets/stage-bg.jpg'];
  files.forEach((f) => A.check('existe ' + f, fs.existsSync(path.join(ROOT, f))));

  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  A.check('index.html enlaza engine.js, characters.js y game.js',
    html.includes('engine.js') && html.includes('characters.js') && html.includes('game.js'));
  A.check('el menú principal usa la imagen de fondo del escenario',
    fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8').includes('assets/stage-bg.jpg'));
  A.check('index.html usa rutas relativas (portátil)', !/src="\/(engine|game)\.js"/.test(html));

  // Layout estándar (public/)
  const s1 = await startServer(ROOT, 3311);
  try {
    const root = await getHttp('http://localhost:3311/');
    A.check('GET / devuelve 200 con el cliente', root.status === 200 && root.body.includes('RHYTHM'));
    const css = await getHttp('http://localhost:3311/style.css');
    A.check('GET /style.css 200', css.status === 200);
    const eng = await getHttp('http://localhost:3311/engine.js');
    A.check('GET /engine.js 200', eng.status === 200);
    const sio = await getHttp('http://localhost:3311/socket.io/socket.io.js');
    A.check('cliente socket.io servido por el servidor', sio.status === 200);
    const health = JSON.parse((await getHttp('http://localhost:3311/health')).body);
    A.check('/health responde ok', health.ok === true, health.publicDir ? '' : '(sin publicDir)');
  } finally { s1.child.kill(); }

  // Layout plano: todo en la misma carpeta (el fallo reportado por el usuario)
  const flat = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-flat-'));
  ['server.js', 'package.json'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(flat, f)));
  ['index.html', 'style.css', 'engine.js', 'characters.js', 'game.js'].forEach((f) =>
    fs.copyFileSync(path.join(ROOT, 'public', f), path.join(flat, f)));
  fs.cpSync(path.join(ROOT, 'public', 'assets'), path.join(flat, 'assets'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'node_modules'), path.join(flat, 'node_modules'), { recursive: true });
  const s2 = await startServer(flat, 3312);
  try {
    const root = await getHttp('http://localhost:3312/');
    A.check('funciona con todos los archivos en una sola carpeta', root.status === 200 && root.body.includes('RHYTHM'));
  } finally { s2.child.kill(); fs.rmSync(flat, { recursive: true, force: true }); }

  // Sin cliente: mensaje de ayuda en vez de ENOENT
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-empty-'));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(empty, 'server.js'));
  fs.cpSync(path.join(ROOT, 'node_modules'), path.join(empty, 'node_modules'), { recursive: true });
  const s3 = await startServer(empty, 3313);
  try {
    const root = await getHttp('http://localhost:3313/');
    A.check('sin index.html devuelve página de ayuda (no ENOENT)',
      root.status === 500 && root.body.includes('Faltan los archivos'));
  } finally { s3.child.kill(); fs.rmSync(empty, { recursive: true, force: true }); }
}

/* ====================== AGENTE 2 — MOTOR DE AUDIO ====================== */

function synthTrack({ sr = 44100, dur = 40, bpm = 128 } = {}) {
  const pcm = new Float32Array(Math.floor(sr * dur));
  const beat = 60 / bpm;
  const truth = [];
  let idx = 0;
  for (let t = 1; t < dur - 1; t += beat / 2) {
    const low = idx % 2 === 0;
    const f = low ? 55 : 6200;
    const n = Math.floor(t * sr);
    const len = Math.floor(sr * 0.1);
    for (let i = 0; i < len && n + i < pcm.length; i++) {
      const env = Math.exp(-i / (sr * (low ? 0.03 : 0.012)));
      pcm[n + i] += 0.85 * env * Math.sin((2 * Math.PI * f * i) / sr);
      if (!low) pcm[n + i] += 0.35 * env * (Math.random() * 2 - 1);
    }
    truth.push({ t: Math.round(t * 1000) / 1000, low });
    idx++;
  }
  // colchón armónico + ruido de fondo para simular música real
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] += 0.06 * Math.sin((2 * Math.PI * 220 * i) / sr) + 0.012 * (Math.random() * 2 - 1);
  }
  return { pcm, sr, dur, bpm, truth };
}

async function agentEngine() {
  log('\n▸ AGENTE 2 · Motor de análisis (FFT multibanda, tempo, beatmap)');
  const A = agent('Motor de análisis');

  const track = synthTrack();
  const TOL = 0.06;
  const report = [];

  for (const diff of ['easy', 'normal', 'hard', 'expert']) {
    const t0 = Date.now();
    const r = await RA.analyze(track.pcm, track.sr, diff);
    const ms = Date.now() - t0;

    const covered = new Set();
    let spurious = 0;
    const errs = [];
    let laneOK = 0, laneTotal = 0;

    r.notes.forEach((n) => {
      let bi = -1, bd = Infinity;
      track.truth.forEach((tr, i) => {
        const d = Math.abs(tr.t - n.t);
        if (d < bd) { bd = d; bi = i; }
      });
      if (bd <= TOL) {
        covered.add(bi);
        errs.push((n.t - track.truth[bi].t) * 1000);
        if (!covered.hasLane) { /* noop */ }
        laneTotal++;
        const half = (RA.DIFFICULTIES[diff].lanes) / 2;
        if (track.truth[bi].low ? n.lane < half : n.lane >= half) laneOK++;
      } else spurious++;
    });

    const recall = covered.size / track.truth.length;
    const precision = 1 - spurious / Math.max(1, r.notes.length);
    const laneAcc = laneTotal ? laneOK / laneTotal : 0;
    const meanErr = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
    const nps = r.notes.length / track.dur;
    const cfg = RA.DIFFICULTIES[diff];

    report.push({ diff, notes: r.notes.length, recall, precision, laneAcc, meanErr, ms, bpm: r.bpm, nps });

    A.check(`[${diff}] tempo detectado ≈ ${track.bpm} BPM`, Math.abs(r.bpm - track.bpm) < 2.5, `→ ${r.bpm}`);
    A.check(`[${diff}] precisión temporal < 25 ms`, Math.abs(meanErr) < 25, `→ ${meanErr.toFixed(1)} ms`);
    A.check(`[${diff}] onsets reales detectados sin invención`, precision >= 0.8,
      `precisión ${(precision * 100).toFixed(1)}%`);
    A.check(`[${diff}] densidad dentro del límite (${cfg.maxNPS} n/s)`, nps <= cfg.maxNPS + 0.2,
      `→ ${nps.toFixed(2)} n/s`);
    A.check(`[${diff}] separación mínima respetada (${cfg.minGap}s)`, (() => {
      for (let i = 1; i < r.notes.length; i++) {
        const dt = r.notes[i].t - r.notes[i - 1].t;
        if (dt > 0.001 && dt < cfg.minGap - 0.02) return false;
      }
      return true;
    })());
    A.check(`[${diff}] carriles válidos 0-${cfg.lanes - 1} y orden temporal`, r.notes.every((n, i) =>
      n.lane >= 0 && n.lane < cfg.lanes && (i === 0 || n.t >= r.notes[i - 1].t)));
    A.check(`[${diff}] declara ${cfg.lanes} carriles y reparte las notas entre ellos`,
      r.lanes === cfg.lanes && new Set(r.notes.map((n) => n.lane)).size >= 2);
    A.check(`[${diff}] análisis rápido (<2 s para 40 s de audio)`, ms < 2000, `→ ${ms} ms`);
    if (diff !== 'easy') {
      A.check(`[${diff}] recall ≥ 90 %`, recall >= 0.9, `→ ${(recall * 100).toFixed(1)}%`);
      A.check(`[${diff}] carril coherente con la frecuencia ≥ 70 %`, laneAcc >= 0.7,
        `→ ${(laneAcc * 100).toFixed(1)}%`);
    } else {
      A.check('[easy] selecciona un subconjunto más ligero que normal', r.notes.length < track.truth.length,
        `→ ${r.notes.length}/${track.truth.length}`);
    }
  }

  // Pista con seis registros distintos: debe ocupar todos los carriles de cada dificultad
  const multi = new Float32Array(44100 * 24);
  const freqs = [60, 170, 420, 1100, 3000, 7800];
  for (let t = 1, k = 0; t < 23; t += 0.28, k++) {
    const f = freqs[k % freqs.length];
    const n = Math.floor(t * 44100);
    for (let i = 0; i < 44100 * 0.08 && n + i < multi.length; i++) {
      multi[n + i] += 0.85 * Math.exp(-i / (44100 * 0.02)) * Math.sin((2 * Math.PI * f * i) / 44100);
    }
  }
  for (const d of ['easy', 'normal', 'hard', 'expert']) {
    const r = await RA.analyze(multi, 44100, d);
    const used = new Set(r.notes.map((n) => n.lane)).size;
    A.check(`[${d}] con música de registro amplio usa los ${RA.lanesFor(d)} carriles`,
      used === RA.lanesFor(d), `→ ${used}`);
  }

  A.check('Fácil y Normal usan 4 carriles', RA.lanesFor('easy') === 4 && RA.lanesFor('normal') === 4);
  A.check('Difícil usa 5 carriles', RA.lanesFor('hard') === 5);
  A.check('Experto usa 6 carriles', RA.lanesFor('expert') === 6);

  // Escalado de dificultad
  const byDiff = Object.fromEntries(report.map((r) => [r.diff, r.notes]));
  A.check('la densidad crece con la dificultad',
    byDiff.easy <= byDiff.normal && byDiff.normal <= byDiff.hard && byDiff.hard <= byDiff.expert,
    `${byDiff.easy} ≤ ${byDiff.normal} ≤ ${byDiff.hard} ≤ ${byDiff.expert}`);
  A.check('la velocidad de caída crece con la dificultad',
    RA.DIFFICULTIES.easy.approach > RA.DIFFICULTIES.normal.approach &&
    RA.DIFFICULTIES.normal.approach > RA.DIFFICULTIES.hard.approach &&
    RA.DIFFICULTIES.hard.approach > RA.DIFFICULTIES.expert.approach);

  // Casos límite
  const silence = await RA.analyze(new Float32Array(44100 * 5), 44100, 'normal');
  A.check('audio en silencio no genera notas basura', silence.notes.length <= 3, `→ ${silence.notes.length}`);
  const tiny = await RA.analyze(new Float32Array(500), 44100, 'normal');
  A.check('audio muy corto no rompe el analizador', Array.isArray(tiny.notes) && tiny.notes.length === 0);

  // FFT correcta frente a DFT directa
  const N = 64, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * 5 * i) / N) + 0.5 * Math.cos((2 * Math.PI * 11 * i) / N);
  const refRe = new Float64Array(N), refIm = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      refRe[k] += re[n] * Math.cos((-2 * Math.PI * k * n) / N);
      refIm[k] += re[n] * Math.sin((-2 * Math.PI * k * n) / N);
    }
  }
  new RA.FFT(N).transform(re, im);
  let maxDiff = 0;
  for (let k = 0; k < N; k++) {
    maxDiff = Math.max(maxDiff, Math.abs(Math.hypot(re[k], im[k]) - Math.hypot(refRe[k], refIm[k])));
  }
  A.check('FFT coincide con la DFT de referencia', maxDiff < 1e-6, `err ${maxDiff.toExponential(1)}`);

  return report;
}

/* ====================== AGENTE 3 — REGLAS DE JUEGO ===================== */

async function agentRules() {
  log('\n▸ AGENTE 3 · Reglas de juego (juicio, combo, puntuación, ranking)');
  const A = agent('Reglas de juego');

  A.check('ventanas ordenadas perfect < great < good < miss',
    RA.JUDGEMENTS[0].window < RA.JUDGEMENTS[1].window &&
    RA.JUDGEMENTS[1].window < RA.JUDGEMENTS[2].window &&
    RA.JUDGEMENTS[2].window < RA.MISS_WINDOW);
  A.check('golpe exacto = PERFECT', RA.judgeDelta(0).name === 'PERFECT');
  A.check('±54 ms = PERFECT', RA.judgeDelta(-0.054).name === 'PERFECT');
  A.check('±80 ms = GREAT', RA.judgeDelta(0.08).name === 'GREAT');
  A.check('±140 ms = GOOD', RA.judgeDelta(-0.14).name === 'GOOD');
  A.check('fuera de ventana = sin juicio (miss)', RA.judgeDelta(0.25) === null);
  A.check('simetría temprano/tardío', RA.judgeDelta(0.09).name === RA.judgeDelta(-0.09).name);

  A.check('multiplicador x1 con combo 0-9', RA.multiplier(0) === 1 && RA.multiplier(9) === 1);
  A.check('multiplicador x2 a partir de 10', RA.multiplier(10) === 2);
  A.check('multiplicador x3 a partir de 20', RA.multiplier(20) === 3);
  A.check('multiplicador tope x4', RA.multiplier(30) === 4 && RA.multiplier(999) === 4);

  A.check('puntuación base PERFECT sin combo', RA.scoreFor(100, 0) === 100);
  A.check('puntuación escala con el combo', RA.scoreFor(100, 9) === 200 && RA.scoreFor(100, 19) === 300);
  A.check('precisión 0 fallos = 100 %', RA.accuracy(10, 0) === 100);
  A.check('precisión mixta correcta', RA.accuracy(3, 1) === 75);

  // Simulación completa de una partida contra un beatmap real
  const track = synthTrack({ dur: 20, bpm: 120 });
  const map = (await RA.analyze(track.pcm, track.sr, 'normal')).notes;
  function simulate(offsetMs, missEvery) {
    let combo = 0, score = 0, hits = 0, misses = 0, maxCombo = 0;
    map.forEach((n, i) => {
      if (missEvery && i % missEvery === 0) { misses++; combo = 0; return; }
      const j = RA.judgeDelta(offsetMs / 1000);
      if (!j) { misses++; combo = 0; return; }
      score += RA.scoreFor(j.base, combo);
      combo++; hits++;
      maxCombo = Math.max(maxCombo, combo);
    });
    return { score, hits, misses, maxCombo, accuracy: RA.accuracy(hits, misses) };
  }
  const perfectRun = simulate(0, 0);
  const sloppyRun = simulate(85, 0);
  const missyRun = simulate(0, 4);

  A.check('partida perfecta puntúa más que una imprecisa', perfectRun.score > sloppyRun.score,
    `${perfectRun.score} > ${sloppyRun.score}`);
  A.check('fallar rompe el combo y baja la puntuación', missyRun.score < perfectRun.score && missyRun.maxCombo < perfectRun.maxCombo);
  A.check('acertadas + falladas = total de notas', perfectRun.hits + perfectRun.misses === map.length);
  A.check('precisión 100 % en partida perfecta', perfectRun.accuracy === 100);

  // Sistema de vida
  A.check('la vida arranca al máximo', RA.HEALTH.start === 100 && RA.HEALTH.max === 100);
  A.check('fallar baja la vida', RA.healthAfter(100, null, 'normal') < 100);
  A.check('acertar la recupera', RA.healthAfter(50, RA.JUDGEMENTS[0], 'normal') > 50);
  A.check('la vida nunca pasa de 100', RA.healthAfter(99.5, RA.JUDGEMENTS[0], 'normal') === 100);
  A.check('la vida nunca baja de 0', RA.healthAfter(2, null, 'expert') === 0);
  A.check('PERFECT recupera más que GOOD',
    RA.healthAfter(50, RA.JUDGEMENTS[0], 'normal') > RA.healthAfter(50, RA.JUDGEMENTS[2], 'normal'));
  A.check('Experto castiga más los fallos que Fácil',
    RA.healthAfter(100, null, 'expert') < RA.healthAfter(100, null, 'easy'));
  A.check('con ~13 fallos seguidos se pierde en Normal', (() => {
    let hp = RA.HEALTH.start, n = 0;
    while (hp > 0 && n < 100) { hp = RA.healthAfter(hp, null, 'normal'); n++; }
    return n >= 10 && n <= 16;
  })());
  A.check('alternar acierto/fallo drena la vida igualmente', (() => {
    let hp = RA.HEALTH.start;
    for (let i = 0; i < 40; i++) hp = RA.healthAfter(hp, i % 2 ? RA.JUDGEMENTS[0] : null, 'normal');
    return hp < RA.HEALTH.start && hp > 0;
  })());

  const deadRank = RA.rank([
    { name: 'Vivo', score: 500, maxCombo: 5, misses: 20, dead: false },
    { name: 'Muerto', score: 9000, maxCombo: 40, misses: 2, dead: true }
  ]);
  A.check('un jugador eliminado queda por debajo de quien termina',
    deadRank[0].name === 'Vivo' && deadRank[1].name === 'Muerto');

  const ranking = RA.rank([
    { name: 'A', score: 1000, maxCombo: 10, misses: 5 },
    { name: 'B', score: 1000, maxCombo: 25, misses: 1 },
    { name: 'C', score: 2500, maxCombo: 5, misses: 9 }
  ]);
  A.check('ranking ordena por puntuación y desempata por combo',
    ranking[0].name === 'C' && ranking[1].name === 'B' && ranking[2].name === 'A');
  A.check('posiciones 1..n asignadas', ranking.map((r) => r.position).join() === '1,2,3');
}

/* ====================== AGENTE 4 — MULTIJUGADOR ======================== */

function client(port) {
  return ioClient('http://localhost:' + port, { transports: ['websocket'], forceNew: true });
}
function once(sock, ev, ms = 9000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout esperando ' + ev)), ms);
    sock.once(ev, (d) => { clearTimeout(to); resolve(d); });
  });
}
function emitAck(sock, ev, payload, ms = 9000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout ack ' + ev)), ms);
    sock.emit(ev, payload, (res) => { clearTimeout(to); resolve(res); });
  });
}
const connected = (s) => new Promise((r) => s.on('connect', r));

async function agentMultiplayer() {
  log('\n▸ AGENTE 4 · Multijugador, sincronía y resultados');
  const A = agent('Multijugador');
  if (!ioClient) { A.check('socket.io-client instalado', false, '→ npm i -D socket.io-client'); return; }

  const PORT = 3321;
  const srv = await startServer(ROOT, PORT);
  const socks = [];
  const mk = () => { const s = client(PORT); socks.push(s); return s; };

  try {
    const host = mk(); await connected(host);
    const p2 = mk(); await connected(p2);
    const p3 = mk(); await connected(p3);
    const p4 = mk(); await connected(p4);

    const created = await emitAck(host, 'room:create', { name: 'Host', character: 'luna' });
    A.check('crear sala devuelve código de 4 caracteres', created.ok && /^[A-Z0-9]{4}$/.test(created.code), '→ ' + created.code);
    const code = created.code;

    A.check('el anfitrión conserva el personaje elegido', created.room.players[0].character === 'luna');

    const j2 = await emitAck(p2, 'room:join', { code: code.toLowerCase(), name: 'Ana', character: 'zara' });
    A.check('unirse con el código (insensible a mayúsculas)', j2.ok && j2.room.players.length === 2);
    A.check('cada jugador entra con su personaje', j2.room.players[1].character === 'zara');

    const dup = await emitAck(p2, 'room:character', { character: 'luna' });
    A.check('no se puede elegir un personaje ya ocupado', !dup.ok && /ya eligió/i.test(dup.error));
    const swap = await emitAck(p2, 'room:character', { character: 'nyx' });
    A.check('se puede cambiar a un personaje libre', swap.ok && swap.character === 'nyx');
    const ghostChar = await emitAck(p2, 'room:character', { character: 'no-existe' });
    A.check('personaje inexistente rechazado', !ghostChar.ok);

    const bad = await emitAck(p3, 'room:join', { code: 'ZZZZ', name: 'X' });
    A.check('código inexistente rechazado con mensaje claro', !bad.ok && /no existe/i.test(bad.error));

    const j3 = await emitAck(p3, 'room:join', { code, name: 'Beto', character: 'luna' });
    const j4 = await emitAck(p4, 'room:join', { code, name: 'Caro' });
    A.check('si el personaje está ocupado se asigna otro libre automáticamente',
      j3.ok && j3.room.players[2].character !== 'luna' && !!j3.room.players[2].character);
    A.check('sin elección se asigna personaje automático', j4.ok && !!j4.room.players[3].character);
    A.check('los 4 personajes de la sala son distintos',
      new Set(j4.room.players.map((p) => p.character)).size === 4);
    const p5 = mk(); await connected(p5);
    const full = await emitAck(p5, 'room:join', { code, name: 'Extra' });
    A.check('sala limitada a 4 jugadores', !full.ok && /llena/i.test(full.error));

    // Sincronía de reloj
    const t0 = Date.now();
    const pong = await new Promise((r) => host.emit('sync:ping', t0, r));
    A.check('sync:ping devuelve hora del servidor', typeof pong.serverTime === 'number' && pong.clientTime === t0);

    // Lanzamiento con validaciones
    const noMap = await emitAck(host, 'game:launch', { beatmap: [], audio: Buffer.alloc(10), duration: 30 });
    A.check('beatmap vacío rechazado', !noMap.ok);
    const noAudio = await emitAck(host, 'game:launch', { beatmap: [{ t: 1, lane: 0 }], duration: 30 });
    A.check('lanzar sin audio rechazado', !noAudio.ok);
    const notHost = await emitAck(p2, 'game:launch', {
      beatmap: [{ t: 1, lane: 0 }], audio: Buffer.alloc(1024), duration: 30
    });
    A.check('solo el anfitrión puede iniciar', !notHost.ok && /anfitri/i.test(notHost.error));

    const beatmap = [];
    for (let t = 1; t < 12; t += 0.4) beatmap.push({ t: +t.toFixed(2), lane: Math.floor(t * 7) % 5 });
    beatmap.push({ t: 5, lane: 99 });          // inválida: debe filtrarse
    beatmap.push({ t: -3, lane: 1 });          // inválida: debe filtrarse
    beatmap.push({ t: 6, lane: 5 });           // carril 6: inválido en Difícil (5 carriles)

    const prepares = [host, p2, p3, p4].map((s) => once(s, 'game:prepare'));
    const starts = [host, p2, p3, p4].map((s) => once(s, 'game:start'));
    const launch = await emitAck(host, 'game:launch', {
      difficulty: 'hard', songName: 'Audit Song', duration: 12, bpm: 128,
      beatmap, audioType: 'audio/mpeg', audio: Buffer.alloc(256 * 1024)
    });
    A.check('lanzamiento aceptado y notas inválidas descartadas',
      launch.ok && launch.notes === beatmap.length - 3, `→ ${launch.notes}/${beatmap.length}`);
    A.check('Difícil se anuncia con 5 carriles', launch.lanes === 5);

    const prep = await Promise.all(prepares);
    A.check('el anfitrión no recibe el audio duplicado', prep[0].hasAudio === false);
    A.check('los invitados reciben el audio completo',
      prep.slice(1).every((p) => p.hasAudio && p.audio && (p.audio.byteLength || p.audio.length) === 256 * 1024));
    A.check('todos reciben el mismo beatmap',
      prep.every((p) => p.beatmap.length === prep[0].beatmap.length) &&
      JSON.stringify(prep[0].beatmap) === JSON.stringify(prep[3].beatmap));
    A.check('dificultad y metadatos propagados',
      prep[3].difficulty === 'hard' && prep[3].songName === 'Audit Song' && prep[3].bpm === 128);
    A.check('todos reciben el número de carriles de la dificultad',
      prep.every((p) => p.lanes === 5) && prep[0].beatmap.every((n) => n.lane >= 0 && n.lane < 5));

    // Nadie arranca hasta que todos cargan
    let startedEarly = false;
    host.once('game:start', () => { startedEarly = true; });
    [host, p2, p3].forEach((s) => s.emit('game:loaded'));
    await sleep(400);
    A.check('no arranca si falta un jugador por cargar', !startedEarly);

    const midJoin = await emitAck(p5, 'room:join', { code, name: 'Tarde' });
    A.check('no se puede entrar con la partida en curso', !midJoin.ok && /comenz/i.test(midJoin.error));

    p4.emit('game:loaded');
    const startData = await Promise.all(starts);
    const sameStart = startData.every((d) => d.startAt === startData[0].startAt);
    A.check('todos reciben el mismo instante de arranque', sameStart, '→ startAt=' + startData[0].startAt);
    A.check('el arranque se programa con margen (3-8 s)',
      startData[0].startAt - Date.now() > 3000 && startData[0].startAt - Date.now() < 8000);

    // Marcador en vivo
    const scoreEvt = once(p2, 'game:scores');
    host.emit('game:progress', {
      score: 1200, combo: 12, maxCombo: 12, hits: 12, misses: 0, health: 84, dead: false, presses: 0b10101
    });
    const scores = await scoreEvt;
    const hostRow = scores.players.find((p) => p.name === 'Host');
    A.check('la puntuación se difunde a los demás en tiempo real',
      hostRow && hostRow.score === 1200 && hostRow.combo === 12);
    A.check('precisión calculada en el servidor', hostRow.accuracy === 100);
    A.check('la vida viaja en el marcador en vivo', hostRow.health === 84 && hostRow.dead === false);
    A.check('las pulsaciones se retransmiten para las pantallas de la banda', hostRow.presses === 0b10101);

    const deadEvt = once(p2, 'game:scores');
    p3.emit('game:progress', { score: 300, combo: 0, maxCombo: 4, hits: 8, misses: 20, health: 0 });
    const deadScores = await deadEvt;
    const betoRow = deadScores.players.find((p) => p.name === 'Beto');
    A.check('vida a cero marca al jugador como eliminado', betoRow.dead === true && betoRow.health === 0);

    // Fin de canción y ranking
    const resultsEvt = [host, p2, p3, p4].map((s) => once(s, 'game:results', 12000));
    host.emit('game:finish', { score: 4800, hits: 40, misses: 5, maxCombo: 22, perfect: 30, great: 8, good: 2, health: 60 });
    p2.emit('game:finish', { score: 9100, hits: 45, misses: 0, maxCombo: 45, perfect: 45, great: 0, good: 0, health: 100 });
    p3.emit('game:finish', { score: 12000, hits: 20, misses: 25, maxCombo: 7, perfect: 10, great: 6, good: 4, health: 0, dead: true });
    p4.emit('game:finish', { score: 4800, hits: 38, misses: 7, maxCombo: 30, perfect: 28, great: 7, good: 3, health: 45 });
    const res = await Promise.all(resultsEvt);

    A.check('todos reciben la pantalla de resultados', res.length === 4 && res.every((r) => r.ranking.length === 4));
    const rk = res[0].ranking;
    A.check('ranking 1º a 4º por puntuación', rk[0].name === 'Ana' && rk[0].position === 1);
    A.check('el eliminado queda último aunque tenga más puntos',
      rk[3].name === 'Beto' && rk[3].dead === true && rk[3].score > rk[0].score);
    A.check('empate resuelto por combo máximo', rk[1].name === 'Caro' && rk[2].name === 'Host');
    A.check('estadísticas completas por jugador',
      rk.every((p) => ['score', 'hits', 'misses', 'maxCombo', 'accuracy', 'perfect', 'great', 'good', 'health']
        .every((k) => typeof p[k] === 'number')));
    A.check('el personaje de cada jugador llega a los resultados', rk.every((p) => !!p.character));
    A.check('precisión coherente con acertadas/falladas', rk[0].accuracy === 100 && rk[3].accuracy === 44.4);

    // Volver al lobby
    const lobbyEvt = [host, p2, p3, p4].map((s) => once(s, 'room:lobby'));
    host.emit('room:backToLobby');
    const lob = await Promise.all(lobbyEvt);
    A.check('el botón devuelve a todos al lobby', lob.every((r) => r.state === 'lobby'));
    A.check('las estadísticas se reinician',
      lob[0].players.every((p) => p.score === 0 && p.maxCombo === 0 && !p.finished && !p.dead && p.health === 100));
    A.check('los personajes se conservan al volver al lobby', lob[0].players.every((p) => !!p.character));

    // Hueco libre -> se puede volver a entrar tras el lobby
    p4.emit('room:leave');
    await sleep(200);
    const rejoin = await emitAck(p5, 'room:join', { code, name: 'Tarde' });
    A.check('se puede entrar de nuevo tras volver al lobby', rejoin.ok);

    // Migración de anfitrión (escuchamos ANTES de provocar la salida)
    const stateAfterHost = new Promise((resolve) => {
      const onState = (s) => {
        if (s.hostId !== created.youId) { p2.off('room:state', onState); resolve(s); }
      };
      p2.on('room:state', onState);
      setTimeout(() => { p2.off('room:state', onState); resolve(null); }, 5000);
    });
    host.disconnect();
    const st = await stateAfterHost;
    A.check('al salir el anfitrión se asigna otro',
      !!st && !!st.hostId && st.players.length === 3, st ? '→ ' + st.players.length + ' jugadores' : '→ sin estado');

    // Abortar por caída del anfitrión durante la partida
    const h2 = st ? st.hostId : null;
    const newHostSock = [p2, p3, p5].find((s) => s.id === h2);
    if (newHostSock) {
      const others = [p2, p3, p5].filter((s) => s !== newHostSock);
      const preps = others.map((s) => once(s, 'game:prepare'));
      await emitAck(newHostSock, 'game:launch', {
        difficulty: 'normal', songName: 'Abort test', duration: 20, bpm: 100,
        beatmap: [{ t: 1, lane: 0 }, { t: 2, lane: 1 }], audio: Buffer.alloc(4096)
      });
      await Promise.all(preps);
      const abortEvt = once(others[0], 'game:abort', 6000);
      newHostSock.disconnect();
      const ab = await abortEvt.catch(() => null);
      A.check('si el anfitrión se cae en partida, se cancela con aviso', !!ab && /anfitri/i.test(ab.message));
    } else {
      A.check('si el anfitrión se cae en partida, se cancela con aviso', false, '(no se pudo identificar al nuevo anfitrión)');
    }

    // Sala efímera
    const solo = mk(); await connected(solo);
    const r2 = await emitAck(solo, 'room:create', { name: 'Solo' });
    solo.disconnect();
    await sleep(300);
    const ghost = mk(); await connected(ghost);
    const gone = await emitAck(ghost, 'room:join', { code: r2.code, name: 'Otro' });
    A.check('las salas vacías se destruyen', !gone.ok);
  } finally {
    socks.forEach((s) => { try { s.disconnect(); } catch (e) {} });
    await sleep(200);
    srv.child.kill();
  }
}

/* ====================== AGENTE 5 — ROBUSTEZ / SEGURIDAD ================ */

async function agentRobustness() {
  log('\n▸ AGENTE 5 · Robustez y seguridad');
  const A = agent('Robustez y seguridad');
  if (!ioClient) { A.check('socket.io-client instalado', false); return; }

  const PORT = 3331;
  const srv = await startServer(ROOT, PORT);
  const socks = [];
  const mk = () => { const s = client(PORT); socks.push(s); return s; };

  try {
    const a = mk(); await connected(a);
    const xss = await emitAck(a, 'room:create', { name: '<img src=x onerror=alert(1)>' });
    A.check('nombres saneados (sin HTML inyectable)',
      xss.ok && !/[<>]/.test(xss.room.players[0].name), '→ "' + xss.room.players[0].name + '"');

    const b = mk(); await connected(b);
    const emptyName = await emitAck(b, 'room:join', { code: xss.code, name: '   ' });
    A.check('nombre vacío recibe alias por defecto', emptyName.ok && emptyName.room.players[1].name.length > 0);

    const c = mk(); await connected(c);
    const longName = await emitAck(c, 'room:join', { code: xss.code, name: 'x'.repeat(200) });
    A.check('nombre largo recortado a 14 caracteres', longName.ok &&
      longName.room.players[2].name.length <= 14);

    // Eventos basura no tumban el servidor
    ['game:loaded', 'game:finish', 'room:backToLobby', 'game:progress', 'game:error'].forEach((ev) => a.emit(ev, null));
    a.emit('game:progress', { score: 'NaN', combo: -50, hits: 'x', misses: null });
    a.emit('room:difficulty', { difficulty: 'imposible' });
    await sleep(300);
    const alive = JSON.parse((await getHttp('http://localhost:' + PORT + '/health')).body);
    A.check('eventos malformados no tumban el servidor', alive.ok === true);

    const st = await new Promise((r) => { a.once('room:state', r); a.emit('room:difficulty', { difficulty: 'expert' }); });
    A.check('dificultad inválida ignorada, válida aceptada', st.difficulty === 'expert');

    const notHostDiff = await new Promise((r) => {
      b.emit('room:difficulty', { difficulty: 'easy' });
      setTimeout(() => { a.once('room:state', r); a.emit('room:difficulty', { difficulty: 'expert' }); }, 150);
    });
    A.check('un invitado no puede cambiar la dificultad', notHostDiff.difficulty === 'expert');

    const huge = await emitAck(a, 'game:launch', {
      difficulty: 'normal', songName: 'Big', duration: 60,
      beatmap: [{ t: 1, lane: 0 }], audio: Buffer.alloc(51 * 1024 * 1024)
    }, 20000).catch(() => ({ ok: false, error: 'rechazado por tamaño' }));
    A.check('audio > 50 MB rechazado', !huge.ok);

    const badDur = await emitAck(a, 'game:launch', {
      difficulty: 'normal', songName: 'x', duration: 0,
      beatmap: [{ t: 1, lane: 0 }], audio: Buffer.alloc(1024)
    });
    A.check('duración inválida rechazada', !badDur.ok);

    const stillOk = JSON.parse((await getHttp('http://localhost:' + PORT + '/health')).body);
    A.check('servidor sigue sano tras los abusos', stillOk.ok === true);
  } finally {
    socks.forEach((s) => { try { s.disconnect(); } catch (e) {} });
    await sleep(200);
    srv.child.kill();
  }
}

/* ==================== AGENTE 6 — PERSONAJES Y ESCENARIO ================ */

function buildFakeCanvasContext() {
  const gradient = { addColorStop() {} };
  const target = {
    canvas: null,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: [] })
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return typeof prop === 'string' ? function () {} : undefined;
    },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
}

async function agentCharacters() {
  log('\n▸ AGENTE 6 · Personajes y escenario');
  const A = agent('Personajes');
  const RC = require(path.join(ROOT, 'public', 'characters.js'));

  A.check('el roster tiene al menos 15 personajes', RC.ROSTER.length >= 15, `→ ${RC.ROSTER.length}`);
  A.check('todos los identificadores son únicos', new Set(RC.ROSTER.map((c) => c.id)).size === RC.ROSTER.length);
  A.check('todos los nombres son únicos', new Set(RC.ROSTER.map((c) => c.name)).size === RC.ROSTER.length);

  const fields = ['id', 'name', 'role', 'instrument', 'skin', 'hair', 'hairStyle', 'outfit', 'accent', 'accessory', 'bio'];
  A.check('cada personaje trae todos sus datos',
    RC.ROSTER.every((c) => fields.every((f) => typeof c[f] === 'string' && c[f].length)));
  A.check('los colores son hexadecimales válidos',
    RC.ROSTER.every((c) => ['skin', 'hair', 'outfit', 'accent'].every((k) => /^#[0-9a-f]{6}$/i.test(c[k]))));

  const instruments = new Set(RC.ROSTER.map((c) => c.instrument));
  A.check('hay variedad de instrumentos (≥4 tipos)', instruments.size >= 4, `→ ${[...instruments].join(', ')}`);
  A.check('hay variedad de peinados (≥5 tipos)', new Set(RC.ROSTER.map((c) => c.hairStyle)).size >= 5);

  A.check('get() devuelve el personaje pedido', RC.get('luna').id === 'luna');
  A.check('get() con id desconocido no rompe', !!RC.get('xxx').name);
  const taken = RC.ROSTER.slice(0, 14).map((c) => c.id);
  A.check('randomFree evita los personajes ocupados', RC.randomFree(taken) === RC.ROSTER[14].id);

  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  A.check('el servidor conoce exactamente los mismos personajes',
    RC.ROSTER.every((c) => serverSrc.includes(`'${c.id}'`)));

  // Dibujo sin errores (contexto simulado y, si está disponible, canvas real)
  let drawOk = true, drawErr = '';
  try {
    const ctx = buildFakeCanvasContext();
    RC.ROSTER.forEach((c) => {
      ['idle', 'play', 'miss', 'cheer'].forEach((state) => {
        RC.drawCharacter(ctx, c, 100, 300, 200, { t: 1.2, energy: 0.7, state });
      });
      RC.drawPortrait(ctx, c, 140, 160, 0.5, { full: true });
    });
    RC.drawStage(ctx, 800, 500, { t: 2, energy: 0.8 });
  } catch (err) { drawOk = false; drawErr = err.message; }
  A.check('dibujar los 15 personajes y el escenario no lanza errores', drawOk, drawErr);

  let real = null;
  try { real = require('canvas'); } catch (e) { /* opcional */ }
  if (real) {
    const cv = real.createCanvas(220, 260);
    const ctx = cv.getContext('2d');
    let painted = 0;
    RC.ROSTER.forEach((c) => {
      ctx.clearRect(0, 0, 220, 260);
      RC.drawPortrait(ctx, c, 220, 260, 1, { full: true, energy: 0.6 });
      const data = ctx.getImageData(40, 60, 140, 150).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 10 && (data[i] + data[i + 1] + data[i + 2]) > 90) colored++;
      if (colored > 500) painted++;
    });
    A.check('cada retrato pinta un personaje visible', painted === RC.ROSTER.length, `→ ${painted}/${RC.ROSTER.length}`);

    const stage = real.createCanvas(640, 400);
    const sctx = stage.getContext('2d');
    RC.drawStage(sctx, 640, 400, { t: 1.5, energy: 0.9 });
    const px = sctx.getImageData(0, 0, 640, 400).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4 * 97) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
    A.check('el escenario se dibuja con luces y público', lit > 100, `→ ${lit} muestras iluminadas`);
  } else {
    A.check('render real omitido (paquete canvas no instalado)', true, '(opcional)');
  }

  A.check('la imagen de fondo del menú está empaquetada',
    fs.existsSync(path.join(ROOT, 'public/assets/stage-bg.jpg')) &&
    fs.statSync(path.join(ROOT, 'public/assets/stage-bg.jpg')).size > 10000);
}

/* ================= AGENTE 7 — CLIENTE EN DOM SIMULADO ================== */

function makeFakeSocket() {
  const handlers = {};
  const sent = [];
  const socket = {
    id: 'fake-socket-id',
    connected: true,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return socket; },
    once(ev, fn) { return socket.on(ev, fn); },
    off(ev, fn) { if (handlers[ev]) handlers[ev] = handlers[ev].filter((h) => h !== fn); return socket; },
    emit(ev, payload, ack) {
      sent.push({ ev, payload, ack });
      if (ev === 'sync:ping' && typeof ack === 'function') ack({ clientTime: payload, serverTime: Date.now() });
      return socket;
    },
    disconnect() { socket.connected = false; }
  };
  socket.__fire = (ev, data) => (handlers[ev] || []).slice().forEach((h) => h(data));
  socket.__sent = sent;
  socket.__last = (ev) => [...sent].reverse().find((m) => m.ev === ev);
  socket.__clear = () => { sent.length = 0; };
  return socket;
}

function synthPcm(sr, seconds, bpm) {
  const pcm = new Float32Array(Math.floor(sr * seconds));
  const step = 60 / (bpm || 120) / 2;
  for (let t = 0.5; t < seconds - 0.3; t += step) {
    const n = Math.floor(t * sr);
    const f = (Math.round(t / step) % 2) ? 4200 : 70;
    for (let i = 0; i < sr * 0.08 && n + i < pcm.length; i++) {
      const env = Math.exp(-i / (sr * 0.02));
      pcm[n + i] += 0.9 * env * Math.sin((2 * Math.PI * f * i) / sr);
    }
  }
  return pcm;
}

async function agentClient() {
  log('\n▸ AGENTE 7 · Cliente completo en DOM simulado (jsdom)');
  const A = agent('Cliente / UI');

  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { A.check('jsdom instalado', false, '→ npm i -D jsdom'); return; }

  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:3000/' });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  const SR = 22050;
  let fakeTime = 0;
  const param = () => ({
    value: 1,
    cancelScheduledValues() {}, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}
  });
  const audioCtx = {
    get currentTime() { return fakeTime; },
    get state() { return 'running'; },
    sampleRate: SR,
    destination: {},
    resume() {},
    createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
    createBiquadFilter: () => ({ type: 'lowpass', frequency: param(), Q: param(), connect() {}, disconnect() {} }),
    createBufferSource: () => ({ buffer: null, connect() {}, start() {}, stop() {} }),
    decodeAudioData(buffer, ok) {
      const pcm = synthPcm(SR, 9, 120);
      const fake = {
        duration: 9, sampleRate: SR, length: pcm.length, numberOfChannels: 1,
        getChannelData: () => pcm
      };
      if (typeof ok === 'function') { ok(fake); return; }
      return Promise.resolve(fake);
    }
  };
  window.AudioContext = function () { return audioCtx; };
  window.HTMLCanvasElement.prototype.getContext = function () { return buildFakeCanvasContext(); };
  const socket = makeFakeSocket();
  window.io = () => socket;

  try {
    window.eval(fs.readFileSync(path.join(ROOT, 'public/engine.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(ROOT, 'public/characters.js'), 'utf8'));
    A.check('engine.js y characters.js se cargan en el navegador',
      typeof window.RA === 'object' && typeof window.RC === 'object');
    window.eval(fs.readFileSync(path.join(ROOT, 'public/game.js'), 'utf8'));
    A.check('game.js arranca sin excepciones', errors.length === 0, errors[0] || '');
  } catch (err) {
    A.check('game.js arranca sin excepciones', false, err.message);
    return;
  }

  const $ = (id) => window.document.getElementById(id);
  const active = (id) => $(id).classList.contains('active');
  const click = (el) => (typeof el === 'string' ? $(el) : el)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const key = (code, type) => window.document.dispatchEvent(
    new window.KeyboardEvent(type || 'keydown', { code, bubbles: true, cancelable: true }));
  const frames = (n) => new Promise((r) => {
    let i = 0;
    const step = () => (++i >= n ? r() : window.requestAnimationFrame(step));
    window.requestAnimationFrame(step);
  });
  const waitFor = async (fn, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
    return false;
  };
  const num = (id) => Number(String($(id).textContent).replace(/[^\d]/g, ''));

  /* ---- menú principal ---- */
  A.check('el menú principal es la primera pantalla', active('screen-menu'));
  A.check('el menú ofrece solo, multijugador, personajes y opciones',
    !!$('btn-menu-solo') && !!$('btn-menu-multi') && !!$('btn-menu-chars') && !!$('btn-menu-options'));
  socket.__fire('connect');
  A.check('el indicador de conexión se enciende', $('conn-dot').classList.contains('on'));

  /* ---- selección de personaje ---- */
  click('btn-menu-chars');
  A.check('la pantalla de personajes se abre', active('screen-characters'));
  const cards = $('char-grid').children;
  A.check('se muestran los 15 personajes en el menú', cards.length === window.RC.ROSTER.length, `→ ${cards.length}`);
  A.check('cada tarjeta dibuja un retrato', cards[0].querySelector('canvas') !== null);
  const target = window.RC.ROSTER[7];
  click([...cards].find((c) => c.dataset.id === target.id));
  A.check('al pulsar una tarjeta se ve su ficha',
    $('char-name').textContent === target.name && $('char-role').textContent === target.role);
  click('btn-char-pick');
  A.check('elegir personaje vuelve al menú', active('screen-menu'));
  A.check('el menú muestra el personaje elegido', $('menu-char-name').textContent === target.name);
  A.check('la elección se guarda en el navegador', window.localStorage.getItem('ra_char') === target.id);

  /* ---- opciones y controles ---- */
  click('btn-menu-options');
  A.check('la pantalla de opciones se abre', active('screen-options'));
  A.check('hay un control por cada uno de los 6 carriles', $('key-list').children.length === 6);
  const laneBtn = (i) => $('key-list').children[i].querySelector('.key-btn');
  A.check('los carriles 1-4 traen A S D F por defecto',
    ['A', 'S', 'D', 'F'].every((k, i) => laneBtn(i).textContent === k));
  A.check('el carril 5 y 6 traen G y H', laneBtn(4).textContent === 'G' && laneBtn(5).textContent === 'H');
  click(laneBtn(4));
  A.check('al pulsar un carril queda a la escucha', laneBtn(4).classList.contains('listening'));
  key('KeyZ');
  A.check('la tecla nueva queda asignada', laneBtn(4).textContent === 'Z');
  A.check('la asignación se guarda', JSON.parse(window.localStorage.getItem('ra_keys'))[4] === 'KeyZ');
  click('btn-keys-reset');
  A.check('se pueden restaurar los controles', laneBtn(4).textContent === 'G');
  A.check('los interruptores de vida y audio progresivo existen',
    $('opt-progressive').checked === true && $('opt-health').checked === true);
  click($('screen-options').querySelector('[data-back]'));
  A.check('se vuelve al menú desde opciones', active('screen-menu'));

  /* ---- modo solo: análisis, partida y game over ---- */
  click('btn-menu-solo');
  A.check('la pantalla de partida individual se abre', active('screen-solo'));
  const file = {
    name: 'Prueba.mp3', size: 400000, type: 'audio/mpeg',
    arrayBuffer: () => Promise.resolve(new window.ArrayBuffer(400000))
  };
  Object.defineProperty($('solo-audio'), 'files', { value: [file], configurable: true });
  $('solo-audio').dispatchEvent(new window.Event('change', { bubbles: true }));
  const analyzed = await waitFor(() => !$('btn-solo-start').disabled, 15000);
  A.check('el audio se analiza y genera beatmap jugable', analyzed, $('solo-text').textContent);
  A.check('el resumen muestra notas y carriles', /notas/.test($('solo-text').textContent));

  fakeTime = 50;
  click('btn-solo-start');
  A.check('la partida individual arranca en la pista', active('screen-game'));
  A.check('la vida empieza al 100 %', $('health-fill').style.width === '100%');
  fakeTime = 53.2;
  const started = await waitFor(() => $('overlay').classList.contains('hide'), 4000);
  A.check('la cuenta atrás termina y empieza la canción', started);

  // dejar pasar las notas sin pulsar: la vida baja hasta perder
  for (let i = 0; i < 40 && $('gameover').classList.contains('hidden'); i++) {
    fakeTime += 0.35;
    await frames(2);
  }
  A.check('fallar notas baja la vida', Number(($('health-fill').style.width || '100%').replace('%', '')) < 100);
  const over = await waitFor(() => !$('gameover').classList.contains('hidden'), 3000);
  A.check('al quedarse sin vida aparece la pantalla de juego terminado', over);
  A.check('la pantalla muestra el cartel JUEGO TERMINADO',
    /JUEGO TERMINADO/i.test($('gameover').textContent));
  A.check('las puertas se cierran sobre la pista',
    !!$('gameover').querySelector('.door-left') && !!$('gameover').querySelector('.door-right'));
  A.check('en solo se ofrece reintentar', !$('btn-retry').classList.contains('hidden'));
  click('btn-gameover-menu');
  A.check('desde el game over se vuelve al menú', active('screen-menu'));

  /* ---- multijugador: sala, carriles, minis, vida, resultados ---- */
  click('btn-menu-multi');
  $('input-name').value = 'Auditor';
  click('btn-create');
  const createMsg = socket.__last('room:create');
  A.check('crear sala envía nombre y personaje',
    !!createMsg && createMsg.payload.name === 'Auditor' && createMsg.payload.character === target.id);
  const roomPlayers = [
    { id: socket.id, name: 'Auditor', character: target.id, isHost: true, score: 0, combo: 0, accuracy: 100, health: 100 },
    { id: 'p2', name: 'Ana', character: 'kira', isHost: false, score: 0, combo: 0, accuracy: 100, health: 100 }
  ];
  createMsg.ack({
    ok: true, code: 'AB12', youId: socket.id,
    room: { code: 'AB12', hostId: socket.id, state: 'lobby', difficulty: 'normal', songName: '', maxPlayers: 4, players: [roomPlayers[0]] }
  });
  A.check('tras crear la sala se muestra el lobby', active('screen-lobby'));
  A.check('el código de sala se pinta', $('room-code').textContent === 'AB12');

  socket.__fire('room:state', {
    code: 'AB12', hostId: socket.id, state: 'lobby', difficulty: 'hard', songName: '', maxPlayers: 4, players: roomPlayers
  });
  A.check('la banda lista a los dos jugadores', $('player-list').children.length === 2);
  A.check('cada jugador aparece con su personaje', /Kira/.test($('player-list').textContent));

  // beatmap de 5 carriles (Difícil)
  const beatmap = [];
  for (let t = 2; t < 8; t += 0.5) beatmap.push({ t: +t.toFixed(2), lane: Math.round((t * 2) % 5) });
  socket.__fire('game:prepare', {
    hasAudio: true, audio: new window.ArrayBuffer(2048), difficulty: 'hard', lanes: 5,
    songName: 'Tema auditado', duration: 9, bpm: 120, beatmap
  });
  await frames(3);
  A.check('la partida en red muestra la pista', active('screen-game'));
  A.check('el encabezado indica 5 carriles en Difícil', /5 carriles/.test($('game-diff').textContent));
  A.check('se crea una minipantalla por cada compañero', $('minis').children.length === 1);
  const loaded = await waitFor(() => !!socket.__last('game:loaded'));
  A.check('el cliente avisa «cargado» tras decodificar y sincronizar', loaded);

  fakeTime = 100;
  socket.__fire('game:start', { startAt: Date.now() + 150, serverTime: Date.now() });
  fakeTime = 100.4;
  await waitFor(() => $('overlay').classList.contains('hide'), 3000);
  const startCtx = 100.15;

  const noteFor = (lane) => beatmap.find((n) => n.lane === lane);
  const laneKeys = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];
  fakeTime = startCtx + noteFor(4).t;
  key(laneKeys[4]);
  await frames(2);
  const score5 = num('hud-score');
  A.check('el quinto carril (tecla G) golpea notas en Difícil', score5 > 0, `→ ${score5} puntos`);
  A.check('el combo sube al acertar', $('hud-combo').textContent === 'x1');

  const before = Number($('health-fill').style.width.replace('%', ''));
  fakeTime = startCtx + 8.4;
  await frames(4);
  A.check('perder notas en red también baja la vida',
    Number($('health-fill').style.width.replace('%', '')) < before);

  socket.__fire('game:scores', {
    players: [
      { id: socket.id, name: 'Auditor', score: score5, combo: 1, accuracy: 60, health: 70, dead: false, presses: 1 },
      { id: 'p2', name: 'Ana', score: 4200, combo: 15, accuracy: 98, health: 100, dead: false, presses: 0b101 }
    ]
  });
  A.check('el marcador en vivo muestra a toda la sala', $('live-scores').children.length === 2);
  A.check('el marcador ordena por puntuación', /Ana/.test($('live-scores').children[0].textContent));

  socket.__fire('game:scores', {
    players: [
      { id: socket.id, name: 'Auditor', score: score5, combo: 0, accuracy: 40, health: 20, dead: false, presses: 0 },
      { id: 'p2', name: 'Ana', score: 4200, combo: 0, accuracy: 55, health: 0, dead: true, presses: 0 }
    ]
  });
  A.check('un compañero eliminado se marca en su minipantalla',
    $('minis').children[0].classList.contains('dead'));
  A.check('el marcador marca al eliminado', /Eliminado/.test($('live-scores').textContent));

  key('Escape');
  await frames(2);
  const finishMsg = socket.__last('game:finish');
  A.check('Esc envía las estadísticas finales con vida incluida',
    !!finishMsg && typeof finishMsg.payload.health === 'number' && finishMsg.payload.hits >= 1);

  socket.__fire('game:results', {
    songName: 'Tema auditado', difficulty: 'hard', bpm: 120, noteCount: beatmap.length,
    ranking: [
      { id: socket.id, name: 'Auditor', character: target.id, score: 900, hits: 6, misses: 5, maxCombo: 3, accuracy: 54.5, perfect: 4, great: 1, good: 1, health: 20, dead: false, position: 1 },
      { id: 'p2', name: 'Ana', character: 'kira', score: 4200, hits: 10, misses: 9, maxCombo: 8, accuracy: 52.6, perfect: 6, great: 3, good: 1, health: 0, dead: true, position: 2 }
    ]
  });
  A.check('la pantalla de resultados aparece', active('screen-results'));
  A.check('la tabla lista a todos los jugadores', $('rank-body').children.length === 2);
  A.check('los eliminados se marcan en la tabla', /Eliminado/.test($('rank-body').textContent));
  A.check('el podio dibuja a los personajes', $('podium').querySelector('canvas') !== null);
  A.check('los resultados indican la dificultad y los carriles', /5 carriles/.test($('results-diff').textContent));

  click('btn-lobby');
  A.check('«Volver al lobby» avisa al servidor', !!socket.__last('room:backToLobby'));
  socket.__fire('room:lobby', {
    code: 'AB12', hostId: socket.id, state: 'lobby', difficulty: 'hard', songName: 'Tema auditado', maxPlayers: 4, players: roomPlayers
  });
  A.check('el cliente vuelve al lobby listo para otra canción', active('screen-lobby'));

  socket.__fire('game:abort', { message: 'Prueba de cancelación' });
  A.check('un aborto no rompe la interfaz', errors.length === 0, errors[0] || '');
  socket.__fire('disconnect');
  A.check('la desconexión se refleja en la UI', !$('conn-dot').classList.contains('on'));
  A.check('sin errores de JavaScript en toda la sesión', errors.length === 0, errors.join(' | '));

  dom.window.close();
}


/* ============================== EJECUCIÓN ============================== */

(async function main() {
  log('══════════════════════════════════════════════════════');
  log('  AUDITORÍA RHYTHM ARENA');
  log('══════════════════════════════════════════════════════');

  let engineReport = [];
  try {
    await agentStructure();
    engineReport = await agentEngine();
    await agentRules();
    await agentMultiplayer();
    await agentRobustness();
    await agentCharacters();
    await agentClient();
  } catch (err) {
    log('\n✘ Error durante la auditoría:', err.message);
    results.push({ name: 'Ejecución', checks: [], pass: 0, fail: 1 });
  }

  const totalPass = results.reduce((a, r) => a + r.pass, 0);
  const totalFail = results.reduce((a, r) => a + r.fail, 0);
  const pct = totalPass / Math.max(1, totalPass + totalFail);

  log('\n══════════════════════════════════════════════════════');
  log('  RESUMEN');
  log('══════════════════════════════════════════════════════');
  results.forEach((r) => {
    const p = r.pass / Math.max(1, r.pass + r.fail);
    log(`  ${r.name.padEnd(26)} ${String(r.pass).padStart(3)}/${String(r.pass + r.fail).padEnd(3)}  ${(p * 100).toFixed(1)}%`);
    r.checks.filter((c) => !c.ok).forEach((c) => log(`      ✘ ${c.label} ${c.detail || ''}`));
  });

  if (engineReport.length) {
    log('\n  Motor de análisis por dificultad:');
    engineReport.forEach((r) => log(
      `   ${r.diff.padEnd(7)} notas=${String(r.notes).padStart(4)}  ${r.nps.toFixed(2)} n/s` +
      `  recall=${(r.recall * 100).toFixed(1)}%  precisión=${(r.precision * 100).toFixed(1)}%` +
      `  carril=${(r.laneAcc * 100).toFixed(1)}%  desfase=${r.meanErr.toFixed(1)}ms  ${r.ms}ms`));
  }

  const grade = pct >= 0.98 ? 'AAA' : pct >= 0.93 ? 'AA' : pct >= 0.85 ? 'A' : pct >= 0.7 ? 'B' : 'C';
  log(`\n  TOTAL: ${totalPass}/${totalPass + totalFail}  (${(pct * 100).toFixed(1)}%)  →  CALIFICACIÓN ${grade}`);
  log('══════════════════════════════════════════════════════\n');

  process.exit(totalFail === 0 ? 0 : 1);
})();
