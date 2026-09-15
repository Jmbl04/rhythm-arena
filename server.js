'use strict';

/* =========================================================================
   RHYTHM ARENA — server.js
   Express + Socket.io: salas con código, transferencia del beatmap/audio,
   sincronización de arranque, marcador en vivo y ranking final.
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = 4;
const START_DELAY_MS = 5000;
const FINISH_TIMEOUT_MS = 25000;
const LOAD_TIMEOUT_MS = 90000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_NOTES = 20000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DIFFS = ['easy', 'normal', 'hard', 'expert'];
const LANES_BY_DIFF = { easy: 4, normal: 4, hard: 5, expert: 6 };
const CHARACTER_IDS = [
  'luna', 'rico', 'zara', 'bruno', 'kira', 'dante', 'mila', 'axel',
  'nyx', 'paco', 'iris', 'vera', 'tono', 'sasha', 'kenji'
];

/* ---------------------------------------------------------------------- */
/* Resolución de la carpeta estática: funciona con public/ o todo plano    */
/* ---------------------------------------------------------------------- */

function resolvePublicDir() {
  const candidates = [
    process.env.PUBLIC_DIR && path.resolve(process.env.PUBLIC_DIR),
    path.join(__dirname, 'public'),
    __dirname,
    path.join(__dirname, 'dist'),
    path.join(process.cwd(), 'public'),
    process.cwd()
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch (e) { /* noop */ }
  }
  return null;
}

const PUBLIC_DIR = resolvePublicDir();
const INDEX_FILE = PUBLIC_DIR ? path.join(PUBLIC_DIR, 'index.html') : null;

const MISSING_PAGE = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Rhythm Arena — archivos no encontrados</title>
<style>body{background:#0b0813;color:#eef1ff;font-family:system-ui,sans-serif;padding:40px;line-height:1.6}
code{background:#1b1630;padding:2px 6px;border-radius:6px}pre{background:#130f22;padding:16px;border-radius:12px;overflow:auto}
h1{color:#ff2d95}</style></head><body>
<h1>Faltan los archivos del cliente</h1>
<p>El servidor arrancó, pero no encuentra <code>index.html</code>. Coloca los archivos así:</p>
<pre>rhythm-arena/
├── package.json
├── server.js
└── public/
    ├── index.html
    ├── style.css
    ├── engine.js
    └── game.js</pre>
<p>También funciona con todos los archivos en la misma carpeta que <code>server.js</code>.</p>
<p>Carpeta del servidor: <code>__DIR__</code></p>
</body></html>`;

const app = express();
app.disable('x-powered-by');

if (PUBLIC_DIR) {
  app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0, index: 'index.html' }));
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    publicDir: PUBLIC_DIR,
    rooms: rooms.size,
    players: [...rooms.values()].reduce((a, r) => a + r.players.size, 0),
    uptime: Math.round(process.uptime())
  });
});

app.get('*', (req, res) => {
  if (INDEX_FILE && fs.existsSync(INDEX_FILE)) return res.sendFile(INDEX_FILE);
  res.status(500).type('html').send(MISSING_PAGE.replace('__DIR__', __dirname));
});

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: MAX_AUDIO_BYTES + 2 * 1024 * 1024,
  pingInterval: 10000,
  pingTimeout: 25000,
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

/* ---------------------------------------------------------------------- */
/* Modelo de datos                                                        */
/* ---------------------------------------------------------------------- */

/** @type {Map<string, any>} */
const rooms = new Map();

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const intOr = (v, d) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : d);

function makeCode() {
  let code;
  let guard = 0;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    guard++;
  } while (rooms.has(code) && guard < 200);
  return code;
}

function sanitizeName(name, fallback) {
  const clean = String(name == null ? '' : name).replace(/[^\p{L}\p{N}_\- .]/gu, '').trim().slice(0, 14);
  return clean.length ? clean : fallback;
}

function createPlayer(id, name, character) {
  const p = { id, name, character };
  resetPlayerStats(p);
  return p;
}

function pickCharacter(room, requested) {
  const taken = new Set([...room.players.values()].map((p) => p.character));
  const wanted = String(requested || '');
  if (CHARACTER_IDS.includes(wanted) && !taken.has(wanted)) return wanted;
  const free = CHARACTER_IDS.filter((id) => !taken.has(id));
  const pool = free.length ? free : CHARACTER_IDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function resetPlayerStats(p) {
  p.score = 0;
  p.combo = 0;
  p.maxCombo = 0;
  p.hits = 0;
  p.misses = 0;
  p.perfect = 0;
  p.great = 0;
  p.good = 0;
  p.accuracy = 100;
  p.health = 100;
  p.dead = false;
  p.presses = 0;
  p.loaded = false;
  p.finished = false;
  return p;
}

function createRoom(code, hostId) {
  return {
    code,
    hostId,
    state: 'lobby', // lobby | loading | countdown | playing | results
    players: new Map(),
    difficulty: 'normal',
    songName: '',
    duration: 0,
    bpm: 0,
    lanes: 4,
    noteCount: 0,
    beatmap: null,
    audio: null,
    audioType: 'audio/mpeg',
    startAt: 0,
    finishTimer: null,
    loadTimer: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    difficulty: room.difficulty,
    lanes: room.lanes,
    songName: room.songName,
    duration: room.duration,
    bpm: room.bpm,
    noteCount: room.noteCount,
    maxPlayers: MAX_PLAYERS,
    startAt: room.startAt,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      score: p.score,
      combo: p.combo,
      maxCombo: p.maxCombo,
      hits: p.hits,
      misses: p.misses,
      accuracy: p.accuracy,
      health: p.health,
      dead: p.dead,
      loaded: p.loaded,
      finished: p.finished,
      isHost: p.id === room.hostId
    }))
  };
}

function broadcastRoom(room) {
  room.lastActivity = Date.now();
  io.to(room.code).emit('room:state', publicRoom(room));
}

function clearTimers(room) {
  if (room.finishTimer) { clearTimeout(room.finishTimer); room.finishTimer = null; }
  if (room.loadTimer) { clearTimeout(room.loadTimer); room.loadTimer = null; }
}

function buildRanking(room) {
  const list = [...room.players.values()].map((p) => {
    const total = p.hits + p.misses;
    return {
      id: p.id,
      name: p.name,
      character: p.character,
      score: p.score,
      hits: p.hits,
      misses: p.misses,
      maxCombo: p.maxCombo,
      health: p.health,
      dead: p.dead,
      perfect: p.perfect,
      great: p.great,
      good: p.good,
      accuracy: total > 0 ? Math.round((p.hits / total) * 1000) / 10 : 0,
      isHost: p.id === room.hostId
    };
  });
  // Los eliminados (sin vida) quedan por debajo de quienes terminaron la canción.
  list.sort((a, b) =>
    ((a.dead ? 1 : 0) - (b.dead ? 1 : 0)) ||
    (b.score - a.score) || (b.maxCombo - a.maxCombo) || (a.misses - b.misses));
  list.forEach((p, i) => { p.position = i + 1; });
  return list;
}

function endGame(room) {
  if (room.state === 'results' || room.state === 'lobby') return;
  clearTimers(room);
  room.state = 'results';
  io.to(room.code).emit('game:results', {
    songName: room.songName,
    difficulty: room.difficulty,
    bpm: room.bpm,
    noteCount: room.noteCount,
    ranking: buildRanking(room)
  });
  broadcastRoom(room);
}

function maybeStart(room) {
  if (room.state !== 'loading') return;
  const players = [...room.players.values()];
  if (!players.length || !players.every((p) => p.loaded)) return;
  clearTimers(room);
  room.state = 'countdown';
  room.startAt = Date.now() + START_DELAY_MS;
  io.to(room.code).emit('game:start', { startAt: room.startAt, serverTime: Date.now() });
  broadcastRoom(room);
  setTimeout(() => {
    if (room.state === 'countdown') {
      room.state = 'playing';
      broadcastRoom(room);
    }
  }, START_DELAY_MS + 250);
}

function returnToLobby(room, message) {
  clearTimers(room);
  room.state = 'lobby';
  room.startAt = 0;
  room.players.forEach(resetPlayerStats);
  if (message) io.to(room.code).emit('room:notice', { type: 'info', message });
  io.to(room.code).emit('room:lobby', publicRoom(room));
  broadcastRoom(room);
}

function abortGame(room, message) {
  clearTimers(room);
  room.beatmap = null;
  room.audio = null;
  room.noteCount = 0;
  io.to(room.code).emit('game:abort', { message: message || 'La partida se canceló.' });
  returnToLobby(room);
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  socket.leave(code);
  if (!room) return;

  const gone = room.players.get(socket.id);
  room.players.delete(socket.id);

  if (room.players.size === 0) {
    clearTimers(room);
    rooms.delete(code);
    return;
  }

  if (gone) {
    io.to(room.code).emit('room:notice', { type: 'leave', message: gone.name + ' salió de la sala.' });
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
    const newHost = room.players.get(room.hostId);
    io.to(room.code).emit('room:notice', {
      type: 'host',
      message: 'Nuevo anfitrión: ' + (newHost ? newHost.name : '—')
    });
    if (room.state === 'loading' || room.state === 'countdown' || room.state === 'playing') {
      abortGame(room, 'El anfitrión salió durante la partida.');
      return;
    }
  }

  if (room.state === 'loading') { maybeStart(room); return; }
  if (room.state === 'countdown' || room.state === 'playing') {
    if ([...room.players.values()].every((p) => p.finished)) { endGame(room); return; }
  }
  broadcastRoom(room);
}

function sanitizeBeatmap(raw, lanes) {
  if (!Array.isArray(raw)) return null;
  const maxLane = (lanes || 4) - 1;
  const notes = [];
  for (let i = 0; i < raw.length && notes.length < MAX_NOTES; i++) {
    const n = raw[i];
    if (!n) continue;
    const t = Number(n.t);
    const lane = Math.floor(Number(n.lane));
    if (!Number.isFinite(t) || t < 0 || !Number.isFinite(lane) || lane < 0 || lane > maxLane) continue;
    notes.push({ t: Math.round(t * 1000) / 1000, lane });
  }
  notes.sort((a, b) => a.t - b.t);
  return notes.length ? notes : null;
}

/* ---------------------------------------------------------------------- */
/* Socket.io                                                              */
/* ---------------------------------------------------------------------- */

io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('sync:ping', (clientTime, cb) => {
    if (typeof cb === 'function') cb({ clientTime, serverTime: Date.now() });
  });

  socket.on('room:create', (payload, cb) => {
    const ack = typeof cb === 'function' ? cb : () => {};
    const name = sanitizeName(payload && payload.name, 'Anfitrión');
    leaveRoom(socket);
    const code = makeCode();
    const room = createRoom(code, socket.id);
    room.players.set(socket.id, createPlayer(socket.id, name, pickCharacter(room, payload && payload.character)));
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, code, youId: socket.id, room: publicRoom(room) });
    broadcastRoom(room);
  });

  socket.on('room:join', (payload, cb) => {
    const ack = typeof cb === 'function' ? cb : () => {};
    const code = String((payload && payload.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'La sala ' + (code || '????') + ' no existe.' });
    if (room.state !== 'lobby' && room.state !== 'results') {
      return ack({ ok: false, error: 'La partida ya comenzó. Inténtalo al terminar la canción.' });
    }
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: 'La sala está llena (4/4).' });
    leaveRoom(socket);
    const name = sanitizeName(payload && payload.name, 'Jugador ' + (room.players.size + 1));
    room.players.set(socket.id, createPlayer(socket.id, name, pickCharacter(room, payload && payload.character)));
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, code, youId: socket.id, room: publicRoom(room) });
    socket.to(code).emit('room:notice', { type: 'join', message: name + ' entró a la sala.' });
    broadcastRoom(room);
  });

  socket.on('room:leave', (payload, cb) => {
    leaveRoom(socket);
    if (typeof cb === 'function') cb({ ok: true });
    socket.emit('room:left', { ok: true });
  });

  socket.on('room:difficulty', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'lobby' && room.state !== 'results') return;
    const diff = String((payload && payload.difficulty) || 'normal');
    if (!DIFFS.includes(diff)) return;
    room.difficulty = diff;
    broadcastRoom(room);
  });

  socket.on('room:character', (payload, cb) => {
    const ack = typeof cb === 'function' ? cb : () => {};
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'No estás en una sala.' });
    const player = room.players.get(socket.id);
    if (!player) return ack({ ok: false, error: 'Jugador no encontrado.' });
    const id = String((payload && payload.character) || '');
    if (!CHARACTER_IDS.includes(id)) return ack({ ok: false, error: 'Personaje desconocido.' });
    const owner = [...room.players.values()].find((p) => p.character === id && p.id !== socket.id);
    if (owner) return ack({ ok: false, error: owner.name + ' ya eligió ese personaje.' });
    player.character = id;
    ack({ ok: true, character: id });
    broadcastRoom(room);
  });

  socket.on('game:launch', (payload, cb) => {
    const ack = typeof cb === 'function' ? cb : () => {};
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'No estás en una sala.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Solo el anfitrión puede iniciar la partida.' });
    if (['loading', 'countdown', 'playing'].includes(room.state)) {
      return ack({ ok: false, error: 'La partida ya se está preparando.' });
    }
    if (!payload) return ack({ ok: false, error: 'Datos incompletos.' });

    const difficulty = DIFFS.includes(payload.difficulty) ? payload.difficulty : room.difficulty;
    const lanes = LANES_BY_DIFF[difficulty] || 4;
    const beatmap = sanitizeBeatmap(payload.beatmap, lanes);
    if (!beatmap) return ack({ ok: false, error: 'El beatmap está vacío o es inválido.' });

    const audio = payload.audio;
    const size = audio ? (audio.byteLength || audio.length || 0) : 0;
    if (!audio || !size) return ack({ ok: false, error: 'No se recibió el audio.' });
    if (size > MAX_AUDIO_BYTES) return ack({ ok: false, error: 'El audio supera los 50 MB.' });

    const duration = Number(payload.duration);
    if (!Number.isFinite(duration) || duration <= 1) return ack({ ok: false, error: 'Duración inválida.' });

    clearTimers(room);
    room.difficulty = difficulty;
    room.lanes = lanes;
    room.songName = String(payload.songName || 'Canción').slice(0, 60);
    room.duration = duration;
    room.bpm = clamp(Number(payload.bpm) || 0, 0, 400);
    room.beatmap = beatmap;
    room.noteCount = beatmap.length;
    room.audio = audio;
    room.audioType = String(payload.audioType || 'audio/mpeg').slice(0, 40);
    room.state = 'loading';
    room.players.forEach(resetPlayerStats);

    const meta = {
      difficulty: room.difficulty,
      lanes: room.lanes,
      songName: room.songName,
      duration: room.duration,
      bpm: room.bpm,
      beatmap: room.beatmap,
      audioType: room.audioType
    };

    socket.to(room.code).emit('game:prepare', Object.assign({ hasAudio: true, audio: room.audio }, meta));
    socket.emit('game:prepare', Object.assign({ hasAudio: false }, meta));

    room.loadTimer = setTimeout(() => {
      if (room.state === 'loading') {
        const slow = [...room.players.values()].filter((p) => !p.loaded).map((p) => p.name).join(', ');
        abortGame(room, 'Tiempo agotado esperando a: ' + (slow || '—'));
      }
    }, LOAD_TIMEOUT_MS);

    ack({ ok: true, notes: beatmap.length, lanes });
    broadcastRoom(room);
  });

  socket.on('game:loaded', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'loading') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.loaded = true;
    broadcastRoom(room);
    maybeStart(room);
  });

  socket.on('game:error', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    const who = player ? player.name : 'Un jugador';
    if (['loading', 'countdown', 'playing'].includes(room.state)) {
      abortGame(room, who + ' no pudo cargar la canción: ' + String((payload && payload.message) || 'error de audio'));
    }
  });

  socket.on('game:progress', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !payload) return;
    if (room.state !== 'playing' && room.state !== 'countdown') return;
    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    player.score = Math.max(0, intOr(payload.score, player.score));
    player.combo = Math.max(0, intOr(payload.combo, 0));
    player.maxCombo = Math.max(player.maxCombo, intOr(payload.maxCombo, 0));
    player.hits = Math.max(0, intOr(payload.hits, player.hits));
    player.misses = Math.max(0, intOr(payload.misses, player.misses));
    player.health = clamp(intOr(payload.health, player.health), 0, 100);
    if (payload.dead === true || player.health <= 0) player.dead = true;
    player.presses = clamp(intOr(payload.presses, 0), 0, 63);
    const total = player.hits + player.misses;
    player.accuracy = total ? Math.round((player.hits / total) * 1000) / 10 : 100;

    io.to(room.code).emit('game:scores', {
      players: [...room.players.values()].map((p) => {
        const row = {
          id: p.id, name: p.name, character: p.character, score: p.score, combo: p.combo,
          maxCombo: p.maxCombo, hits: p.hits, misses: p.misses, accuracy: p.accuracy,
          health: p.health, dead: p.dead, presses: p.presses, finished: p.finished
        };
        p.presses = 0;
        return row;
      })
    });
  });

  socket.on('game:finish', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (!['loading', 'countdown', 'playing'].includes(room.state)) return;
    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    if (payload) {
      player.score = Math.max(0, intOr(payload.score, player.score));
      player.hits = Math.max(0, intOr(payload.hits, player.hits));
      player.misses = Math.max(0, intOr(payload.misses, player.misses));
      player.maxCombo = Math.max(player.maxCombo, intOr(payload.maxCombo, 0));
      player.perfect = Math.max(0, intOr(payload.perfect, 0));
      player.great = Math.max(0, intOr(payload.great, 0));
      player.good = Math.max(0, intOr(payload.good, 0));
      player.health = clamp(intOr(payload.health, player.health), 0, 100);
      if (payload.dead === true || player.health <= 0) player.dead = true;
      const total = player.hits + player.misses;
      player.accuracy = total ? Math.round((player.hits / total) * 1000) / 10 : 0;
    }
    player.finished = true;
    player.combo = 0;
    broadcastRoom(room);

    if ([...room.players.values()].every((p) => p.finished)) {
      endGame(room);
    } else if (!room.finishTimer) {
      room.finishTimer = setTimeout(() => endGame(room), FINISH_TIMEOUT_MS);
    }
  });

  socket.on('room:backToLobby', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'results') return;
    returnToLobby(room);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    if (room.players.size === 0 || now - room.lastActivity > ROOM_TTL_MS) {
      clearTimers(room);
      rooms.delete(code);
    }
  });
}, 60000).unref();

server.listen(PORT, HOST, () => {
  console.log('┌───────────────────────────────────────────────');
  console.log('│ RHYTHM ARENA');
  console.log('│ URL      : http://localhost:' + PORT);
  console.log('│ Estáticos: ' + (PUBLIC_DIR || '*** index.html NO ENCONTRADO ***'));
  if (!PUBLIC_DIR) {
    console.log('│ Coloca index.html, style.css, engine.js y game.js');
    console.log('│ en ' + path.join(__dirname, 'public') + ' (o junto a server.js).');
  }
  console.log('└───────────────────────────────────────────────');
});

module.exports = { app, server, io, rooms, PUBLIC_DIR };
