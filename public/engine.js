/* =========================================================================
   RHYTHM ARENA — engine.js
   Núcleo puro (sin DOM): análisis de audio por FFT multibanda, estimación de
   tempo, generación de beatmap, ventanas de juicio y puntuación.
   Se usa igual en el navegador (window.RA) y en Node (require) para auditar.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANES = 4;              // carriles por defecto (Fácil / Normal)
  var MAX_LANES = 6;

  var DIFFICULTIES = {
    easy:   { key: 'easy',   label: 'Fácil',   lanes: 4, approach: 2.15, minGap: 0.300, sensitivity: 1.72, maxNPS: 2.6, chords: false, subdiv: 2 },
    normal: { key: 'normal', label: 'Normal',  lanes: 4, approach: 1.65, minGap: 0.225, sensitivity: 1.60, maxNPS: 4.0, chords: false, subdiv: 4 },
    hard:   { key: 'hard',   label: 'Difícil', lanes: 5, approach: 1.22, minGap: 0.150, sensitivity: 1.40, maxNPS: 6.6, chords: true,  subdiv: 4 },
    expert: { key: 'expert', label: 'Experto', lanes: 6, approach: 0.95, minGap: 0.105, sensitivity: 1.26, maxNPS: 9.6, chords: true,  subdiv: 8 }
  };

  function lanesFor(difficulty) {
    var cfg = DIFFICULTIES[difficulty];
    return cfg ? cfg.lanes : LANES;
  }

  var JUDGEMENTS = [
    { name: 'PERFECT', window: 0.055, base: 100, color: '#00e5ff', key: 'perfect' },
    { name: 'GREAT',   window: 0.100, base: 70,  color: '#7cff4d', key: 'great' },
    { name: 'GOOD',    window: 0.155, base: 40,  color: '#ffd400', key: 'good' }
  ];
  var MISS_WINDOW = 0.190;

  /* Sistema de vida: se pierde al fallar y se recupera al acertar. */
  var HEALTH = {
    max: 100,
    start: 100,
    easy:   { miss: 6.0,  perfect: 2.6, great: 2.1, good: 1.3 },
    normal: { miss: 8.0,  perfect: 2.2, great: 1.8, good: 1.0 },
    hard:   { miss: 9.5,  perfect: 2.0, great: 1.6, good: 0.9 },
    expert: { miss: 11.0, perfect: 1.8, great: 1.4, good: 0.8 }
  };

  /**
   * healthAfter(vidaActual, juicio|null, dificultad)
   * juicio null = nota fallada. Devuelve la vida resultante (0..100).
   */
  function healthAfter(health, judgement, difficulty) {
    var cfg = HEALTH[difficulty] || HEALTH.normal;
    var next = Number(health);
    if (!isFinite(next)) next = HEALTH.start;
    next += judgement ? (cfg[judgement.key] || 0) : -cfg.miss;
    return Math.max(0, Math.min(HEALTH.max, Math.round(next * 100) / 100));
  }

  /* ------------------------------- FFT ---------------------------------- */

  function FFT(n) {
    this.n = n;
    this.levels = Math.round(Math.log(n) / Math.LN2);
    if ((1 << this.levels) !== n) throw new Error('FFT: n debe ser potencia de 2');
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (var i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (var j = 0; j < n; j++) {
      var x = j, r = 0;
      for (var b = 0; b < this.levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[j] = r;
    }
  }

  FFT.prototype.transform = function (re, im) {
    var n = this.n, i, j, t, k;
    for (i = 0; i < n; i++) {
      j = this.rev[i];
      if (j > i) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (var size = 2; size <= n; size *= 2) {
      var half = size / 2, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = i, k = 0; j < i + half; j++, k += step) {
          var l = j + half;
          var tre = re[l] * this.cos[k] + im[l] * this.sin[k];
          var tim = -re[l] * this.sin[k] + im[l] * this.cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };

  /* --------------------------- utilidades ------------------------------- */

  function hannWindow(n) {
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }

  function downmix(audioBuffer) {
    var len = audioBuffer.length, chans = audioBuffer.numberOfChannels;
    var out = new Float32Array(len), c, i, data;
    for (c = 0; c < chans; c++) {
      data = audioBuffer.getChannelData(c);
      for (i = 0; i < len; i++) out[i] += data[i];
    }
    if (chans > 1) for (i = 0; i < len; i++) out[i] /= chans;
    return out;
  }

  function defaultYield() {
    return new Promise(function (r) {
      if (typeof setImmediate === 'function') setImmediate(r);
      else setTimeout(r, 0);
    });
  }

  /* Bandas de frecuencia -> carriles (grave = carril 0, agudo = último carril).
     Se reparten en escala logarítmica para cualquier número de carriles (4, 5 o 6). */
  function bandEdges(sampleRate, fftSize, laneCount) {
    var lanes = Math.max(2, Math.min(MAX_LANES, laneCount || LANES));
    var hzPerBin = sampleRate / fftSize;
    var fMin = 25;
    var fMax = Math.min(14000, sampleRate / 2 - 1);
    var ratio = Math.pow(fMax / fMin, 1 / lanes);
    var bands = [];
    for (var i = 0; i < lanes; i++) {
      var lo = fMin * Math.pow(ratio, i);
      var hi = fMin * Math.pow(ratio, i + 1);
      var loBin = Math.max(1, Math.floor(lo / hzPerBin));
      var hiBin = Math.max(loBin + 1, Math.min(fftSize / 2 - 1, Math.ceil(hi / hzPerBin)));
      bands.push({ lo: loBin, hi: hiBin });
    }
    return bands;
  }

  /* Detección de picos con umbral adaptativo sobre media local */
  function pickPeaks(flux, framesPerSec, sensitivity, minGapSec, neighbourFrames) {
    var n = flux.length;
    var prefix = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) prefix[i + 1] = prefix[i] + flux[i];
    var win = Math.max(3, Math.round(framesPerSec * 0.6));
    var nb = neighbourFrames || 2;
    var minGapFrames = Math.max(1, Math.round(minGapSec * framesPerSec));
    var peaks = [];
    var lastIndex = -1e9;
    var globalMean = prefix[n] / Math.max(1, n);
    for (i = nb; i < n - nb; i++) {
      var v = flux[i];
      if (v <= globalMean * 0.35 || v <= 1e-7) continue;
      var isPeak = true;
      for (var k = -nb; k <= nb; k++) {
        if (k !== 0 && flux[i + k] > v) { isPeak = false; break; }
      }
      if (!isPeak) continue;
      var a = Math.max(0, i - win), b = Math.min(n, i + win);
      var mean = (prefix[b] - prefix[a]) / (b - a);
      if (v <= mean * sensitivity) continue;
      if (i - lastIndex < minGapFrames) {
        var prev = peaks[peaks.length - 1];
        if (prev && v > prev.strength) { prev.index = i; prev.strength = v - mean; lastIndex = i; }
        continue;
      }
      peaks.push({ index: i, strength: v - mean });
      lastIndex = i;
    }
    return peaks;
  }

  /* Estimación de tempo por autocorrelación de la envolvente de onsets */
  function estimateTempo(envelope, framesPerSec) {
    var n = envelope.length;
    if (n < framesPerSec * 6) return { bpm: 0, confidence: 0 };
    var mean = 0, i;
    for (i = 0; i < n; i++) mean += envelope[i];
    mean /= n;
    var x = new Float64Array(n);
    for (i = 0; i < n; i++) x[i] = Math.max(0, envelope[i] - mean);

    var minLag = Math.floor((60 / 200) * framesPerSec);
    var maxLag = Math.ceil((60 / 60) * framesPerSec);
    var best = { lag: 0, value: 0 }, total = 0, count = 0;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var sum = 0;
      for (i = 0; i + lag < n; i++) sum += x[i] * x[i + lag];
      sum /= (n - lag);
      total += sum; count++;
      if (sum > best.value) { best.value = sum; best.lag = lag; }
    }
    if (!best.lag) return { bpm: 0, confidence: 0 };
    var avg = total / Math.max(1, count);
    var bpm = (60 * framesPerSec) / best.lag;
    while (bpm < 85) bpm *= 2;
    while (bpm > 190) bpm /= 2;
    return { bpm: Math.round(bpm * 10) / 10, confidence: avg > 0 ? Math.min(1, best.value / (avg * 2.2)) : 0 };
  }

  /* Cuantización opcional a la rejilla de tempo (mejora la sensación rítmica) */
  function snapToGrid(events, bpm, subdiv, tolerance) {
    if (!bpm || !events.length) return { events: events, snapped: 0 };
    var step = 60 / bpm / subdiv;
    var bestPhase = 0, bestHits = -1;
    for (var p = 0; p < 48; p++) {
      var phase = (step * p) / 48, hits = 0;
      for (var i = 0; i < events.length; i++) {
        var d = Math.abs(events[i].t - phase - Math.round((events[i].t - phase) / step) * step);
        if (d <= tolerance) hits++;
      }
      if (hits > bestHits) { bestHits = hits; bestPhase = phase; }
    }
    if (bestHits < events.length * 0.45) return { events: events, snapped: 0 };
    var snapped = 0;
    for (var j = 0; j < events.length; j++) {
      var target = bestPhase + Math.round((events[j].t - bestPhase) / step) * step;
      if (Math.abs(events[j].t - target) <= tolerance && target > 0) {
        events[j].t = Math.round(target * 1000) / 1000;
        snapped++;
      }
    }
    events.sort(function (a, b) { return a.t - b.t; });
    return { events: events, snapped: snapped };
  }

  /* --------------------------- ANALIZADOR ------------------------------- */
  /**
   * analyze(pcm|AudioBuffer, sampleRate, difficulty, opts)
   * -> Promise<{ notes:[{t,lane}], duration, bpm, confidence, stats }>
   */
  function analyze(input, sampleRate, difficulty, opts) {
    opts = opts || {};
    var yieldFn = opts.yieldFn || defaultYield;
    var onProgress = opts.onProgress || function () {};
    var pcm, sr;

    if (input && typeof input.getChannelData === 'function') {
      pcm = downmix(input);
      sr = input.sampleRate;
    } else {
      pcm = input;
      sr = sampleRate;
    }

    var cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    var N = 1024, HOP = 512;
    var duration = pcm.length / sr;
    var frames = Math.floor((pcm.length - N) / HOP) + 1;

    if (!(frames > 4)) {
      return Promise.resolve({
        notes: [], lanes: (cfg.lanes || LANES), duration: duration, bpm: 0, confidence: 0,
        stats: { frames: 0, candidates: 0 }
      });
    }

    var fft = new FFT(N);
    var win = hannWindow(N);
    var lanes = cfg.lanes || LANES;
    var bands = bandEdges(sr, N, lanes);
    var framesPerSec = sr / HOP;

    var re = new Float64Array(N), im = new Float64Array(N);
    var mag = new Float32Array(N / 2), prevMag = new Float32Array(N / 2);
    var flux = [];
    for (var b = 0; b < lanes; b++) flux.push(new Float32Array(frames));
    var envelope = new Float32Array(frames);

    var f = 0;
    function processChunk() {
      var end = Math.min(frames, f + 512);
      for (; f < end; f++) {
        var off = f * HOP, i, k;
        for (i = 0; i < N; i++) { re[i] = pcm[off + i] * win[i]; im[i] = 0; }
        fft.transform(re, im);
        for (i = 0; i < N / 2; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
        var totalFlux = 0;
        for (k = 0; k < lanes; k++) {
          var band = bands[k], sum = 0;
          for (i = band.lo; i <= band.hi; i++) {
            var d = mag[i] - prevMag[i];
            if (d > 0) sum += d;
          }
          sum /= (band.hi - band.lo + 1);
          flux[k][f] = sum;
          totalFlux += sum;
        }
        envelope[f] = totalFlux;
        var tmp = prevMag; prevMag = mag; mag = tmp;
      }
      onProgress(0.05 + 0.7 * (f / frames));
    }

    return (function run() {
      if (f < frames) {
        processChunk();
        return yieldFn().then(run);
      }
      return Promise.resolve();
    })().then(function () {
      onProgress(0.8);
      return yieldFn();
    }).then(function () {
      /* Picos por banda -> eventos con carril */
      var events = [];
      for (var k = 0; k < lanes; k++) {
        var peaks = pickPeaks(flux[k], framesPerSec, cfg.sensitivity, cfg.minGap * 1.7, 2);
        for (var i = 0; i < peaks.length; i++) {
          events.push({
            t: (peaks[i].index * HOP + HOP * 0.5) / sr,
            lane: k,
            strength: peaks[i].strength
          });
        }
      }
      events.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
      var candidates = events.length;

      var tempo = estimateTempo(envelope, framesPerSec);
      if (tempo.bpm && tempo.confidence > 0.25) {
        snapToGrid(events, tempo.bpm, cfg.subdiv, Math.min(0.05, (60 / tempo.bpm / cfg.subdiv) * 0.4));
      }

      onProgress(0.9);

      /* Separación mínima global + acordes controlados */
      var kept = [];
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        var last = kept[kept.length - 1];
        if (!last) { kept.push(ev); continue; }
        var dt = ev.t - last.t;
        if (dt < 0.018 && cfg.chords && ev.lane !== last.lane && !last.chorded) {
          ev.t = last.t;
          ev.chorded = true;
          last.chorded = true;
          kept.push(ev);
          continue;
        }
        if (dt < cfg.minGap) {
          if (ev.strength > last.strength * 1.6) kept[kept.length - 1] = ev;
          continue;
        }
        kept.push(ev);
      }

      /* Límite de densidad (notas por segundo según dificultad) */
      var maxNotes = Math.max(8, Math.floor(duration * cfg.maxNPS));
      if (kept.length > maxNotes) {
        kept = kept.slice().sort(function (a, b) { return b.strength - a.strength; }).slice(0, maxNotes);
        kept.sort(function (a, b) { return a.t - b.t; });
      }

      /* Evita 3+ notas seguidas en el mismo carril */
      var run = 0, lastLane = -1;
      for (var n = 0; n < kept.length; n++) {
        if (kept[n].lane === lastLane) {
          run++;
          if (run >= 2) {
            kept[n].lane = (kept[n].lane + (n % 2 ? 1 : lanes - 1)) % lanes;
            run = 0;
          }
        } else run = 0;
        lastLane = kept[n].lane;
      }

      /* Pasada final: separación mínima garantizada y acordes de 2 notas máx. */
      var notes = [];
      var chordSize = 0;
      kept
        .filter(function (x) { return x.t > 0.25 && x.t < duration - 0.05; })
        .map(function (x) { return { t: Math.round(x.t * 1000) / 1000, lane: x.lane }; })
        .forEach(function (n) {
          if (!notes.length) { notes.push(n); chordSize = 1; return; }
          var prev = notes[notes.length - 1];
          var dt = n.t - prev.t;
          if (dt <= 0.001) {
            if (cfg.chords && chordSize < 2 && n.lane !== prev.lane) { notes.push(n); chordSize++; }
            return;
          }
          if (dt + 1e-9 >= cfg.minGap) { notes.push(n); chordSize = 1; }
        });

      onProgress(1);
      return {
        notes: notes,
        lanes: lanes,
        duration: duration,
        bpm: tempo.bpm,
        confidence: Math.round(tempo.confidence * 100) / 100,
        stats: { frames: frames, candidates: candidates, kept: notes.length }
      };
    });
  }

  /* ------------------------- JUICIO Y PUNTUACIÓN ------------------------ */

  function judgeDelta(delta) {
    var d = Math.abs(delta);
    for (var i = 0; i < JUDGEMENTS.length; i++) {
      if (d <= JUDGEMENTS[i].window) return JUDGEMENTS[i];
    }
    return null;
  }

  function multiplier(combo) {
    return 1 + Math.min(3, Math.floor(combo / 10));
  }

  function scoreFor(base, comboBeforeHit) {
    return Math.round(base * multiplier(comboBeforeHit + 1));
  }

  function accuracy(hits, misses) {
    var total = hits + misses;
    return total ? Math.round((hits / total) * 1000) / 10 : 100;
  }

  /* Ranking: los eliminados (sin vida) quedan siempre por debajo de quien terminó. */
  function rank(players) {
    var list = players.slice().sort(function (a, b) {
      return ((a.dead ? 1 : 0) - (b.dead ? 1 : 0)) ||
        (b.score - a.score) || (b.maxCombo - a.maxCombo) || (a.misses - b.misses);
    });
    list.forEach(function (p, i) { p.position = i + 1; });
    return list;
  }

  return {
    LANES: LANES,
    MAX_LANES: MAX_LANES,
    lanesFor: lanesFor,
    DIFFICULTIES: DIFFICULTIES,
    JUDGEMENTS: JUDGEMENTS,
    MISS_WINDOW: MISS_WINDOW,
    FFT: FFT,
    analyze: analyze,
    estimateTempo: estimateTempo,
    HEALTH: HEALTH,
    healthAfter: healthAfter,
    judgeDelta: judgeDelta,
    multiplier: multiplier,
    scoreFor: scoreFor,
    accuracy: accuracy,
    rank: rank
  };
});
