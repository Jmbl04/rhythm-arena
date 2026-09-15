/* =========================================================================
   RHYTHM ARENA — characters.js
   Roster de 15 personajes + dibujo vectorial (Canvas 2D) de personajes y
   escenario. Sin imágenes externas: todo se dibuja por código.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------ ROSTER ------------------------------- */

  var ROSTER = [
    { id: 'luna',   name: 'Luna Voltaje',  role: 'Punk eléctrica',   instrument: 'guitar', skin: '#f0c49b', hair: '#ff2d95', hairStyle: 'mohawk',   outfit: '#1b1033', accent: '#ff2d95', accessory: 'shades',   bio: 'Riffs rápidos y cero paciencia.' },
    { id: 'rico',   name: 'Rico Fuego',    role: 'Metal clásico',    instrument: 'guitar', skin: '#c98b5e', hair: '#241a12', hairStyle: 'long',     outfit: '#2b0d0d', accent: '#ff6a2d', accessory: 'headband', bio: 'Solos que huelen a chamusquina.' },
    { id: 'zara',   name: 'Zara Neón',     role: 'Synthwave',        instrument: 'keytar', skin: '#e8b98f', hair: '#00e5ff', hairStyle: 'bob',      outfit: '#0d1b3a', accent: '#00e5ff', accessory: 'glasses',  bio: 'Vive en 1986 y no piensa volver.' },
    { id: 'bruno',  name: 'Bruno Bajo',    role: 'Groove profundo',  instrument: 'bass',   skin: '#8d5a3b', hair: '#1a1a1a', hairStyle: 'afro',     outfit: '#14331f', accent: '#7cff4d', accessory: 'none',     bio: 'Sostiene la banda con cuatro cuerdas.' },
    { id: 'kira',   name: 'Kira Eclipse',  role: 'Voz principal',    instrument: 'mic',    skin: '#f3d3b3', hair: '#2b2b40', hairStyle: 'long',     outfit: '#2a0f3d', accent: '#c56bff', accessory: 'none',     bio: 'Puede romper una copa y un récord.' },
    { id: 'dante',  name: 'Dante Riff',    role: 'Hard rock',        instrument: 'guitar', skin: '#b9784f', hair: '#4a2c18', hairStyle: 'ponytail', outfit: '#331a05', accent: '#ffd400', accessory: 'shades',   bio: 'Lleva púa de repuesto en el sombrero.' },
    { id: 'mila',   name: 'Mila Pulso',    role: 'Batería',          instrument: 'drums',  skin: '#f0c49b', hair: '#ff7a00', hairStyle: 'bun',      outfit: '#0f2233', accent: '#ff7a00', accessory: 'headband', bio: 'Su metrónomo interno nunca falla.' },
    { id: 'axel',   name: 'Axel Trueno',   role: 'Stadium rock',     instrument: 'guitar', skin: '#e0a878', hair: '#f4f1e0', hairStyle: 'spiky',    outfit: '#101018', accent: '#00b3ff', accessory: 'none',     bio: 'Nació para los estadios llenos.' },
    { id: 'nyx',    name: 'Nyx Sombra',    role: 'Gótico oscuro',    instrument: 'bass',   skin: '#dcc3c9', hair: '#120b1c', hairStyle: 'long',     outfit: '#16101f', accent: '#8a4dff', accessory: 'mask',     bio: 'Toca con los ojos cerrados. Siempre.' },
    { id: 'paco',   name: 'Paco Salsa',    role: 'Percusión latina', instrument: 'drums',  skin: '#a86b40', hair: '#20150d', hairStyle: 'short',    outfit: '#8a1f2d', accent: '#ffd400', accessory: 'hat',      bio: 'Convierte cualquier tema en fiesta.' },
    { id: 'iris',   name: 'Iris Prisma',   role: 'Pop luminoso',     instrument: 'keytar', skin: '#f7dcc3', hair: '#ffd400', hairStyle: 'ponytail', outfit: '#ff3d7f', accent: '#ffffff', accessory: 'glasses',  bio: 'Estribillos que no se te van del día.' },
    { id: 'vera',   name: 'Vera Vinilo',   role: 'DJ y scratch',     instrument: 'dj',     skin: '#8a5a3c', hair: '#6a3df0', hairStyle: 'bob',      outfit: '#101430', accent: '#6a3df0', accessory: 'shades',   bio: 'Mezcla en vivo lo que tú improvisas.' },
    { id: 'tono',   name: 'Toño Metal',    role: 'Thrash veloz',     instrument: 'guitar', skin: '#d79c6e', hair: '#0f0f0f', hairStyle: 'long',     outfit: '#0b0b0b', accent: '#e5e5e5', accessory: 'none',     bio: 'Doscientos veinte pulsaciones por minuto.' },
    { id: 'sasha',  name: 'Sasha Estática',role: 'Electro punk',     instrument: 'keytar', skin: '#f0cbb0', hair: '#7cff4d', hairStyle: 'mohawk',   outfit: '#1f1030', accent: '#7cff4d', accessory: 'glasses',  bio: 'Chispas de verdad en cada nota.' },
    { id: 'kenji',  name: 'Kenji Kaos',    role: 'Rock alternativo', instrument: 'bass',   skin: '#eec6a0', hair: '#1b1b2b', hairStyle: 'short',    outfit: '#123b3b', accent: '#00ffc8', accessory: 'headband', bio: 'Compases raros, sonrisa tranquila.' }
  ];

  var BY_ID = {};
  ROSTER.forEach(function (c) { BY_ID[c.id] = c; });

  function get(id) { return BY_ID[id] || ROSTER[0]; }

  function randomFree(takenIds) {
    var taken = {};
    (takenIds || []).forEach(function (id) { taken[id] = true; });
    var free = ROSTER.filter(function (c) { return !taken[c.id]; });
    var pool = free.length ? free : ROSTER;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  /* ---------------------------- utilidades ----------------------------- */

  function shade(hex, amount) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v + 255 * amount))); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function alpha(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' +
      parseInt(h.substr(4, 2), 16) + ',' + a + ')';
  }
  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot || 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function rrect(ctx, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* -------------------------- instrumentos ----------------------------- */

  function drawGuitar(ctx, u, color, accent, strum, isBass) {
    // eje: mástil hacia arriba-derecha, cuerpo abajo-izquierda
    ctx.save();
    ctx.rotate(-0.45 + strum * 0.05);
    var bodyW = u * (isBass ? 2.5 : 2.7), bodyH = u * (isBass ? 1.7 : 1.9);
    ctx.fillStyle = color;
    ellipse(ctx, 0, 0, bodyW * 0.5, bodyH * 0.5);
    ellipse(ctx, -bodyW * 0.32, -bodyH * 0.12, bodyW * 0.28, bodyH * 0.42);
    ctx.fillStyle = alpha('#000000', 0.35);
    ellipse(ctx, bodyW * 0.08, 0, u * 0.32, u * 0.32);
    ctx.fillStyle = accent;
    rrect(ctx, -u * 0.2, -u * 0.18, bodyW * 0.45, u * 0.36, u * 0.1);
    ctx.fill();
    // mástil
    ctx.fillStyle = shade(color, -0.35);
    rrect(ctx, bodyW * 0.35, -u * 0.17, u * (isBass ? 4.2 : 3.6), u * 0.34, u * 0.08);
    ctx.fill();
    ctx.fillStyle = '#efe6d8';
    rrect(ctx, bodyW * 0.35 + u * (isBass ? 4.2 : 3.6), -u * 0.3, u * 0.55, u * 0.6, u * 0.1);
    ctx.fill();
    ctx.restore();
  }

  function drawKeytar(ctx, u, color, accent) {
    ctx.save();
    ctx.rotate(-0.25);
    ctx.fillStyle = shade(color, -0.2);
    rrect(ctx, -u * 1.2, -u * 0.35, u * 5.2, u * 0.85, u * 0.18);
    ctx.fill();
    ctx.fillStyle = '#f2f2f7';
    for (var i = 0; i < 9; i++) rrect(ctx, -u * 1.0 + i * u * 0.52, -u * 0.18, u * 0.42, u * 0.5, u * 0.05), ctx.fill();
    ctx.fillStyle = '#16121f';
    for (var j = 0; j < 8; j++) {
      if (j % 7 === 2 || j % 7 === 6) continue;
      rrect(ctx, -u * 0.82 + j * u * 0.52, -u * 0.18, u * 0.2, u * 0.3, u * 0.03);
      ctx.fill();
    }
    ctx.fillStyle = accent;
    rrect(ctx, -u * 1.15, -u * 0.32, u * 0.3, u * 0.78, u * 0.08);
    ctx.fill();
    ctx.restore();
  }

  function drawMic(ctx, u, accent) {
    ctx.save();
    ctx.strokeStyle = '#c9cede';
    ctx.lineWidth = u * 0.16;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(u * 0.5, -u * 1.5);
    ctx.stroke();
    ctx.fillStyle = accent;
    ellipse(ctx, u * 0.55, -u * 1.7, u * 0.34, u * 0.34);
    ctx.restore();
  }

  function drawDrums(ctx, u, color, accent, hit) {
    ctx.save();
    ctx.fillStyle = shade(color, -0.1);
    rrect(ctx, -u * 2.6, -u * 1.9, u * 5.2, u * 2.0, u * 0.5);
    ctx.fill();
    ctx.fillStyle = '#e9e6f2';
    ellipse(ctx, 0, -u * 1.9, u * 2.6, u * 0.55);
    ctx.fillStyle = accent;
    rrect(ctx, -u * 0.25, -u * 1.7, u * 0.5, u * 1.6, u * 0.1);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.25);
    rrect(ctx, -u * 4.1, -u * 2.6, u * 1.7, u * 1.4, u * 0.35); ctx.fill();
    rrect(ctx, u * 2.4, -u * 2.6, u * 1.7, u * 1.4, u * 0.35); ctx.fill();
    ctx.fillStyle = '#ffd86b';
    ctx.save();
    ctx.translate(u * 3.6, -u * 3.4 - hit * u * 0.12);
    ctx.rotate(0.2 + hit * 0.12);
    ellipse(ctx, 0, 0, u * 1.5, u * 0.22);
    ctx.restore();
    ctx.restore();
  }

  function drawTurntable(ctx, u, color, accent, spin) {
    ctx.save();
    ctx.fillStyle = shade(color, -0.15);
    rrect(ctx, -u * 3.2, -u * 1.5, u * 6.4, u * 1.5, u * 0.3);
    ctx.fill();
    ctx.fillStyle = '#14121d';
    ellipse(ctx, -u * 1.5, -u * 1.5, u * 1.2, u * 0.42);
    ctx.fillStyle = accent;
    ctx.save();
    ctx.translate(-u * 1.5, -u * 1.5);
    ctx.rotate(spin);
    ctx.fillRect(-u * 0.9, -u * 0.06, u * 1.8, u * 0.12);
    ctx.restore();
    ctx.fillStyle = '#2a2740';
    rrect(ctx, u * 0.4, -u * 1.5, u * 2.2, u * 0.5, u * 0.1);
    ctx.fill();
    ctx.fillStyle = accent;
    for (var i = 0; i < 4; i++) ellipse(ctx, u * 0.7 + i * u * 0.45, -u * 1.25, u * 0.1, u * 0.1);
    ctx.restore();
  }

  /* ---------------------------- personaje ------------------------------ */
  /**
   * drawCharacter(ctx, char, x, yFeet, height, opts)
   * opts: { t (segundos), energy 0..1, state 'idle'|'play'|'miss'|'cheer', shadow }
   */
  function drawCharacter(ctx, ch, x, yFeet, height, opts) {
    ch = typeof ch === 'string' ? get(ch) : (ch || ROSTER[0]);
    opts = opts || {};
    var t = opts.t || 0;
    var energy = Math.max(0, Math.min(1, opts.energy == null ? 0.4 : opts.energy));
    var state = opts.state || 'idle';
    var u = height / 10;                       // unidad base
    var phase = (ch.id.charCodeAt(0) % 7) * 0.7;
    var beat = Math.sin(t * 5 + phase);
    var bob = beat * u * (0.10 + energy * 0.22);
    var lean = state === 'miss' ? 0.16 : Math.sin(t * 2.2 + phase) * 0.04 * (0.4 + energy);
    var strum = state === 'play' ? Math.sin(t * 11 + phase) : Math.sin(t * 3 + phase) * 0.3;
    var slump = state === 'miss' ? u * 0.45 : 0;

    ctx.save();
    ctx.translate(x, yFeet);

    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ellipse(ctx, 0, 0, u * 1.9, u * 0.42);
    }

    ctx.save();
    ctx.translate(0, -bob + slump);
    ctx.rotate(lean);

    var outfit = ch.outfit, accent = ch.accent, skin = ch.skin;
    var legTop = -u * 3.4;

    // piernas
    ctx.fillStyle = shade(outfit, -0.18);
    rrect(ctx, -u * 1.05, legTop, u * 0.9, u * 3.4, u * 0.3); ctx.fill();
    rrect(ctx, u * 0.15, legTop, u * 0.9, u * 3.4, u * 0.3); ctx.fill();
    ctx.fillStyle = '#15121f';
    rrect(ctx, -u * 1.2, -u * 0.45, u * 1.15, u * 0.45, u * 0.16); ctx.fill();
    rrect(ctx, u * 0.05, -u * 0.45, u * 1.15, u * 0.45, u * 0.16); ctx.fill();

    // torso
    var torsoTop = -u * 6.6;
    ctx.fillStyle = outfit;
    rrect(ctx, -u * 1.45, torsoTop, u * 2.9, u * 3.3, u * 0.75); ctx.fill();
    ctx.fillStyle = accent;
    rrect(ctx, -u * 0.28, torsoTop + u * 0.35, u * 0.56, u * 2.6, u * 0.2); ctx.fill();
    ctx.fillStyle = alpha('#ffffff', 0.10);
    rrect(ctx, -u * 1.45, torsoTop, u * 1.2, u * 3.3, u * 0.75); ctx.fill();

    // brazos + instrumento
    var armY = torsoTop + u * 0.9;
    ctx.strokeStyle = skin;
    ctx.lineCap = 'round';
    ctx.lineWidth = u * 0.62;

    var inst = ch.instrument;
    if (inst === 'guitar' || inst === 'bass' || inst === 'keytar') {
      ctx.save();
      ctx.translate(0, torsoTop + u * 2.3);
      if (inst === 'keytar') drawKeytar(ctx, u, outfit, accent);
      else drawGuitar(ctx, u, shade(outfit, 0.25), accent, strum, inst === 'bass');
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-u * 1.3, armY);
      ctx.lineTo(-u * 2.0, armY + u * 1.5 + strum * u * 0.2);
      ctx.lineTo(-u * 0.9, armY + u * 2.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 1.3, armY);
      ctx.lineTo(u * 2.1, armY + u * 1.1);
      ctx.lineTo(u * 1.5, armY + u * 2.2 + strum * u * 0.35);
      ctx.stroke();
    } else if (inst === 'mic') {
      ctx.beginPath();
      ctx.moveTo(-u * 1.3, armY);
      ctx.lineTo(-u * 2.2, armY - u * 0.4 + strum * u * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 1.3, armY);
      ctx.lineTo(u * 2.0, armY - u * 1.2 - energy * u * 0.6);
      ctx.stroke();
      ctx.save();
      ctx.translate(u * 2.0, armY - u * 1.2 - energy * u * 0.6);
      drawMic(ctx, u, accent);
      ctx.restore();
    } else if (inst === 'drums') {
      ctx.beginPath();
      ctx.moveTo(-u * 1.3, armY);
      ctx.lineTo(-u * 2.3, armY + u * (strum > 0 ? 0.2 : 1.1));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 1.3, armY);
      ctx.lineTo(u * 2.3, armY + u * (strum > 0 ? 1.1 : 0.2));
      ctx.stroke();
    } else if (inst === 'dj') {
      ctx.beginPath();
      ctx.moveTo(-u * 1.3, armY);
      ctx.lineTo(-u * 2.3, armY + u * 1.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 1.3, armY);
      ctx.lineTo(u * 2.2, armY + u * 0.9 + strum * u * 0.3);
      ctx.stroke();
    }

    // ---- cabeza: pelo trasero, cráneo, cara, flequillo ----
    var headY = torsoTop - u * 1.28 + (state === 'miss' ? u * 0.25 : 0);
    var hair = ch.hair;

    ctx.fillStyle = skin;
    rrect(ctx, -u * 0.35, torsoTop - u * 0.5, u * 0.7, u * 0.65, u * 0.2); ctx.fill();

    // pelo trasero (detrás de la cara)
    ctx.fillStyle = shade(hair, -0.08);
    switch (ch.hairStyle) {
      case 'long':
        rrect(ctx, -u * 1.35, headY - u * 0.7, u * 2.7, u * 3.1, u * 0.7); ctx.fill();
        break;
      case 'bob':
        rrect(ctx, -u * 1.35, headY - u * 0.7, u * 2.7, u * 2.1, u * 0.7); ctx.fill();
        break;
      case 'afro':
        ellipse(ctx, 0, headY - u * 0.45, u * 1.75, u * 1.5);
        break;
      case 'ponytail':
        ctx.save();
        ctx.rotate(-0.15);
        rrect(ctx, u * 0.75, headY - u * 0.7, u * 0.6, u * 2.6, u * 0.3); ctx.fill();
        ctx.restore();
        break;
      case 'bun':
        ellipse(ctx, 0, headY - u * 1.55, u * 0.62, u * 0.62);
        break;
      default: break;
    }

    // cráneo
    ctx.fillStyle = skin;
    ellipse(ctx, 0, headY, u * 1.15, u * 1.28);
    ctx.fillStyle = shade(skin, -0.12);
    ellipse(ctx, -u * 1.12, headY + u * 0.12, u * 0.2, u * 0.3);
    ellipse(ctx, u * 1.12, headY + u * 0.12, u * 0.2, u * 0.3);

    // flequillo / parte superior del pelo (nunca tapa los ojos)
    var fringeY = headY - u * 0.42;
    ctx.fillStyle = hair;
    switch (ch.hairStyle) {
      case 'mohawk':
        ctx.beginPath();
        ctx.moveTo(-u * 0.3, headY - u * 1.0);
        ctx.quadraticCurveTo(0, headY - u * 2.7, u * 0.3, headY - u * 1.0);
        ctx.closePath(); ctx.fill();
        rrect(ctx, -u * 1.0, fringeY - u * 0.62, u * 2.0, u * 0.72, u * 0.3); ctx.fill();
        break;
      case 'spiky':
        for (var sp = -2; sp <= 2; sp++) {
          ctx.beginPath();
          ctx.moveTo(sp * u * 0.48 - u * 0.26, headY - u * 0.8);
          ctx.lineTo(sp * u * 0.48 + Math.sin(sp) * u * 0.12, headY - u * 2.1);
          ctx.lineTo(sp * u * 0.48 + u * 0.26, headY - u * 0.8);
          ctx.closePath(); ctx.fill();
        }
        rrect(ctx, -u * 1.08, fringeY - u * 0.58, u * 2.16, u * 0.72, u * 0.3); ctx.fill();
        break;
      case 'afro':
        rrect(ctx, -u * 1.1, fringeY - u * 0.7, u * 2.2, u * 0.85, u * 0.36); ctx.fill();
        break;
      default:
        rrect(ctx, -u * 1.12, fringeY - u * 0.72, u * 2.24, u * 0.9, u * 0.4); ctx.fill();
        // mechón lateral
        rrect(ctx, -u * 1.12, fringeY - u * 0.3, u * 0.55, u * 0.95, u * 0.22); ctx.fill();
    }

    // cara
    var eyeY = headY + u * 0.05;
    if (ch.accessory === 'shades' || ch.accessory === 'glasses') {
      ctx.fillStyle = ch.accessory === 'shades' ? '#141018' : alpha('#dff6ff', 0.6);
      rrect(ctx, -u * 0.88, eyeY - u * 0.26, u * 0.74, u * 0.5, u * 0.14); ctx.fill();
      rrect(ctx, u * 0.14, eyeY - u * 0.26, u * 0.74, u * 0.5, u * 0.14); ctx.fill();
      ctx.strokeStyle = ch.accessory === 'shades' ? '#141018' : 'rgba(255,255,255,.75)';
      ctx.lineWidth = u * 0.09;
      ctx.beginPath(); ctx.moveTo(-u * 0.14, eyeY - u * 0.02); ctx.lineTo(u * 0.14, eyeY - u * 0.02); ctx.stroke();
    } else if (ch.accessory === 'mask') {
      ctx.fillStyle = alpha(ch.accent, 0.9);
      rrect(ctx, -u * 0.95, eyeY - u * 0.3, u * 1.9, u * 0.56, u * 0.18); ctx.fill();
      ctx.fillStyle = '#0b0810';
      ellipse(ctx, -u * 0.42, eyeY - u * 0.02, u * 0.22, u * 0.13);
      ellipse(ctx, u * 0.42, eyeY - u * 0.02, u * 0.22, u * 0.13);
    } else {
      ctx.fillStyle = '#1a1420';
      var blink = (Math.sin(t * 1.7 + phase * 3) > 0.985) ? 0.25 : 1;
      ellipse(ctx, -u * 0.42, eyeY, u * 0.15, u * 0.2 * blink);
      ellipse(ctx, u * 0.42, eyeY, u * 0.15, u * 0.2 * blink);
      ctx.fillStyle = shade(hair, -0.1);
      rrect(ctx, -u * 0.6, eyeY - u * 0.42, u * 0.38, u * 0.1, u * 0.05); ctx.fill();
      rrect(ctx, u * 0.22, eyeY - u * 0.42, u * 0.38, u * 0.1, u * 0.05); ctx.fill();
    }

    // boca
    ctx.strokeStyle = '#7d3b46';
    ctx.lineWidth = u * 0.13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (state === 'miss') {
      ctx.arc(0, headY + u * 0.95, u * 0.3, Math.PI * 1.15, Math.PI * 1.85);
    } else if (ch.instrument === 'mic' || state === 'cheer') {
      ctx.restore = ctx.restore;
      ctx.fillStyle = '#7d3b46';
      ellipse(ctx, 0, headY + u * 0.66, u * 0.24, u * 0.3 * (0.6 + Math.abs(beat) * 0.6));
      ctx.beginPath();
    } else {
      ctx.arc(0, headY + u * 0.45, u * 0.34, 0.15 * Math.PI, 0.85 * Math.PI);
    }
    ctx.stroke();

    if (ch.accessory === 'headband') {
      ctx.fillStyle = ch.accent;
      rrect(ctx, -u * 1.18, headY - u * 0.55, u * 2.36, u * 0.32, u * 0.1); ctx.fill();
    } else if (ch.accessory === 'hat') {
      ctx.fillStyle = shade(ch.outfit, 0.3);
      ellipse(ctx, 0, headY - u * 0.85, u * 1.85, u * 0.34);
      rrect(ctx, -u * 1.0, headY - u * 1.85, u * 2.0, u * 1.05, u * 0.22); ctx.fill();
      ctx.fillStyle = ch.accent;
      rrect(ctx, -u * 1.0, headY - u * 1.15, u * 2.0, u * 0.28, u * 0.08); ctx.fill();
    }

    ctx.restore();

    // props delante del personaje
    if (ch.instrument === 'drums' || ch.instrument === 'dj') {
      ctx.save();
      ctx.translate(0, -u * 0.2);
      if (ch.instrument === 'drums') drawDrums(ctx, u, ch.outfit, ch.accent, strum > 0 ? 1 : 0);
      else drawTurntable(ctx, u, ch.outfit, ch.accent, t * 3);
      ctx.restore();
    }

    ctx.restore();
  }

  /* ----------------------------- retrato ------------------------------- */

  function drawPortrait(ctx, ch, w, h, t, opts) {
    ch = typeof ch === 'string' ? get(ch) : ch;
    opts = opts || {};
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0813';
    ctx.fillRect(0, 0, w, h);
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, alpha(ch.accent, 0.22));
    g.addColorStop(0.55, 'rgba(14,10,26,0.92)');
    g.addColorStop(1, 'rgba(6,4,12,0.98)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = alpha(ch.accent, 0.8);
    for (var i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.1 + i * 0.2), 0);
      ctx.lineTo(w * (0.02 + i * 0.2), h);
      ctx.lineTo(w * (0.16 + i * 0.2), h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    var height = h * (opts.full ? 0.82 : 1.55);
    drawCharacter(ctx, ch, w / 2, h * (opts.full ? 0.94 : 1.12), height, {
      t: t || 0, energy: opts.energy == null ? 0.55 : opts.energy, state: opts.state || 'play', shadow: !!opts.full
    });
    ctx.restore();
  }

  /* ----------------------------- escenario ----------------------------- */

  var crowd = null;
  function buildCrowd(w, h) {
    crowd = { w: w, h: h, people: [] };
    var count = Math.max(14, Math.round(w / 26));
    for (var i = 0; i < count; i++) {
      crowd.people.push({
        x: (i + 0.5) * (w / count) + (Math.random() - 0.5) * 12,
        s: 0.75 + Math.random() * 0.55,
        p: Math.random() * Math.PI * 2,
        arms: Math.random() > 0.55
      });
    }
  }

  /**
   * drawStage(ctx, w, h, opts)
   * opts: { t, energy 0..1, accent, horizon (y del suelo del escenario) }
   */
  function drawStage(ctx, w, h, opts) {
    opts = opts || {};
    var t = opts.t || 0;
    var energy = Math.max(0, Math.min(1, opts.energy == null ? 0.4 : opts.energy));
    var accent = opts.accent || '#ff2d95';
    var floorY = opts.horizon || h * 0.78;

    var sky = ctx.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, '#0a0715');
    sky.addColorStop(0.55, '#150b26');
    sky.addColorStop(1, '#1d1033');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, floorY);

    // haces de luz
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 4; i++) {
      var baseX = w * (0.16 + i * 0.23);
      var swing = Math.sin(t * (0.7 + i * 0.13) + i) * w * 0.16;
      var col = i % 2 ? accent : '#00e5ff';
      var g = ctx.createLinearGradient(baseX, 0, baseX + swing, floorY);
      g.addColorStop(0, alpha(col, 0.30 + energy * 0.28));
      g.addColorStop(1, alpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(baseX - w * 0.012, 0);
      ctx.lineTo(baseX + w * 0.012, 0);
      ctx.lineTo(baseX + swing + w * 0.12, floorY);
      ctx.lineTo(baseX + swing - w * 0.12, floorY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // truss superior
    ctx.fillStyle = '#0c0916';
    ctx.fillRect(0, 0, w, h * 0.055);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    for (var x = 0; x < w; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + 13, h * 0.055); ctx.lineTo(x + 26, 0);
      ctx.stroke();
    }
    for (var l = 0; l < 6; l++) {
      var lx = (l + 0.5) * (w / 6);
      var on = 0.45 + 0.55 * Math.abs(Math.sin(t * 3 + l));
      ctx.fillStyle = alpha(l % 2 ? accent : '#00e5ff', 0.35 + on * 0.5);
      ellipse(ctx, lx, h * 0.055, 7, 5);
    }

    // pantalla trasera
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    rrect(ctx, w * 0.22, h * 0.10, w * 0.56, h * 0.30, 10);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    rrect(ctx, w * 0.22, h * 0.10, w * 0.56, h * 0.30, 10);
    ctx.clip();
    for (var b = 0; b < 26; b++) {
      var bh = (0.25 + 0.75 * Math.abs(Math.sin(t * 4 + b * 0.7))) * h * 0.26 * (0.35 + energy);
      ctx.fillStyle = alpha(b % 3 ? accent : '#7cff4d', 0.5);
      ctx.fillRect(w * 0.225 + b * (w * 0.56 / 26), h * 0.40 - bh, w * 0.56 / 26 - 2, bh);
    }
    ctx.restore();

    // altavoces
    ctx.fillStyle = '#100c1c';
    rrect(ctx, w * 0.02, floorY - h * 0.30, w * 0.10, h * 0.30, 6); ctx.fill();
    rrect(ctx, w * 0.88, floorY - h * 0.30, w * 0.10, h * 0.30, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    for (var sx = 0; sx < 2; sx++) {
      for (var sy = 0; sy < 3; sy++) {
        var px = sx === 0 ? w * 0.035 : w * 0.895;
        ellipse(ctx, px + w * 0.035, floorY - h * 0.26 + sy * h * 0.09, w * 0.03, h * 0.032);
      }
    }

    // suelo
    var floor = ctx.createLinearGradient(0, floorY, 0, h);
    floor.addColorStop(0, '#241636');
    floor.addColorStop(1, '#0a0713');
    ctx.fillStyle = floor;
    ctx.fillRect(0, floorY, w, h - floorY);
    ctx.strokeStyle = alpha(accent, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(w, floorY); ctx.stroke();

    // velo general: mantiene el escenario por detrás de la pista de juego
    ctx.fillStyle = 'rgba(4,3,10,.30)';
    ctx.fillRect(0, 0, w, h);

    // público en primer plano
    if (!crowd || crowd.w !== w || crowd.h !== h) buildCrowd(w, h);
    ctx.fillStyle = 'rgba(4,3,9,.92)';
    crowd.people.forEach(function (p) {
      var bob = Math.sin(t * 4.5 + p.p) * (3 + energy * 7);
      var headR = 9 * p.s;
      var y = h - 4 + bob;
      ellipse(ctx, p.x, y - headR * 3.1, headR, headR);
      rrect(ctx, p.x - headR * 1.25, y - headR * 2.1, headR * 2.5, headR * 3.2, headR);
      ctx.fill();
      if (p.arms && energy > 0.3) {
        ctx.strokeStyle = 'rgba(4,3,9,.92)';
        ctx.lineWidth = headR * 0.55;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - headR * 1.1, y - headR * 1.6);
        ctx.lineTo(p.x - headR * 2.0, y - headR * 4.2 - bob);
        ctx.moveTo(p.x + headR * 1.1, y - headR * 1.6);
        ctx.lineTo(p.x + headR * 2.0, y - headR * 4.0 + bob);
        ctx.stroke();
        ctx.fillStyle = 'rgba(4,3,9,.92)';
      }
    });
  }

  return {
    ROSTER: ROSTER,
    get: get,
    randomFree: randomFree,
    drawCharacter: drawCharacter,
    drawPortrait: drawPortrait,
    drawStage: drawStage,
    helpers: { shade: shade, alpha: alpha, rrect: rrect, ellipse: ellipse }
  };
});
