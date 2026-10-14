(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var st = null, offset = 0, lastAct = 0, COOLDOWN = 20000, started = false;
  try { lastAct = Number(localStorage.getItem('lastAct')) || 0; } catch (e) {}
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
     AUDIO — synthé chiptune (pulse / triangle / bruit) en Web Audio
     ===================================================================== */
  var Audio8 = (function () {
    var ctx = null, master, music, sfx, noiseBuf, waves = {}, muted = false, timer = null;
    try { muted = localStorage.getItem('muted') === '1'; } catch (e) {}
    var NOTE = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };
    function midi(n) { var m = /^([A-G]#?)(\d)$/.exec(n); return 12 * (+m[2] + 1) + NOTE[m[1]]; }
    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    function init() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
      music = ctx.createGain(); music.gain.value = 0.3; music.connect(master);
      sfx = ctx.createGain(); sfx.gain.value = 0.5; sfx.connect(master);
      [0.125, 0.25, 0.5].forEach(function (d) {
        var n = 48, re = new Float32Array(n), im = new Float32Array(n);
        for (var i = 1; i < n; i++) re[i] = 2 / (i * Math.PI) * Math.sin(i * Math.PI * d);
        waves[d] = ctx.createPeriodicWave(re, im);
      });
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }

    function tone(dest, wave, f, t, dur, vol, o) {
      o = o || {};
      var osc = ctx.createOscillator(), g = ctx.createGain();
      if (typeof wave === 'number') osc.setPeriodicWave(waves[wave]); else osc.type = wave;
      osc.frequency.setValueAtTime(f, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
      if (o.vib && dur > 0.25) {
        var l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = 6;
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.22);
        l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05);
      }
      var sus = o.decay != null ? o.decay : 0.7;
      var a = t + 0.005, b = t + Math.min(0.08, dur * 0.5), c = Math.max(b, t + dur * 0.85);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, a);
      g.gain.linearRampToValueAtTime(vol * sus, b);
      g.gain.setValueAtTime(vol * sus, c);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.02);
    }
    function noise(dest, t, dur, vol, type, freq) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.01);
    }

    // --- Morceaux originaux : 16 pas par mesure, "-" = tenue, "." = silence ---
    // Un morceau par stade d'évolution, plus un requiem. Les 4 thèmes suivent le même arrangement « epic » :
    // thème principal, puis break (sans batterie), montée en pression (roulement + souffle), silence… et BIM.
    var CH = {
      C:['C','E','G'], Am:['A','C','E'], F:['F','A','C'], G:['G','B','D'], Em:['E','G','B'], E:['E','G#','B'],
      Dm:['D','F','A'], D:['D','F#','A'], B:['B','D#','F#'], A:['A','C#','E'], Bb:['A#','D','F'], Gm:['G','A#','D']
    };
    function bars(a) { return a.map(function (s) { return s.split(' '); }); }
    var SONGS = {
      // Bébé : ritournelle sautillante en do majeur, refrain accrocheur + pont
      bebe: {
        bpm: 138, style: 'epic', echo: true,
        brkChords: ['F','G','Em','Am','F','G','G','G'],
        brk: bars([
          'A4 - - - - - - - C5 - - - - - - -',
          'B4 - - - - - - - D5 - - - - - - -',
          'G4 - - - - - - - B4 - - - - - - -',
          'C5 - - - - - - - E5 - - - - - - -',
          'F4 - A4 - C5 - F5 - F4 - A4 - C5 - F5 -',
          'G4 - B4 - D5 - G5 - G4 - B4 - D5 - G5 -',
          'G4 B4 D5 G5 G4 B4 D5 G5 B4 D5 G5 B5 B4 D5 G5 B5',
          'D5 D#5 E5 F5 F#5 G5 G#5 A5 A#5 B5 C6 - . . . .'
        ]),
        chords: ['C','Am','F','G','C','Am','F','G', 'F','G','Em','Am','F','G','C','C'],
        mel: bars([
          'C5 . E5 G5 . E5 C6 - G5 . E5 . D5 E5 C5 .',
          'A4 . C5 E5 . C5 A5 - G5 . E5 . C5 D5 E5 .',
          'F5 . A5 C6 . A5 F5 . G5 . A5 . C6 - A5 .',
          'G5 - - - B5 . D6 . B5 . G5 . A5 . B5 .',
          'C5 . E5 G5 . E5 C6 - G5 . E5 . D5 E5 C5 .',
          'A4 . C5 E5 . C5 A5 - G5 . E5 . C5 D5 E5 .',
          'F5 . A5 C6 . D6 C6 . A5 . G5 . F5 . A5 .',
          'G5 . B5 D6 . F6 E6 - D6 . B5 . C6 - - -',
          'A5 - A5 . C6 . A5 . F5 . A5 . C6 . F6 .',
          'G6 - - - F6 . D6 . B5 . D6 . G5 - - -',
          'E6 . D6 . B5 . G5 . E5 . G5 . B5 . E6 .',
          'C6 - B5 . A5 - - - E5 . A5 . C6 . E6 .',
          'F6 . E6 . C6 . A5 . F6 . E6 . C6 . A5 .',
          'D6 . C6 . B5 . G5 . D6 - E6 - F6 - D6 -',
          'E6 - - - G6 - - - E6 . C6 . D6 . E6 .',
          'C6 - - - - - - - G5 . E5 . G5 . B5 .'
        ])
      },
      // Junior : course en forêt, mi mineur
      junior: {
        bpm: 140, style: 'epic',
        brkChords: ['C','D','Em','Em','C','D','B','B'],
        brk: bars([
          'G4 - - - - - - - E5 - - - - - - -',
          'A4 - - - - - - - F#5 - - - - - - -',
          'B4 - - - - - - - G5 - - - - - - -',
          'E5 - - - - - - - - - - - - - - -',
          'G4 - C5 - E5 - G5 - G4 - C5 - E5 - G5 -',
          'A4 - D5 - F#5 - A5 - A4 - D5 - F#5 - A5 -',
          'B4 D#5 F#5 B5 B4 D#5 F#5 B5 D#5 F#5 B5 D#6 D#5 F#5 B5 D#6',
          'F#5 G5 G#5 A5 A#5 B5 C6 C#6 D6 D#6 E6 - . . . .'
        ]),
        chords: ['Em','C','D','Em','C','D','B','B'],
        mel: bars([
          'E5 - B4 - E5 - G5 - F#5 - E5 - D5 - B4 -',
          'C5 - - - E5 - G5 - - - E5 - C5 - - -',
          'D5 - F#5 - A5 - - - G5 - F#5 - E5 - D5 -',
          'E5 - - - - - - - B5 - A5 - G5 - F#5 -',
          'G5 - E5 - G5 - C6 - B5 - G5 - E5 - G5 -',
          'A5 - F#5 - A5 - D6 - C6 - A5 - F#5 - A5 -',
          'B5 - - - A5 - - - G5 - - - F#5 - - -',
          'D#5 - - - F#5 - - - B5 - - - . . . .'
        ])
      },
      // Adulte : thème héroïque, la mineur
      adulte: {
        bpm: 148, style: 'epic',
        brkChords: ['F','G','Am','Am','F','G','E','E'],
        brk: bars([
          'C5 - - - - - - - A4 - - - - - - -',
          'D5 - - - - - - - B4 - - - - - - -',
          'E5 - - - - - - - C5 - - - - - - -',
          'A5 - - - - - - - - - - - - - - -',
          'A4 - C5 - F5 - A5 - A4 - C5 - F5 - A5 -',
          'B4 - D5 - G5 - B5 - B4 - D5 - G5 - B5 -',
          'E5 G#5 B5 E6 E5 G#5 B5 E6 G#5 B5 E6 G#6 G#5 B5 E6 G#6',
          'B5 C6 C#6 D6 D#6 E6 F6 F#6 G6 G#6 A6 - . . . .'
        ]),
        chords: ['Am','F','G','Em','Am','F','G','E', 'F','G','Em','Am','F','G','E','E'],
        mel: bars([
          'A4 - C5 - E5 - A5 - G5 - E5 - C5 - D5 -',
          'E5 - - - C5 - A4 - F5 - E5 - C5 - A4 -',
          'B4 - D5 - G5 - - - F5 - E5 - D5 - B4 -',
          'E5 - - - - - - - G5 - F#5 - E5 - D5 -',
          'C5 - E5 - A5 - - - B5 - A5 - G5 - E5 -',
          'F5 - - - A5 - - - C6 - B5 - A5 - F5 -',
          'G5 - - - D5 - G5 - B5 - A5 - G5 - D5 -',
          'E5 - - - - - - - G#5 - - - B5 - - -',
          'A5 . A5 . C6 - A5 - G5 - F5 - E5 - C5 -',
          'D5 - G5 - B5 - D6 - C6 - B5 - G5 - D5 -',
          'E5 . E5 . G5 - B5 - E6 - - - D6 - B5 -',
          'C6 - B5 - A5 - - - E5 - - - A5 - - -',
          'F5 - A5 - C6 - F6 - E6 - C6 - A5 - C6 -',
          'D6 - B5 - G5 - B5 - D6 - - - G6 - - -',
          'G#5 - B5 - E6 - - - D6 - B5 - G#5 - E5 -',
          'B5 - - - - - - - . . . . E5 . G#5 .'
        ])
      },
      // Légende : thème épique, ré mineur, basse au galop et lead doublé
      legende: {
        bpm: 160, style: 'epic',
        brkChords: ['Bb','C','Dm','Dm','Bb','C','A','A'],
        brk: bars([
          'D5 - - - - - - - F5 - - - - - - -',
          'E5 - - - - - - - G5 - - - - - - -',
          'F5 - - - - - - - A5 - - - - - - -',
          'A5 - - - - - - - - - - - - - - -',
          'D5 - F5 - A#5 - D6 - D5 - F5 - A#5 - D6 -',
          'E5 - G5 - C6 - E6 - E5 - G5 - C6 - E6 -',
          'A5 C#6 E6 A6 A5 C#6 E6 A6 C#6 E6 A6 C#7 C#6 E6 A6 C#7',
          'E6 F6 F#6 G6 G#6 A6 A#6 B6 C7 C#7 D7 - . . . .'
        ]),
        chords: ['Dm','Bb','C','A','Dm','Bb','Gm','A'],
        mel: bars([
          'D5 - - - A5 - - - D6 - C6 - A5 - F5 -',
          'A#5 - - - - - - - A5 - G5 - F5 - G5 -',
          'E5 - G5 - C6 - - - E6 - D6 - C6 - G5 -',
          'C#6 - - - - - - - E6 - - - A5 - - -',
          'F6 - E6 - D6 - A5 - F5 - A5 - D6 - F6 -',
          'D6 - - - A#5 - - - F5 - - - A#5 - D6 -',
          'G5 - A#5 - D6 - G6 - F6 - E6 - D6 - A#5 -',
          'A5 - C#6 - E6 - A6 - - - - - . . . .'
        ])
      },
      dead: {
        bpm: 72, style: 'dead',
        chords: ['Am','Dm','E','Am'],
        mel: bars([
          'A4 - - - C5 - - - B4 - - - A4 - - -',
          'F4 - - - A4 - - - D5 - - - C5 - - -',
          'B4 - - - G#4 - - - E4 - - - - - - -',
          'A4 - - - - - - - . . . . . . . .'
        ])
      }
    };

    var cur = null, fast = false, step = 0, next = 0;
    function bpmOf(song) { return song.bpm * (fast && song.style !== 'dead' ? 1.18 : 1); }
    // Souffle de bruit filtré qui monte pendant la montée en pression
    function riser(t, dur) {
      var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g2 = ctx.createGain();
      src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.Q.value = 2.5;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
      g2.gain.setValueAtTime(0.001, t); g2.gain.exponentialRampToValueAtTime(0.32, t + dur); g2.gain.linearRampToValueAtTime(0.0001, t + dur + 0.03);
      src.connect(f); f.connect(g2); g2.connect(music); src.start(t); src.stop(t + dur + 0.06);
    }
    // Position dans la structure : thème (joué 1 ou 2 fois selon sa longueur), break (4 mesures), montée (4 mesures)
    function songPos(song, n) {
      var main = song.mel.length, reps = song.brk ? (main <= 8 ? 2 : 1) : 1, total = main * reps + (song.brk ? song.brk.length : 0);
      var b = Math.floor(n / 16) % total;
      if (b < main * reps) return { part: 'main', bar: song.mel[b % main], chord: song.chords[b % main], k: b % main, abs: b };
      var k = b - main * reps;
      return { part: k < 4 ? 'break' : 'build', bar: song.brk[k], chord: song.brkChords[k], k: k, abs: b };
    }
    function scheduleStep(song, n, t) {
      var sd = 60 / bpmOf(song) / 4, s = n % 16, p = songPos(song, n), bar = p.bar, tok = bar[s];
      var chord = CH[p.chord], root = midi(chord[0] + '2');
      var len = 1, f = 0, dur = 0;
      if (tok !== '-' && tok !== '.') { while (s + len < 16 && bar[s + len] === '-') len++; f = hz(midi(tok)); dur = len * sd * 0.92; }

      if (song.style === 'dead') {
        if (f) tone(music, 0.25, f, t, dur, 0.2, { vib: true, decay: 0.75 });
        if (s === 0) tone(music, 'triangle', hz(root), t, sd * 15.5, 0.45, { decay: 0.8 });
        if (s % 4 === 0) tone(music, 0.125, hz(midi(chord[(s / 4) % 3] + '4')), t, sd * 3, 0.07, { decay: 0.6 });
        return;
      }

      if (p.part === 'break') {
        // Respiration : pas de batterie, basse tenue, arpèges doux, mélodie aérienne
        if (f) tone(music, 0.25, f, t, dur, 0.15, { vib: true, decay: 0.85 });
        if (s === 0) tone(music, 'triangle', hz(root), t, sd * 15.5, 0.4, { decay: 0.85 });
        if (s % 2 === 0) tone(music, 0.125, hz(midi(chord[(s / 2) % 3] + '5')), t, sd * 1.8, 0.04, { decay: 0.4 });
        return;
      }

      if (p.part === 'build') {
        // Montée en pression : mélodie qui grimpe, roulement de plus en plus serré, souffle, puis un temps de silence
        var prog = (p.k - 4 + s / 16) / 4, silent = p.k === 7 && s >= 12;
        if (f) { tone(music, 0.25, f, t, dur, 0.13 + prog * 0.1, { decay: 0.8 }); tone(music, 0.5, f / 2, t, dur, 0.05 + prog * 0.05, { decay: 0.8 }); }
        if (p.k === 4 && s === 0) riser(t, sd * 60);
        if (!silent) {
          if (s % 2 === 0) tone(music, 'triangle', hz(root), t, sd * 1.6, 0.3 + prog * 0.2, { decay: 0.9 });
          tone(music, 0.125, hz(midi(chord[s % 3] + '5')), t, sd * 0.8, 0.03 + prog * 0.04, { decay: 0.5 });
          var every = p.k === 4 ? 4 : p.k === 5 ? 2 : 1;
          if (s % every === 0) { noise(music, t, 0.08, 0.12 + prog * 0.35, 'bandpass', 1500 + prog * 2000); tone(music, 'triangle', 180 + prog * 220, t, 0.05, 0.12 + prog * 0.15, { decay: 1 }); }
          if (p.k >= 6 && s % 4 === 0) tone(music, 'sine', 150, t, 0.12, 0.5 + prog * 0.3, { slide: 45, decay: 1 });
        }
        return;
      }

      // Thème principal, à fond
      if (f) {
        tone(music, 0.25, f, t, dur, 0.22, { vib: true, decay: 0.75 });
        tone(music, 0.5, f / 2, t, dur, 0.09, { decay: 0.8 });
        if (song.echo) tone(music, 0.125, f, t + sd * 3, Math.min(dur, sd * 2), 0.05, { decay: 0.5 });
      }
      if (s % 4 !== 1) tone(music, 'triangle', hz(root + (s % 4 === 2 ? 12 : 0)), t, sd * 0.9, 0.55, { decay: 0.9 });
      tone(music, 0.125, hz(midi(chord[s % 3] + '5')), t, sd * 0.9, 0.05, { decay: 0.5 });
      if (s % 4 === 0) tone(music, 'sine', 150, t, 0.15, 0.95, { slide: 45, decay: 1 });
      if (s === 0 && p.abs === 0) { noise(music, t, 1.6, 0.4, 'highpass', 3000); tone(music, 'sine', 110, t, 0.6, 1, { slide: 30, decay: 1 }); } // BIM
      else if (s === 0 && p.abs % 4 === 0) noise(music, t, 0.9, 0.22, 'highpass', 5000);
      var fill = p.k % 4 === 3 && s >= 12;
      if (s === 4 || s === 12 || fill) { noise(music, t, 0.13, 0.42, 'bandpass', 1800); tone(music, 'triangle', 200, t, 0.08, 0.3, { slide: 120 }); }
      else if (s % 2 === 0) noise(music, t, s === 14 ? 0.12 : 0.035, 0.16, 'highpass', 7000);
    }
    function pump() {
      if (!ctx || !cur || ctx.state !== 'running') return;
      var song = SONGS[cur];
      if (next < ctx.currentTime - 0.05) next = ctx.currentTime + 0.05;
      while (next < ctx.currentTime + 0.15) { scheduleStep(song, step, next); next += 60 / bpmOf(song) / 4; step++; }
    }
    // Change de morceau ; "isFast" accélère le morceau en cours sans le relancer
    function play(name, isFast) {
      init(); if (!ctx) return;
      fast = !!isFast;
      if (cur === name) return;
      cur = name; step = 0; next = ctx.currentTime + 0.08;
      if (!timer) timer = setInterval(pump, 25);
    }

    var FX = {
      start: function (t) { tone(sfx, 0.5, hz(83), t, 0.08, 0.3); tone(sfx, 0.5, hz(88), t + 0.08, 0.4, 0.3, { decay: 0.6 }); },
      feed: function (t) { [72, 76, 79, 84].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.05, 0.06, 0.3); }); },
      chomp: function (t) { noise(sfx, t, 0.07, 0.35, 'lowpass', 1300); noise(sfx, t + 0.13, 0.07, 0.3, 'lowpass', 1000); },
      pet: function (t) { [88, 95, 100, 95, 100, 107].forEach(function (m, i) { tone(sfx, 0.125, hz(m), t + i * 0.045, 0.05, 0.2); }); },
      jump: function (t) { tone(sfx, 0.5, 280, t, 0.16, 0.16, { slide: 900, decay: 1 }); },
      deny: function (t) { tone(sfx, 0.5, 110, t, 0.09, 0.3, { decay: 1 }); tone(sfx, 0.5, 98, t + 0.12, 0.14, 0.3, { decay: 1 }); },
      wash: function (t) { for (var i = 0; i < 7; i++) tone(sfx, 'sine', hz(76 + (i * 5) % 12), t + i * 0.06, 0.07, 0.2, { slide: hz(88 + (i * 5) % 12), decay: 0.8 }); noise(sfx, t, 0.5, 0.12, 'bandpass', 3000); },
      play: function (t) { [72, 76, 79, 84, 79, 84, 88].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.055, 0.06, 0.25); }); },
      rock: function (t) { [79, 76, 72, 67].forEach(function (m, i) { tone(sfx, 'triangle', hz(m), t + i * 0.18, 0.22, 0.35, { decay: 0.6 }); }); },
      buy: function (t) { [84, 88, 91, 96].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.06, 0.08, 0.25); }); noise(sfx, t + 0.24, 0.25, 0.2, 'highpass', 6000); },
      car: function (t) {
        tone(sfx, 0.5, hz(69), t, 0.12, 0.22, { decay: 1 }); tone(sfx, 0.5, hz(69), t + 0.18, 0.16, 0.22, { decay: 1 }); // pouet pouet
        tone(sfx, 0.5, 55, t + 0.4, 1.7, 0.12, { slide: 170, decay: 1 }); noise(sfx, t + 0.4, 1.7, 0.1, 'lowpass', 500);
      },
      fly: function (t) { tone(sfx, 'triangle', 110, t, 1.8, 0.22, { slide: 900, decay: 1 }); noise(sfx, t, 1.9, 0.28, 'lowpass', 900); },
      land: function (t) { noise(sfx, t, 0.25, 0.35, 'lowpass', 400); tone(sfx, 'sine', 120, t, 0.15, 0.6, { slide: 40, decay: 1 }); },
      bonus: function (t) { [84, 88, 91, 96, 100, 103].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.045, 0.06, 0.25); }); tone(sfx, 0.125, hz(108), t + 0.27, 0.3, 0.15, { vib: true }); },
      like: function (t) { [76, 81, 84, 88, 93].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.05, 0.08, 0.22); }); tone(sfx, 'triangle', hz(100), t + 0.25, 0.3, 0.2, { vib: true }); },
      ach: function (t) { [72, 76, 79, 84].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.09, 0.09, 0.26); }); tone(sfx, 0.25, hz(88), t + 0.36, 0.5, 0.28, { vib: true }); tone(sfx, 0.5, hz(64), t + 0.36, 0.5, 0.12); },
      evo: function (t) { for (var i = 0; i < 24; i++) tone(sfx, i % 2 ? 0.25 : 0.125, hz(60 + i + (i % 2) * 12), t + i * 0.1, 0.09, 0.18); },
      hatch: function (t) { [60, 64, 67, 72, 67, 72, 76, 79].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + i * 0.08, 0.08, 0.28); }); tone(sfx, 0.25, hz(84), t + 0.64, 0.6, 0.3, { vib: true }); },
      die: function (t) { for (var i = 0; i < 16; i++) tone(sfx, 0.5, hz(86 - i * 3), t + i * 0.055, 0.055, 0.25); noise(sfx, t + 0.9, 0.7, 0.4, 'lowpass', 600); },
      blip: function (t) { tone(sfx, 0.5, hz(93), t, 0.022, 0.05, { decay: 1 }); },
      other: function (t) { tone(sfx, 0.25, hz(91), t, 0.05, 0.12); tone(sfx, 0.25, hz(96), t + 0.05, 0.08, 0.12); },
      // Rires : petit gloussement aigu (bébé), « ha ha ha » franc (milieu), rire de méchant grave avec écho (niveaux 9-10)
      laugh1: function (t) { [0, 1, 2, 3].forEach(function (i) { tone(sfx, 0.25, hz(86 - i), t + i * 0.085, 0.07, 0.16, { slide: hz(91 - i), decay: 0.8 }); }); },
      laugh2: function (t) {
        [0, 1, 2].forEach(function (i) { tone(sfx, 0.5, hz(66 - i), t + i * 0.17, 0.13, 0.2, { slide: hz(61 - i), decay: 0.8 }); noise(sfx, t + i * 0.17, 0.09, 0.05, 'bandpass', 1600); });
      },
      laugh3: function (t) {
        function syl(at, from, to, dur, v) {
          tone(sfx, 'sawtooth', hz(from), at, dur, 0.1 * v, { slide: hz(to), decay: 0.85 });
          tone(sfx, 'triangle', hz(from - 12), at, dur, 0.22 * v, { slide: hz(to - 12), decay: 0.85 });
          noise(sfx, at, dur * 0.6, 0.05 * v, 'bandpass', 900);
        }
        var seq = [[0, 50, 46, 0.32], [0.4, 48, 45, 0.15], [0.6, 47, 44, 0.15], [0.8, 46, 43, 0.15], [1.0, 45, 42, 0.15], [1.22, 48, 34, 0.75]];
        seq.forEach(function (q) { syl(t + q[0], q[1], q[2], q[3], 1); syl(t + q[0] + 0.14, q[1], q[2], q[3], 0.3); }); // + écho de caverne
      },
      sneeze: function (t) { tone(sfx, 'sine', hz(72), t, 0.35, 0.12, { slide: hz(79), decay: 1 }); noise(sfx, t + 0.42, 0.18, 0.35, 'highpass', 1800); tone(sfx, 0.5, hz(84), t + 0.42, 0.08, 0.12, { slide: hz(70) }); },
      grunt: function (t) { tone(sfx, 0.5, hz(47), t, 0.11, 0.16, { slide: hz(42), decay: 1 }); noise(sfx, t, 0.08, 0.08, 'lowpass', 700); },
      dash: function (t) { noise(sfx, t, 0.35, 0.22, 'bandpass', 1200); tone(sfx, 'triangle', hz(60), t, 0.3, 0.12, { slide: hz(84), decay: 1 }); },
      page: function (t) { noise(sfx, t, 0.06, 0.12, 'highpass', 3500); noise(sfx, t + 0.07, 0.05, 0.08, 'highpass', 5000); },
      roar: function (t) { noise(sfx, t, 0.9, 0.35, 'lowpass', 700); tone(sfx, 'sawtooth', hz(40), t, 0.9, 0.1, { slide: hz(31), decay: 0.9 }); tone(sfx, 'triangle', hz(28), t, 0.9, 0.3, { slide: hz(24), decay: 0.9 }); },
      flex: function (t) { tone(sfx, 0.25, hz(79), t, 0.06, 0.15); tone(sfx, 0.25, hz(86), t + 0.06, 0.06, 0.15); noise(sfx, t + 0.12, 0.25, 0.08, 'highpass', 6000); },
      heal: function (t) { [79, 84, 88, 91, 96].forEach(function (m, i) { tone(sfx, 'triangle', hz(m), t + i * 0.07, 0.12, 0.3); }); tone(sfx, 0.125, hz(103), t + 0.35, 0.4, 0.14, { vib: true }); }
    };
    function fx(name) { if (!ctx || muted || ctx.state !== 'running') return; FX[name](ctx.currentTime + 0.01); }
    // Toucher : les 15 premiers coups du combo montent la gamme majeure (do4 → do6, jamais trop aigu),
    // ensuite « palier max » : de petits arpèges cristallins façon jeu d'aventure, dans l'aigu, sans basse.
    // La boucle de 8 coups passe par do majeur 7, ré majeur (couleur lydienne, « magique »), si bémol, puis remonte vers do.
    var CLIMB = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
    var MAX_LOOP = [[72, 76, 79], [76, 79, 83], [74, 78, 81], [78, 81, 86], [70, 74, 77], [74, 77, 82], [72, 76, 80], [74, 79, 84]];
    function tap(combo) {
      if (!ctx || muted || ctx.state !== 'running') return;
      var t = ctx.currentTime + 0.005;
      if (combo <= CLIMB.length) {
        tone(sfx, 0.25, hz(60 + CLIMB[combo - 1]), t, 0.04, 0.1, { decay: 1 });
        if (combo === CLIMB.length) [72, 76, 79, 84].forEach(function (m, i) { tone(sfx, 0.25, hz(m), t + 0.05 + i * 0.05, 0.07, 0.16); }); // fanfare d'arrivée au max
        return;
      }
      var arp = MAX_LOOP[(combo - CLIMB.length - 1) % MAX_LOOP.length];
      arp.forEach(function (m, i) { tone(sfx, 0.125, hz(m), t + i * 0.028, 0.07, 0.09, { decay: 0.6 }); });
      tone(sfx, 'sine', hz(arp[2] + 12), t + 0.084, 0.16, 0.06, { decay: 0.5 }); // scintillement une octave au-dessus
    }
    function setMuted(m) {
      muted = m;
      try { localStorage.setItem('muted', m ? '1' : '0'); } catch (e) {}
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.02);
    }
    return {
      init: init, play: play, fx: fx, tap: tap,
      isMuted: function () { return muted; }, setMuted: setMuted,
      resume: function () { if (ctx && ctx.state === 'suspended') ctx.resume(); },
      suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); }
    };
  })();

  /* =====================================================================
     MONDE — canvas basse résolution, upscalé en pixels nets
     ===================================================================== */
  var cv = $('world'), g = cv.getContext('2d');
  var S = 3, W = 320, H = 240, groundY = 200, C = 2, mot = 1, hudBottom = 0, gameTop = 0;
  var playR = 320, playCx = 160; // zone où la créature se promène : à gauche du journal sur grand écran
  // Un décor par stade d'évolution. Palettes choisies pour contraster avec l'orange du dino
  // (bleus, violets, sarcelles) tout en restant dans une même famille de teintes par scène.
  var SCENES = [
    { // Bébé — prairie à l'aube
      kind: 'meadow',
      sky: ['#2b3a8c','#3a52a8','#5070c0','#6f92d4','#94b4e2','#bcd0ea','#ead6d0','#ffd9b0'],
      far: '#7a9ad0', farHi: '#a8c4ee', hill: '#4fae7a', hillHi: '#8fe0a0', hillDk: '#2f7a5a',
      flowers: ['#ff9ad0', '#fff2a0', '#ffffff'], cloud: '#f6f2ff', cloudDk: '#c4c8ee',
      tile: { kind: 'grass', grass: ['#5cc06a', '#a8f08a', '#2f7a4a'], dirt: ['#9a6440', '#c08458', '#6a4028'] }
    },
    { // Junior — forêt au crépuscule
      kind: 'forest',
      sky: ['#1a1238','#2c1850','#48205e','#6e2a66','#9a3a66','#c8545e','#ec7a58','#ffa860'],
      sun: '#ffcf70', far: '#3a1e52', farHi: '#6a3478', treeBack: '#2a1640', treeFront: '#170c26', fly: '#e8ff70',
      tile: { kind: 'stone', c: ['#3f8a72', '#8fdcc0', '#1a4038'] }
    },
    { // Adulte — ville néon
      kind: 'city', stars: 60,
      sky: ['#0e0a2a','#1a1048','#2a1466','#401a80','#5e2090','#842896','#ac3690','#d44c88'],
      far: '#2e1660', farHi: '#6a3aa8', city: '#170c38', win: ['#5ef2ff', '#ff6fd8', '#ffe25e'],
      tile: { kind: 'metal', c: ['#2f6fe0', '#9fd0ff', '#142e7a'] }
    },
    { // Légende — sanctuaire cosmique
      kind: 'cosmos', stars: 90, nebula: true,
      sky: ['#04020e','#0a0520','#120830','#1c0c42','#280f52','#341260'],
      planet: '#8a4ad6', planetDk: '#4a1f8a', ring: '#ffd27a', spire: '#1e0e40', spireHi: '#6a3ab0', crystal: '#5ef2ff',
      aurora: [58, 255, 176],
      tile: { kind: 'metal', c: ['#c8962a', '#ffe9a0', '#5a3a10'] }
    }
  ];
  // Décors des séjours achetés en boutique (remplacent le décor du stade le temps du séjour)
  var PLACE_SCENES = {
    montagne: {
      kind: 'mountain',
      sky: ['#1c2c66','#24407e','#30589e','#4474ba','#6094d0','#8ab4e2','#b8d4f0','#e0ecf8'],
      far: '#5a6aa0', snow: '#f4f8ff', near: '#34467a', nearHi: '#6a80b8', pine: '#1e2c50',
      tile: { kind: 'stone', c: ['#a8c8f0', '#ffffff', '#5a7ab0'], snow: true }
    },
    plage: {
      kind: 'beach', cloud: '#ffffff', cloudDk: '#cfe6f6',
      sky: ['#1f6fc8','#2d86d8','#43a0e6','#62b8f0','#86ccf4','#acdcf6','#d4ecf6','#fff0d8'],
      sea: '#1f8fcf', seaDk: '#1673b0', seaHi: '#46b0e0', palm: '#2a8a3a', palmHi: '#5cc06a', trunk: '#8a5a30',
      tile: { kind: 'sand', c: ['#f0d090', '#fff0c0', '#c8a060'] }
    },
    ville: {
      kind: 'town', cloud: '#ffffff', cloudDk: '#d4e4f4',
      sky: ['#3a7fd0','#4a90d8','#5ea2e0','#76b4e8','#90c6ee','#acd6f2','#cce6f6','#e8f2f8'],
      far: '#9ab4d8', farHi: '#b8cce8',
      tile: { kind: 'stone', c: ['#a8a8b4', '#d0d0dc', '#6a6a78'] }
    },
    espace: {
      kind: 'moon', stars: 90,
      sky: ['#000004','#03031a','#07072a','#0b0b38','#101044'],
      ridge: '#4a4a5e', ridgeHi: '#8a8aa0',
      tile: { kind: 'moon', c: ['#8a8a9a', '#b8b8c8', '#55556a'] }
    }
  };
  var scene = SCENES[2], sceneI = -1, skyCv = null, skyKey = '', tileTop = null, tileFill = null;

  // Aléatoire déterministe pour un décor stable
  var seed = 1337;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function ridge(len, ph, rough) {
    var a = [];
    for (var i = 0; i < len; i++) {
      var x = i / len * Math.PI * 2;
      a.push(0.55 + 0.25 * Math.sin(x * 3 + ph) + rough * (0.14 * Math.sin(x * 7 + ph * 2) + 0.06 * Math.sin(x * 17 + ph * 3)));
    }
    return a;
  }
  var RL = 720, ridgeA = ridge(RL, 0.7, 1), ridgeB = ridge(RL, 2.3, 0.2);
  var SPAN = 640, city = [], treesB = [], treesF = [], clouds = [], spires = [], islands = [];
  (function () {
    var x = 0, i = 0;
    while (x < SPAN) { var w = 8 + (rnd() * 16 | 0); city.push({ x: x, w: w, h: 0.25 + rnd() * 0.75, i: i++ }); x += w + (rnd() * 4 | 0); }
    for (x = 0; x < SPAN; x += 6 + rnd() * 8) treesB.push({ x: x, h: 0.45 + rnd() * 0.4 });
    for (x = 0; x < SPAN; x += 10 + rnd() * 14) treesF.push({ x: x, h: 0.3 + rnd() * 0.3 });
    for (i = 0; i < 7; i++) clouds.push({ x: rnd() * SPAN, y: 0.08 + rnd() * 0.35, w: 14 + (rnd() * 22 | 0) });
    for (x = 0; x < SPAN; x += 18 + rnd() * 30) spires.push({ x: x, w: 3 + (rnd() * 5 | 0), h: 0.2 + rnd() * 0.45 });
    for (i = 0; i < 4; i++) islands.push({ x: rnd() * SPAN, y: 0.3 + rnd() * 0.25, w: 14 + (rnd() * 14 | 0), p: rnd() * 6 });
  })();
  var stars = []; for (var i = 0; i < 90; i++) stars.push({ x: rnd(), y: rnd() * 0.75, p: rnd() * 6.28, sp: 1 + rnd() * 3, c: ['#ffffff', '#5ef2ff', '#ff9ae0', '#ffe25e'][rnd() * 4 | 0] });
  var flies = []; for (i = 0; i < 26; i++) flies.push({ x: rnd(), y: 0.45 + rnd() * 0.5, p: rnd() * 6.28 });
  var rain = []; for (i = 0; i < 70; i++) rain.push({ x: rnd(), y: rnd() });
  var meteor = { t: 3, x: 0, y: 0 };

  function resize() {
    var iw = Math.max(64, window.innerWidth), ih = Math.max(64, window.innerHeight);
    S = Math.max(2, Math.round(Math.min(ih / 260, iw / 240)));
    W = Math.ceil(iw / S); H = Math.ceil(ih / S);
    cv.width = W; cv.height = H;
    cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
    g.imageSmoothingEnabled = false;
    var bt = $('bottom').getBoundingClientRect().top, ht = Math.max($('hud').getBoundingClientRect().bottom, $('mid').getBoundingClientRect().bottom); // #mid est hors du flux sur grand écran
    groundY = Math.max(40, Math.min(H - 8, Math.floor(bt / S) - 18));
    hudBottom = Math.ceil(ht / S);
    gameTop = Math.ceil(Math.max(ht, $('sys').getBoundingClientRect().bottom) / S); // les mini-jeux commencent sous le HUD et le menu
    $('logbox').style.top = Math.ceil($('hud').getBoundingClientRect().bottom + 14) + 'px'; // le journal commence toujours sous le HUD, quelle que soit sa hauteur
    // Sur grand écran, le journal est fixé à droite : la créature reste dans l'espace libre à sa gauche
    var lb = $('logbox').getBoundingClientRect(), lbLeft = Math.floor((lb.left - 12) / S);
    playR = lb.width > 0 && lbLeft > W * 0.55 ? lbLeft : W;
    playCx = Math.round(playR / 2);
    skyKey = '';
  }

  function buildSky() {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x2 = c.getContext('2d'), sky = scene.sky, n = sky.length, bh = groundY / n, x, y;
    x2.fillStyle = sky[n - 1]; x2.fillRect(0, 0, W, H);
    for (var i = 0; i < n; i++) { x2.fillStyle = sky[i]; x2.fillRect(0, Math.floor(i * bh), W, Math.ceil(bh) + 1); }
    for (i = 1; i < n; i++) {
      y = Math.floor(i * bh);
      x2.fillStyle = sky[i];
      for (x = 0; x < W; x += 4) x2.fillRect(x + (y & 1) * 2, y - 2, 1, 1);
      for (x = (y + 1) & 1; x < W; x += 2) x2.fillRect(x, y - 1, 1, 1);
    }
    if (scene.nebula) {
      seed = 99;
      [['#c03a9a', 0.22], ['#2aa6b8', 0.62], ['#7a3ad6', 0.85]].forEach(function (nb) {
        var cx = nb[1] * W, cy = groundY * (0.2 + rnd() * 0.3), rx = W * 0.22, ry = groundY * 0.16;
        x2.fillStyle = nb[0];
        for (y = Math.floor(cy - ry); y < cy + ry; y++) for (x = Math.floor(cx - rx); x < cx + rx; x++) {
          var d = Math.pow((x - cx) / rx, 2) + Math.pow((y - cy) / ry, 2) + Math.sin(x * 0.2 + y * 0.3) * 0.15;
          var hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
          if (d < 1 && hsh % 100 < (1 - d) * 22) x2.fillRect(x, y, 1, 1);
        }
      });
    }
    skyCv = c;
    tileTop = buildTile(scene.tile, true); tileFill = buildTile(scene.tile, false);
    skyKey = sceneI + ':' + W + 'x' + H + ':' + groundY;
  }

  function buildTile(t, top) {
    var cnv = document.createElement('canvas'); cnv.width = cnv.height = 16;
    var x2 = cnv.getContext('2d'), x, c;
    function px(col, x, y, w, h) { x2.fillStyle = col; x2.fillRect(x, y, w || 1, h || 1); }
    if (t.kind === 'sand') {
      c = t.c;
      px(c[0], 0, 0, 16, 16);
      [[2, 3], [9, 6], [5, 11], [13, 13], [12, 1], [1, 8]].forEach(function (p, i) { px(i % 2 ? c[1] : c[2], p[0], p[1]); });
      if (top) { px(c[1], 0, 0, 16, 2); px('#ff9ad0', 6, 2, 2, 1); px('#ffffff', 6, 1, 2, 1); }
      return cnv;
    }
    if (t.kind === 'moon') {
      c = t.c;
      px(c[0], 0, 0, 16, 16);
      px(c[2], 3, 5, 6, 3); px(c[1], 3, 8, 6, 1); px(c[2], 11, 11, 3, 2); px(c[1], 11, 13, 3, 1); px(c[1], 13, 3, 1, 1);
      if (top) px(c[1], 0, 0, 16, 1);
      return cnv;
    }
    if (t.kind === 'grass') {
      var d = t.dirt, gr = t.grass;
      px(d[0], 0, 0, 16, 16);
      [[3, 5], [11, 9], [6, 12], [13, 3], [1, 14]].forEach(function (p) { px(d[1], p[0], p[1], 2, 1); px(d[2], p[0], p[1] + 1, 2, 1); });
      if (top) {
        px(gr[0], 0, 0, 16, 4);
        for (x = 0; x < 16; x++) if ((x * 7) % 5 < 3) px(gr[0], x, 4, 1, 1 + (x % 3 === 0 ? 1 : 0));
        for (x = 0; x < 16; x += 3) px(gr[1], x, 0);
        px(gr[2], 0, 5, 16, 0);
      }
      return cnv;
    }
    if (t.kind === 'stone') {
      c = t.c;
      px(c[2], 0, 0, 16, 16);
      [[0, 0, 9, 7], [10, 0, 6, 7], [0, 8, 4, 8], [5, 8, 11, 8]].forEach(function (b) {
        px(c[0], b[0], b[1], b[2] - 1, b[3] - 1); px(c[1], b[0], b[1], b[2] - 1, 1);
      });
      if (top) { px(c[1], 0, 0, 16, 1); px('#c8ffe8', 2, 0, 3, 1); px('#c8ffe8', 11, 0, 2, 1); }
      if (top && t.snow) { px('#ffffff', 0, 0, 16, 3); for (var sx = 0; sx < 16; sx += 5) px('#ffffff', sx, 3, 3, 1); }
      return cnv;
    }
    c = t.c;
    px(c[0], 0, 0, 16, 16);
    px(c[1], 0, 0, 16, 1); px(c[1], 0, 0, 1, 16); px(c[1], 3, 12, 10, 1); px(c[1], 12, 3, 1, 10);
    px(c[2], 0, 15, 16, 1); px(c[2], 15, 0, 1, 16); px(c[2], 3, 3, 10, 1); px(c[2], 3, 3, 1, 10);
    [[1, 1], [14, 1], [1, 14], [14, 14]].forEach(function (p) { px(c[1], p[0], p[1]); });
    if (top) { px(c[1], 0, 0, 16, 2); for (x = 0; x < 16; x += 4) px('#ffffff', x, 0, 2, 1); }
    return cnv;
  }

  // ---------- Couches de décor ----------
  function wrapX(x) { return ((x % SPAN) + SPAN) % SPAN; }
  function drawStars(n, maxY) {
    for (var i = 0; i < Math.min(n, stars.length); i++) {
      var s = stars[i], tw = Math.sin(T * s.sp + s.p);
      if (tw < -0.2) continue;
      var x = Math.floor(((s.x * W - T * 2 * mot) % W + W) % W), y = Math.floor(s.y * maxY);
      g.fillStyle = s.c; g.fillRect(x, y, 1, 1);
      if (tw > 0.85) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
    }
  }
  function disc(cx, cy, r, col) {
    g.fillStyle = col;
    for (var yy = -r; yy <= r; yy++) { var hw = Math.floor(Math.sqrt(r * r - yy * yy)); g.fillRect(cx - hw, cy + yy, hw * 2, 1); }
  }
  function drawRidge(arr, amp, speed, col, hi) {
    var off = T * speed * mot;
    for (var x = 0; x < W; x++) {
      var idx = ((Math.floor((x + off) / 2) * 2) % RL + RL) % RL, h = Math.round(arr[idx] * amp);
      g.fillStyle = col; g.fillRect(x, groundY - h, 1, h);
      if (hi) { g.fillStyle = hi; g.fillRect(x, groundY - h, 1, 1); }
    }
  }
  function pine(x, base, h, col) {
    g.fillStyle = col;
    g.fillRect(x - 1, base - 3, 2, 3);
    for (var y = 0; y < h; y++) {
      var tier = y % Math.max(4, Math.floor(h / 3)), hw = Math.floor(tier * 0.6 + y * 0.18) + 1;
      g.fillRect(x - hw, base - h - 3 + y, hw * 2, 1);
    }
  }
  function drawMeadow() {
    var sc = scene;
    disc(Math.floor(W * 0.72), Math.floor(groundY * 0.3), 14, 'rgba(255,240,200,.25)');
    disc(Math.floor(W * 0.72), Math.floor(groundY * 0.3), 10, '#fff1c0');
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i], cx = Math.floor(wrapX(c.x - T * 3 * mot) - 30), cy = Math.floor(c.y * groundY);
      for (; cx < W; cx += SPAN) {
        g.fillStyle = sc.cloud; g.fillRect(cx + 3, cy, c.w - 6, 1); g.fillRect(cx + 1, cy + 1, c.w - 2, 3);
        g.fillRect(cx + 5, cy - 2, Math.floor(c.w / 3), 2);
        g.fillStyle = sc.cloudDk; g.fillRect(cx + 2, cy + 4, c.w - 4, 1);
      }
    }
    drawRidge(ridgeA, groundY * 0.38, 3, sc.far, sc.farHi);
    var off = T * 9 * mot;
    for (var x = 0; x < W; x++) {
      var wx = x + off, h = Math.round(groundY * (0.12 + 0.07 * Math.sin(wx * 0.025) + 0.03 * Math.sin(wx * 0.071)));
      g.fillStyle = sc.hill; g.fillRect(x, groundY - h, 1, h);
      g.fillStyle = sc.hillHi; g.fillRect(x, groundY - h, 1, 1);
      var hs = ((Math.floor(wx) * 2654435761) >>> 0);
      if (hs % 9 === 0) { g.fillStyle = sc.flowers[hs % 3]; g.fillRect(x, groundY - h + 2 + (hs % 5), 1, 1); }
      if (hs % 23 === 0) { g.fillStyle = sc.hillDk; g.fillRect(x, groundY - h + 4, 1, 2); }
    }
  }
  function drawForest() {
    var sc = scene, i, t, x;
    disc(Math.floor(W * 0.5), Math.floor(groundY * 0.62), Math.min(30, Math.floor(groundY * 0.2)), sc.sun);
    drawRidge(ridgeA, groundY * 0.42, 3, sc.far, sc.farHi);
    for (i = 0; i < treesB.length; i++) {
      t = treesB[i]; x = Math.floor(wrapX(t.x - T * 6 * mot)) - 20;
      for (; x < W + 20; x += SPAN) pine(x, groundY, Math.floor(t.h * groundY * 0.42), sc.treeBack);
    }
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (Math.sin(T * 2 + f.p * 3) < 0.2) continue;
      g.fillStyle = sc.fly;
      g.fillRect(Math.floor(f.x * W + Math.sin(T * 0.7 + f.p) * 10), Math.floor(f.y * groundY + Math.cos(T * 0.9 + f.p) * 5), 1, 1);
    }
    for (i = 0; i < treesF.length; i++) {
      t = treesF[i]; x = Math.floor(wrapX(t.x - T * 12 * mot)) - 20;
      for (; x < W + 20; x += SPAN) pine(x, groundY, Math.floor(t.h * groundY * 0.5), sc.treeFront);
    }
  }
  function drawCity() {
    var sc = scene, farH = groundY * 0.42;
    drawStars(sc.stars, groundY * 0.6);
    var r = Math.max(12, Math.min(44, Math.floor(groundY * 0.24))), scx = Math.floor(W / 2), scy = Math.floor(groundY - farH * 0.55);
    for (var yy = -r; yy <= r; yy++) {
      var k = (yy + r) / (2 * r);
      if (yy > 0 && ((yy + Math.floor(T * 6 * mot)) % 7) < Math.floor(yy / r * 5)) continue;
      var hw = Math.floor(Math.sqrt(r * r - yy * yy));
      g.fillStyle = 'rgb(255,' + Math.round(220 - k * 160) + ',' + Math.round(110 + k * 30) + ')';
      g.fillRect(scx - hw, scy + yy, hw * 2, 1);
    }
    drawRidge(ridgeA, farH, 4, sc.far, sc.farHi);
    var coff = T * 10 * mot, cityH = groundY * 0.4;
    for (var i = 0; i < city.length; i++) {
      var b = city[i], bx = Math.floor(wrapX(b.x - coff)) - 20, bh = Math.floor(b.h * cityH);
      for (; bx < W; bx += SPAN) {
        g.fillStyle = sc.city; g.fillRect(bx, groundY - bh, b.w, bh);
        for (var wy = 3, rI = 0; wy < bh - 3; wy += 4, rI++) for (var wx = 2, cI = 0; wx < b.w - 2; wx += 3, cI++) {
          var hsh = ((b.i * 73856093) ^ (cI * 19349663) ^ (rI * 83492791)) >>> 0;
          if (hsh % 100 < 55) continue;
          if (hsh % 13 === 0 && Math.floor(T * 0.8 + hsh % 7) % 2) continue;
          g.fillStyle = sc.win[hsh % sc.win.length]; g.fillRect(bx + wx, groundY - bh + wy, 1, 2);
        }
        if (b.i % 4 === 1 && bh > 24) {
          var on = Math.floor(T * 1.5 + b.i) % 6 !== 0, nc = ['#ff5ec8', '#5ef2ff', '#ffd23f'][b.i % 3], sy = groundY - bh + 6;
          if (on) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(bx + b.w - 1, sy - 1, 5, 14); }
          g.fillStyle = on ? nc : '#3a2a4a'; g.fillRect(bx + b.w, sy, 3, 12);
          g.fillStyle = '#170c38'; for (var ny = 1; ny < 11; ny += 2) g.fillRect(bx + b.w + 1, sy + ny, 1, 1);
        }
      }
    }
  }
  var flakes = []; for (i = 0; i < 90; i++) flakes.push({ x: rnd(), y: rnd(), s: rnd(), p: rnd() * 6.28 });
  function drawMountain() {
    var sc = scene, x, i;
    disc(Math.floor(W * 0.25), Math.floor(groundY * 0.22), 9, '#f4f8ff');
    // pics enneigés : la neige couvre le haut des sommets
    var off = T * 2 * mot, amp = groundY * 0.62, line = groundY - amp * 0.62;
    for (x = 0; x < W; x++) {
      var idx = ((Math.floor((x + off) / 2) * 2) % RL + RL) % RL, h = Math.round(ridgeA[idx] * amp), top = groundY - h;
      g.fillStyle = sc.far; g.fillRect(x, top, 1, h);
      if (top < line) { g.fillStyle = sc.snow; g.fillRect(x, top, 1, Math.round(line - top) + ((x * 7) % 3)); }
    }
    drawRidge(ridgeB, groundY * 0.3, 6, sc.near, sc.nearHi);
    for (i = 0; i < treesF.length; i++) {
      var t = treesF[i], h2 = Math.floor(t.h * groundY * 0.42); x = Math.floor(wrapX(t.x - T * 12 * mot)) - 20;
      for (; x < W + 20; x += SPAN) { pine(x, groundY, h2, sc.pine); g.fillStyle = sc.snow; g.fillRect(x - 1, groundY - h2 - 3, 2, 2); g.fillRect(x - 2, groundY - h2 + Math.floor(h2 / 3), 4, 1); }
    }
  }
  function drawSnow(dt) {
    g.fillStyle = '#ffffff';
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i], y = Math.floor((f.y * H + T * (14 + f.s * 18) * mot) % H), x = Math.floor(((f.x * W + Math.sin(T + f.p) * 6) % W + W) % W);
      g.fillRect(x, y, f.s > 0.7 ? 2 : 1, f.s > 0.7 ? 2 : 1);
    }
  }
  function palm(x, base, h, sc) {
    for (var y = 0; y < h; y++) { g.fillStyle = sc.trunk; g.fillRect(x + Math.round(Math.sin(y / h * 1.4) * 4), base - y, 2, 1); }
    var tx = x + Math.round(Math.sin(1.4) * 4), ty = base - h;
    [[-1, 0.2], [1, 0.2], [-1, -0.5], [1, -0.5], [0.3, -1]].forEach(function (d) {
      for (var k = 0; k < 9; k++) { g.fillStyle = k < 2 ? sc.palmHi : sc.palm; g.fillRect(tx + Math.round(d[0] * k), ty + Math.round(d[1] * k + k * k * 0.08), 2, 1); }
    });
  }
  function drawBeach() {
    var sc = scene, x, y, i;
    var sx = Math.floor(W * 0.7), sy = Math.floor(groundY * 0.22);
    disc(sx, sy, 16, 'rgba(255,240,180,.3)'); disc(sx, sy, 12, '#fff2a8');
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i], cx = Math.floor(wrapX(c.x - T * 3 * mot) - 30), cy = Math.floor(c.y * groundY * 0.8);
      for (; cx < W; cx += SPAN) { g.fillStyle = sc.cloud; g.fillRect(cx + 3, cy, c.w - 6, 1); g.fillRect(cx + 1, cy + 1, c.w - 2, 3); g.fillStyle = sc.cloudDk; g.fillRect(cx + 2, cy + 4, c.w - 4, 1); }
    }
    var hz2 = Math.floor(groundY * 0.68);
    g.fillStyle = sc.seaDk; g.fillRect(0, hz2, W, groundY - hz2);
    g.fillStyle = sc.sea; g.fillRect(0, hz2, W, Math.floor((groundY - hz2) * 0.55));
    g.fillStyle = sc.seaHi; g.fillRect(0, hz2, W, 1);
    // île au loin
    g.fillStyle = '#2a6a5a'; for (x = -10; x <= 10; x++) g.fillRect(Math.floor(W * 0.18) + x, hz2 - Math.round(4 - Math.abs(x) * 0.35), 1, Math.round(4 - Math.abs(x) * 0.35));
    // vagues et reflets du soleil
    for (y = hz2 + 3, i = 0; y < groundY; y += 4, i++) for (x = 0; x < W; x++) {
      var w = (x + Math.floor(T * (8 + i * 3) * (i % 2 ? 1 : -1) * mot) + i * 13) % 26;
      if ((w + 26) % 26 < 4) { g.fillStyle = '#d8f6ff'; g.fillRect(x, y, 1, 1); }
    }
    for (y = hz2 + 1; y < groundY; y += 2) if (Math.sin(T * 4 + y) > 0) { g.fillStyle = '#fff6c0'; g.fillRect(sx - 3 + ((y * 5) % 6), y, 2, 1); }
    // écume sur le sable
    g.fillStyle = '#ffffff'; for (x = 0; x < W; x++) if ((x + Math.floor(Math.sin(T * 1.5) * 6)) % 7 < 5) g.fillRect(x, groundY - 1, 1, 1);
    palm(Math.floor(W * 0.1), groundY, Math.floor(groundY * 0.42), sc);
    palm(Math.floor(W * 0.9), groundY, Math.floor(groundY * 0.34), sc);
  }
  function drawMoonScape() {
    var sc = scene, x, y;
    drawStars(sc.stars, groundY * 0.9);
    // la Terre
    var ex = Math.floor(W * 0.74), ey = Math.floor(groundY * 0.3), er = Math.max(10, Math.min(20, Math.floor(groundY * 0.12)));
    disc(ex, ey, er + 2, 'rgba(120,180,255,.25)');
    disc(ex, ey, er, '#2f6fe0');
    for (y = -er; y <= er; y++) {
      var hw = Math.floor(Math.sqrt(er * er - y * y));
      for (x = -hw; x < hw; x++) {
        var n = Math.sin(x * 0.45 + y * 0.2) + Math.sin(y * 0.6 - x * 0.15);
        if (n > 0.7) { g.fillStyle = '#3fae5a'; g.fillRect(ex + x, ey + y, 1, 1); }
        else if (Math.sin(y * 1.3 + x * 0.1 + T * 0.3) > 0.92) { g.fillStyle = '#ffffff'; g.fillRect(ex + x, ey + y, 1, 1); }
        if (x > hw * 0.35 && (x + y) % 2 === 0) { g.fillStyle = 'rgba(0,0,30,.55)'; g.fillRect(ex + x, ey + y, 1, 1); }
      }
    }
    drawRidge(ridgeB, groundY * 0.22, 2, sc.ridge, sc.ridgeHi);
    // drapeau planté au loin
    var fx = Math.floor(W * 0.16), fy = Math.floor(groundY - groundY * 0.12);
    g.fillStyle = '#d8d8e4'; g.fillRect(fx, fy - 14, 1, 14);
    g.fillStyle = '#ff4f6f'; g.fillRect(fx + 1, fy - 14, 7, 4); g.fillStyle = '#ffffff'; g.fillRect(fx + 1, fy - 12, 7, 1);
  }
  function drawCosmos(dt) {
    var sc = scene, i, x, y;
    drawStars(sc.stars, groundY * 0.85);
    // aurore
    var ac = sc.aurora;
    for (x = 0; x < W; x++) {
      var base = groundY * 0.18 + Math.sin(x * 0.045 + T * 0.6 * mot) * 7 + Math.sin(x * 0.13 + T * 1.1 * mot) * 3;
      for (var r = 0; r < 12; r += 2) {
        g.fillStyle = 'rgba(' + ac[0] + ',' + (ac[1] - r * 6) + ',' + (ac[2] + r * 6) + ',' + (0.32 - r * 0.025) + ')';
        g.fillRect(x, Math.floor(base + r), 1, 2);
      }
    }
    // étoile filante
    meteor.t -= dt;
    if (meteor.t < 0) { meteor.t = 3 + Math.random() * 5; meteor.x = W * (0.3 + Math.random() * 0.7); meteor.y = groundY * Math.random() * 0.3; }
    if (meteor.t > 2.4 && !reduce) {
      var mp = (3 - meteor.t) * 160;
      for (i = 0; i < 8; i++) { g.fillStyle = 'rgba(255,255,255,' + (1 - i / 8) + ')'; g.fillRect(Math.floor(meteor.x - mp + i * 2), Math.floor(meteor.y + mp * 0.5 - i), 1, 1); }
    }
    // planète à anneaux
    var px = Math.floor(W * 0.22), py = Math.floor(groundY * 0.32), pr = Math.max(10, Math.min(22, Math.floor(groundY * 0.13)));
    g.fillStyle = sc.ring;
    for (x = -pr * 2; x <= pr * 2; x++) { y = Math.round(Math.sqrt(Math.max(0, 1 - Math.pow(x / (pr * 2), 2))) * pr * 0.35); g.fillRect(px + x, py - y, 1, 1); }
    disc(px, py, pr, sc.planet);
    g.fillStyle = sc.planetDk;
    for (y = -pr; y <= pr; y++) { var hw = Math.floor(Math.sqrt(pr * pr - y * y)); for (x = Math.floor(hw * 0.3); x < hw; x++) if ((x + y) % 2 === 0 || x > hw * 0.7) g.fillRect(px + x, py + y, 1, 1); }
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(px - pr + 3, py - 4, pr, 2);
    g.fillStyle = sc.ring;
    for (x = -pr * 2; x <= pr * 2; x++) { y = Math.round(Math.sqrt(Math.max(0, 1 - Math.pow(x / (pr * 2), 2))) * pr * 0.35); if (Math.abs(x) > pr * 0.9 || y > 2) g.fillRect(px + x, py + y, 1, 2); }
    // îles flottantes
    for (i = 0; i < islands.length; i++) {
      var il = islands[i], ix = Math.floor(wrapX(il.x - T * 4 * mot)) - 30, iy = Math.floor(il.y * groundY + Math.sin(T + il.p) * 2 * mot);
      for (; ix < W; ix += SPAN) {
        for (y = 0; y < 7; y++) { var w = Math.max(1, il.w - y * 3); g.fillStyle = y === 0 ? sc.spireHi : sc.spire; g.fillRect(ix + Math.floor((il.w - w) / 2), iy + y, w, 1); }
        g.fillStyle = sc.crystal; g.fillRect(ix + Math.floor(il.w / 2), iy - 3, 1, 3); g.fillRect(ix + Math.floor(il.w / 2) + 3, iy - 2, 1, 2);
      }
    }
    // flèches de cristal
    for (i = 0; i < spires.length; i++) {
      var sp = spires[i], sx = Math.floor(wrapX(sp.x - T * 9 * mot)) - 20, shh = Math.floor(sp.h * groundY);
      for (; sx < W; sx += SPAN) {
        for (y = 0; y < shh; y++) {
          var ww = Math.max(1, Math.round(sp.w * y / shh * 1.4));
          g.fillStyle = sc.spire; g.fillRect(sx - (ww >> 1), groundY - shh + y, ww, 1);
          g.fillStyle = sc.spireHi; g.fillRect(sx - (ww >> 1), groundY - shh + y, 1, 1);
        }
        g.fillStyle = Math.sin(T * 3 + i) > 0 ? sc.crystal : '#c8fbff'; g.fillRect(sx, groundY - shh - 1, 1, 3);
      }
    }
  }

  // ---------- Éléments de décor (props) ----------
  // Petits sprites au pixel près : chaque caractère est une couleur de la palette, "." = transparent
  function spr(rows, pal, x, y, flipX, sc) {
    x = Math.floor(x); y = Math.floor(y); sc = sc || 1;
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
      var ch = rows[r][c]; if (ch === '.') continue;
      g.fillStyle = pal[ch]; g.fillRect(x + (flipX ? rows[r].length - 1 - c : c) * sc, y + r * sc, sc, sc);
    }
  }
  var BFLY_O = ['XX.XX', 'XXBXX', '.X.X.'], BFLY_C = ['.XBX.', '.XBX.', '.....'];
  var BIRD1 = ['X...X', '.X.X.', '..X..'], BIRD2 = ['.....', 'XX.XX', '..X..'];
  var BAT1 = ['X.....X', 'XX.X.XX', '.XXXXX.'], BAT2 = ['.......', 'XXXXXXX', '..XXX..'];
  var OWL = ['.K.K.', 'KOOOK', 'OWOWO', 'OOYOO', 'OBBBO', '.O.O.'];
  var MUSH = ['.RRR.', 'RWRWR', 'RRRRR', '..S..', '..S..'];
  var GMUSH = ['.C.', 'CCC', '.S.'];
  var CRAB1 = ['..K.K..', 'R.....R', '.R...R.', 'RRRRRRR', '.R.R.R.'], CRAB2 = ['..K.K..', 'R.....R', '.R...R.', 'RRRRRRR', 'R.R.R.R'];
  var FCAR = ['..WWW....', 'CCCCCCCCY', '.RR...RR.'];
  var UFO = ['....GGG....', '...GWWGG...', '.SSSSSSSSS.', 'SYSSYSSYSSS', '.SSSSSSSSS.'];
  var SAT = ['BB.S.BB', 'BBSSSBB', 'BB.S.BB'];
  var PED1 = ['.h.', '.F.', 'SSS', 'SSS', 'L.L', 'L.L'], PED2 = ['.h.', '.F.', 'SSS', 'SSS', '.L.', '.L.'];
  var PIGEON = ['.GG..', 'GGGGB', '..O..'];

  function drawBirds(n, col, speed) {
    for (var i = 0; i < n; i++) {
      var x = ((i * 97 + T * speed * mot) % (W + 40)) - 20, y = groundY * (0.12 + 0.07 * i) + Math.sin(T * 1.5 + i) * 3;
      spr(Math.floor(T * 6 + i) % 2 ? BIRD1 : BIRD2, { X: col }, x, y);
    }
  }
  // Objet qui traverse le ciel de temps en temps : renvoie la position x ou null
  function crossing(period, offset, speedPx) {
    var ph = (T + offset) % period, x = ph * speedPx - 20;
    return x < W + 20 ? x : null;
  }
  function rock(x, gy, r, col, hi) {
    x = Math.floor(x);
    for (var yy = -r; yy <= 0; yy++) { var hw = Math.floor(Math.sqrt(r * r - yy * yy) * 1.4); g.fillStyle = yy === -r ? hi : col; g.fillRect(x - hw, gy + yy, hw * 2, 1); }
    g.fillStyle = hi; g.fillRect(x - Math.floor(r * 0.8), gy - r + 1, 3, 1);
  }
  function lamp(x, gy, glow) {
    x = Math.floor(x);
    g.fillStyle = '#2a2a3a'; g.fillRect(x, gy - 34, 2, 34); g.fillRect(x, gy - 34, 7, 2); g.fillRect(x - 1, gy - 2, 4, 2);
    g.fillStyle = glow ? '#fff3a0' : '#d8d8e0'; g.fillRect(x + 5, gy - 32, 4, 2);
    if (glow) { g.fillStyle = 'rgba(255,240,160,.12)'; for (var r = 0; r < 30; r++) { var w = Math.floor(r * 0.45) + 2; g.fillRect(x + 7 - w, gy - 30 + r, w * 2, 1); } }
  }
  function upFlame(x, gy, h) {
    var cols = ['#ff3d2e', '#ff8a1f', '#ffd23f', '#fff3a0'];
    for (var r = 0; r < h; r++) {
      var w = Math.max(0, Math.round((h - r) * 0.4)), sway = Math.round(Math.sin(T * 10 + r * 0.7) * r / h * 1.5);
      for (var c = -w; c <= w; c++) { g.fillStyle = cols[Math.max(0, 3 - Math.floor((Math.abs(c) / (w + 1) + r / h) * 2.2))]; g.fillRect(x + c + sway, gy - r, 1, 1); }
    }
  }

  // Prairie (bébé)
  function propsMeadow() {
    var tx = Math.floor(W * 0.07), gy = groundY, x, i;
    g.fillStyle = '#6a4028'; g.fillRect(tx - 2, gy - 26, 5, 26); g.fillStyle = '#8a5a38'; g.fillRect(tx - 2, gy - 26, 1, 26);
    disc(tx - 6, gy - 30, 10, '#2f8a4a'); disc(tx + 7, gy - 32, 9, '#2f8a4a'); disc(tx, gy - 40, 11, '#3fa85a'); disc(tx - 3, gy - 44, 5, '#6fd47a');
    g.fillStyle = '#e43b44'; [[-8, -33], [6, -38], [2, -28], [-2, -45], [9, -30]].forEach(function (p) { g.fillRect(tx + p[0], gy + p[1], 2, 2); });
    spr(MUSH, { R: '#e43b44', W: '#ffffff', S: '#f4e8d0' }, tx + 8, gy - 5);
    var f0 = Math.floor(W * 0.78);
    g.fillStyle = '#c89a6a'; g.fillRect(f0, gy - 8, W - f0, 2); g.fillRect(f0, gy - 4, W - f0, 2);
    for (x = f0; x < W; x += 8) { g.fillStyle = '#a07040'; g.fillRect(x, gy - 11, 2, 11); g.fillStyle = '#e0c090'; g.fillRect(x, gy - 11, 2, 1); }
    for (x = 3; x < W; x += 11) {
      var h = (x * 2654435761) >>> 0; if (h % 3 === 0) continue;
      var sway = Math.round(Math.sin(T * 2 + x) * 0.8 * mot);
      g.fillStyle = '#2f7a4a'; g.fillRect(x, gy - 3, 1, 3);
      g.fillStyle = ['#ff9ad0', '#fff2a0', '#ffffff', '#9ad0ff'][h % 4]; g.fillRect(x - 1 + sway, gy - 5, 3, 2);
      g.fillStyle = '#ffd23f'; g.fillRect(x + sway, gy - 5, 1, 1);
    }
    for (i = 0; i < 4; i++) {
      var bx = W * (0.15 + i * 0.22) + Math.sin(T * 0.7 + i * 2) * 20 * mot, by = gy - 18 - i * 6 + Math.sin(T * 2.3 + i) * 6 * mot;
      spr(Math.floor(T * 8 + i) % 2 ? BFLY_O : BFLY_C, { X: ['#ff9ad0', '#ffd23f', '#9ad0ff', '#ffffff'][i], B: '#2a1a2a' }, bx, by);
    }
    drawBirds(3, '#2a3a6a', 8);
  }

  // Forêt (junior)
  function propsForest(dt) {
    var gy = groundY, by = Math.floor(gy * 0.38), i, y;
    [[0, 10], [W - 9, 9]].forEach(function (t) {
      g.fillStyle = '#1e1028'; g.fillRect(t[0], 0, t[1], gy);
      g.fillStyle = '#2e1a3a'; for (y = 4; y < gy; y += 7) g.fillRect(t[0] + ((y * 3) % (t[1] - 2)) + 1, y, 1, 4);
    });
    g.fillStyle = '#1e1028'; g.fillRect(10, by, 22, 3); g.fillRect(28, by - 3, 2, 3);
    var blink = (T % 4) < 0.15;
    spr(OWL, { K: '#3a2410', O: '#7a5030', W: blink ? '#7a5030' : '#ffe25e', Y: '#ff9a2e', B: '#c8a070' }, 16, by - 6);
    [[W * 0.14, 0], [W * 0.16, 2], [W * 0.88, 1]].forEach(function (m) {
      var pulse = 0.5 + 0.5 * Math.sin(T * 2 + m[1]);
      disc(Math.floor(m[0]) + 1, gy - 2, 4, 'rgba(94,242,255,' + (0.12 + pulse * 0.12).toFixed(2) + ')');
      spr(GMUSH, { C: m[1] === 1 ? '#c86aff' : '#5ef2ff', S: '#c8b8a8' }, m[0], gy - 3);
    });
    rock(W * 0.24, gy, 5, '#3a2a4a', '#3f8a5a');
    var fx = Math.floor(W * 0.8);
    disc(fx, gy - 5, 15 + Math.round(Math.sin(T * 8)), 'rgba(255,150,60,.12)');
    g.fillStyle = '#5a5a6a'; g.fillRect(fx - 8, gy - 2, 3, 2); g.fillRect(fx + 6, gy - 2, 3, 2);
    g.fillStyle = '#5a3418'; g.fillRect(fx - 6, gy - 2, 12, 2); g.fillStyle = '#7a4a24'; g.fillRect(fx - 5, gy - 3, 10, 1);
    upFlame(fx, gy - 3, 9 + ((T * 12 | 0) % 3));
    if (!reduce && Math.random() < dt * 4) parts.push({ k: 'spark', x: fx, y: gy - 12, vx: (Math.random() - 0.5) * 15, vy: -25 - Math.random() * 20, gr: 0, life: 0.8, col: '#ffd23f' });
    for (i = 0; i < 2; i++) {
      var bx = crossing(9 + i * 4, i * 5, 26);
      if (bx !== null) spr(Math.floor(T * 10) % 2 ? BAT1 : BAT2, { X: '#0e0618' }, bx, gy * (0.15 + i * 0.1) + Math.sin(T * 4 + i) * 3);
    }
  }

  // Ville néon (adulte)
  function propsCity() {
    for (var i = 0; i < 3; i++) {
      var dir = i % 2 ? -1 : 1, sp = 30 + i * 14, ph = (T * sp * mot + i * 130) % (W + 40), x = dir > 0 ? ph - 20 : W + 20 - ph, y = Math.floor(groundY * (0.25 + i * 0.12));
      g.fillStyle = 'rgba(255,240,160,.25)'; g.fillRect(Math.floor(dir > 0 ? x - 14 : x + 9), y + 1, 14, 1);
      spr(FCAR, { C: ['#ff5ec8', '#5ef2ff', '#ffd23f'][i], W: '#c8f8ff', Y: '#fff3a0', R: '#ff4f6f' }, x, y, dir < 0);
    }
    lamp(W * 0.1, groundY, true); lamp(W * 0.88, groundY, true);
  }

  // Sanctuaire cosmique (légende)
  function pillar(x, gy, h, broken) {
    x = Math.floor(x); h = Math.floor(h);
    g.fillStyle = '#2a1a4a'; g.fillRect(x, gy - h, 8, h);
    g.fillStyle = '#4a3a7a'; g.fillRect(x, gy - h, 2, h);
    g.fillStyle = '#1e1238'; g.fillRect(x + 4, gy - h + 3, 1, h - 6);
    g.fillStyle = '#c8962a'; g.fillRect(x - 2, gy - 3, 12, 3);
    if (broken) { g.fillStyle = '#2a1a4a'; g.fillRect(x + 2, gy - h - 2, 3, 2); g.fillRect(x + 5, gy - h - 4, 3, 4); }
    else { g.fillStyle = '#c8962a'; g.fillRect(x - 2, gy - h - 3, 12, 3); g.fillStyle = '#ffe9a0'; g.fillRect(x - 2, gy - h - 3, 12, 1); }
  }
  function crystals(x, gy, seedC) {
    x = Math.floor(x);
    var pulse = 0.5 + 0.5 * Math.sin(T * 2 + seedC);
    disc(x, gy - 6, 10, 'rgba(94,242,255,' + (0.08 + pulse * 0.1).toFixed(2) + ')');
    [[0, 16, 3], [4, 11, 2], [-4, 9, 2], [7, 6, 1]].forEach(function (s2) {
      for (var r = 0; r < s2[1]; r++) {
        var w = Math.max(1, Math.round(s2[2] * r / s2[1] * 1.6));
        g.fillStyle = r < 2 ? '#e8feff' : '#5ef2ff'; g.fillRect(x + s2[0] - w + 1, gy - s2[1] + r, w, 1);
        g.fillStyle = r < 2 ? '#c8fbff' : '#2aa6b8'; g.fillRect(x + s2[0] + 1, gy - s2[1] + r, w, 1);
      }
    });
  }
  function propsCosmos() {
    pillar(W * 0.05, groundY, groundY * 0.42, false); pillar(W * 0.92, groundY, groundY * 0.3, true);
    crystals(W * 0.18, groundY, 0); crystals(W * 0.8, groundY, 2);
    var ux = crossing(16, 3, 22);
    if (ux !== null) {
      var uy = Math.floor(groundY * 0.2 + Math.sin(T * 2) * 3);
      if (Math.floor(T * 3) % 2) { g.fillStyle = 'rgba(160,255,200,.15)'; for (var r = 0; r < 26; r++) g.fillRect(Math.floor(ux) + 5 - Math.floor(r / 3), uy + 5 + r, Math.floor(r / 3) * 2 + 1, 1); }
      spr(UFO, { G: '#5ef2ff', W: '#ffffff', S: '#b8b8c8', Y: Math.floor(T * 6) % 2 ? '#ffd23f' : '#ff4f6f' }, ux, uy);
    }
  }

  // Montagne
  function propsMountain() {
    var gy = groundY, x = Math.floor(W * 0.86) - 15, r, k;
    g.fillStyle = '#7a4a24'; g.fillRect(x, gy - 16, 30, 16);
    g.fillStyle = '#5a3418'; for (r = 2; r < 16; r += 3) g.fillRect(x, gy - 16 + r, 30, 1);
    g.fillStyle = '#ffd27a'; g.fillRect(x + 5, gy - 12, 6, 5); g.fillStyle = '#5a3418'; g.fillRect(x + 7, gy - 12, 1, 5); g.fillRect(x + 5, gy - 10, 6, 1);
    g.fillStyle = '#4a2a14'; g.fillRect(x + 18, gy - 11, 6, 11); g.fillStyle = '#ffd23f'; g.fillRect(x + 22, gy - 6, 1, 1);
    g.fillStyle = '#6a6a78'; g.fillRect(x + 22, gy - 30, 4, 10); g.fillStyle = '#ffffff'; g.fillRect(x + 22, gy - 31, 4, 1);
    for (r = 0; r < 11; r++) { var half = 4 + Math.round(r * 1.7); g.fillStyle = r < 2 ? '#ffffff' : '#e8f0ff'; g.fillRect(x + 15 - half, gy - 27 + r, half * 2, 1); }
    g.fillStyle = '#5a3418'; g.fillRect(x - 3, gy - 17, 36, 1);
    for (k = 0; k < 4; k++) { var ph = (T * 0.5 * (mot || 0.2) + k / 4) % 1; disc(x + 24 + Math.round(Math.sin(T + k) * 2 + ph * 6), Math.round(gy - 33 - ph * 22), 1 + Math.round(ph * 3), 'rgba(220,225,240,' + (0.6 * (1 - ph)).toFixed(2) + ')'); }
    var sx = Math.floor(W * 0.12);
    disc(sx, gy - 5, 5, '#f4f8ff'); disc(sx, gy - 13, 4, '#f4f8ff'); disc(sx, gy - 19, 3, '#f4f8ff');
    g.fillStyle = '#1a1a2e'; g.fillRect(sx - 1, gy - 20, 1, 1); g.fillRect(sx + 1, gy - 20, 1, 1); g.fillRect(sx, gy - 14, 1, 1); g.fillRect(sx, gy - 11, 1, 1);
    g.fillRect(sx - 3, gy - 22, 7, 1); g.fillRect(sx - 2, gy - 26, 5, 4);
    g.fillStyle = '#ff8a1f'; g.fillRect(sx + 2, gy - 19, 3, 1);
    g.fillStyle = '#6a4028'; for (k = 0; k < 5; k++) { g.fillRect(sx + 4 + k, gy - 13 - Math.floor(k * 0.6), 1, 1); g.fillRect(sx - 4 - k, gy - 13 - Math.floor(k * 0.6), 1, 1); }
    g.fillStyle = '#e43b44'; g.fillRect(sx - 3, gy - 17, 7, 1);
    drawBirds(2, '#1e2c50', 10);
  }

  // Plage
  function propsBeach() {
    var gy = groundY, hz2 = Math.floor(gy * 0.68), k;
    var bxp = ((T * 5 * mot) % (W + 40)) - 20, bob = Math.round(Math.sin(T * 2));
    g.fillStyle = '#8a5a30'; g.fillRect(Math.floor(bxp), hz2 + 2 + bob, 12, 2); g.fillRect(Math.floor(bxp) + 1, hz2 + 4 + bob, 10, 1);
    g.fillStyle = '#5a3418'; g.fillRect(Math.floor(bxp) + 6, hz2 - 10 + bob, 1, 12);
    g.fillStyle = '#ffffff'; for (k = 0; k < 10; k++) g.fillRect(Math.floor(bxp) + 7, hz2 - 10 + k + bob, Math.floor(k * 0.6) + 1, 1);
    var px = Math.floor(W * 0.82);
    g.fillStyle = '#4a90d8'; g.fillRect(px - 12, gy - 3, 16, 3); g.fillStyle = '#ffffff'; for (k = 0; k < 16; k += 4) g.fillRect(px - 12 + k, gy - 3, 2, 3);
    g.fillStyle = '#c8c8d8'; g.fillRect(px, gy - 22, 1, 22);
    for (var yy = -10; yy <= 0; yy++) {
      var hw = Math.floor(Math.sqrt(100 - yy * yy) * 1.3);
      for (var xx = -hw; xx < hw; xx++) { g.fillStyle = (Math.floor((xx + 20) / 4) % 2) ? '#e43b44' : '#ffffff'; g.fillRect(px + xx, gy - 22 + yy, 1, 1); }
    }
    var cx2 = Math.floor(W * 0.2), sand = '#d8b070', sandHi = '#f0d090';
    g.fillStyle = sand; g.fillRect(cx2 - 8, gy - 6, 16, 6); g.fillRect(cx2 - 9, gy - 12, 5, 12); g.fillRect(cx2 + 4, gy - 12, 5, 12); g.fillRect(cx2 - 3, gy - 15, 6, 9);
    g.fillStyle = sandHi; [cx2 - 9, cx2 - 7, cx2 + 4, cx2 + 6, cx2 - 3, cx2 + 1].forEach(function (c, i) { g.fillRect(c, i < 4 ? gy - 13 : gy - 16, 2, 1); });
    g.fillStyle = '#7a5030'; g.fillRect(cx2 - 1, gy - 4, 2, 4);
    g.fillStyle = '#e43b44'; g.fillRect(cx2, gy - 21, 3, 2); g.fillStyle = '#5a3418'; g.fillRect(cx2 - 1, gy - 21, 1, 6);
    var crx = W * 0.32 + Math.sin(T * 0.6) * W * 0.12 * mot;
    spr(Math.floor(T * 6) % 2 ? CRAB1 : CRAB2, { R: '#ff5a3a', K: '#1a0b14' }, crx, gy - 5);
    drawBirds(3, '#ffffff', 12);
  }

  // Espace (séjour lunaire)
  function propsMoon() {
    var gy = groundY, x = Math.floor(W * 0.84), k;
    g.fillStyle = '#c8c8d8';
    for (k = 0; k < 7; k++) { g.fillRect(x - 7 - k, gy - 7 + k, 1, 1); g.fillRect(x + 6 + k, gy - 7 + k, 1, 1); }
    g.fillRect(x - 15, gy - 1, 4, 1); g.fillRect(x + 11, gy - 1, 4, 1);
    g.fillStyle = '#d4a020'; g.fillRect(x - 7, gy - 14, 14, 8);
    g.fillStyle = '#a87a10'; for (k = 0; k < 14; k += 3) g.fillRect(x - 7 + k, gy - 12 + (k % 2) * 3, 1, 1);
    g.fillStyle = '#c8c8d8'; g.fillRect(x - 5, gy - 22, 10, 8);
    g.fillStyle = '#26265a'; g.fillRect(x - 2, gy - 20, 4, 3);
    g.fillStyle = '#c8c8d8'; g.fillRect(x + 4, gy - 27, 1, 5); g.fillRect(x + 2, gy - 28, 5, 1);
    g.fillStyle = Math.floor(T * 2) % 2 ? '#ff4f6f' : '#55556a'; g.fillRect(x - 5, gy - 23, 1, 1);
    rock(W * 0.26, gy, 5, '#6a6a7a', '#9a9aae'); rock(W * 0.68, gy, 3, '#6a6a7a', '#9a9aae'); rock(W * 0.08, gy, 4, '#6a6a7a', '#9a9aae');
    var sx = crossing(30, 8, 10);
    if (sx !== null) { spr(SAT, { B: '#3a6ad8', S: '#d8d8e4' }, sx, groundY * 0.12); if (Math.floor(T * 2) % 2) { g.fillStyle = '#ff4f6f'; g.fillRect(Math.floor(sx) + 3, Math.floor(groundY * 0.12) - 1, 1, 1); } }
  }

  // Balade en ville (séjour)
  var houses = [];
  (function () { var x = 0, i = 0; seed = 4242; while (x < SPAN) { var w = 22 + (rnd() * 14 | 0); houses.push({ x: x, w: w, h: 0.32 + rnd() * 0.22, i: i++ }); x += w; } })();
  var FACADES = [['#f2a2a0', '#c8807e'], ['#f6d38a', '#d0ae66'], ['#9fd6c0', '#78b09c'], ['#a8c4f0', '#8098c8'], ['#e8b0e0', '#c088b8'], ['#f0c8a0', '#c8a07c']];
  var AWNINGS = [['#e43b44', '#ffffff'], ['#2a8a5a', '#ffffff'], ['#3a6ad8', '#ffffff'], ['#ffd23f', '#e43b44']];
  function drawTown() {
    var sc = scene, i, x, y;
    disc(Math.floor(W * 0.8), Math.floor(groundY * 0.16), 13, 'rgba(255,250,210,.3)'); disc(Math.floor(W * 0.8), Math.floor(groundY * 0.16), 9, '#fff6c8');
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i], cx = Math.floor(wrapX(c.x - T * 3 * mot) - 30), cy = Math.floor(c.y * groundY * 0.7);
      for (; cx < W; cx += SPAN) { g.fillStyle = sc.cloud; g.fillRect(cx + 3, cy, c.w - 6, 1); g.fillRect(cx + 1, cy + 1, c.w - 2, 3); g.fillStyle = sc.cloudDk; g.fillRect(cx + 2, cy + 4, c.w - 4, 1); }
    }
    for (i = 0; i < city.length; i++) {
      var b = city[i], bx = Math.floor(wrapX(b.x - T * 3 * mot)) - 20, bh = Math.floor(b.h * groundY * 0.62);
      for (; bx < W; bx += SPAN) { g.fillStyle = sc.far; g.fillRect(bx, groundY - bh, b.w, bh); g.fillStyle = sc.farHi; g.fillRect(bx, groundY - bh, 1, bh); }
    }
    var off = T * 10 * mot;
    for (i = 0; i < houses.length; i++) {
      var hs = houses[i], hx = Math.floor(wrapX(hs.x - off)) - 40, top = groundY - Math.floor(hs.h * groundY), fc = FACADES[hs.i % FACADES.length], aw = AWNINGS[hs.i % AWNINGS.length];
      for (; hx < W; hx += SPAN) {
        if (hx + hs.w < 0) continue;
        g.fillStyle = fc[0]; g.fillRect(hx, top, hs.w, groundY - top);
        g.fillStyle = fc[1]; g.fillRect(hx, top, hs.w, 2); g.fillRect(hx + hs.w - 1, top, 1, groundY - top);
        g.fillStyle = '#ffffff'; g.fillRect(hx - 1, top + 2, hs.w + 2, 1);
        for (y = top + 6; y < groundY - 24; y += 9) for (x = hx + 4; x + 5 < hx + hs.w - 2; x += 8) {
          g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 1, 6, 7);
          g.fillStyle = '#6a8ac8'; g.fillRect(x, y, 4, 5); g.fillStyle = '#b8d4f8'; g.fillRect(x, y, 1, 2);
          g.fillStyle = fc[1]; g.fillRect(x - 1, y + 6, 6, 1);
        }
        for (x = 0; x < hs.w - 2; x++) { g.fillStyle = (x >> 1) % 2 ? aw[0] : aw[1]; g.fillRect(hx + 1 + x, groundY - 18, 1, 4); if (x % 2 === 0) g.fillRect(hx + 1 + x, groundY - 14, 1, 1); }
        g.fillStyle = '#9fd8f0'; g.fillRect(hx + 3, groundY - 12, hs.w - 13, 8); g.fillStyle = '#d8f4ff'; g.fillRect(hx + 4, groundY - 11, 2, 3);
        g.fillStyle = '#5a3a2a'; g.fillRect(hx + hs.w - 8, groundY - 12, 5, 12); g.fillStyle = '#ffd23f'; g.fillRect(hx + hs.w - 5, groundY - 6, 1, 1);
      }
    }
  }
  function propsTown() {
    var gy = groundY, i;
    var HAIR = ['#3a2410', '#ffd23f', '#1a1a2e', '#c86a3a', '#8a8aa0'], SHIRT = ['#e43b44', '#3a6ad8', '#2a9a3a', '#ff9ad0', '#ffd23f'];
    for (i = 0; i < 5; i++) {
      var dir = i % 2 ? -1 : 1, sp = 8 + i * 2, ph = (T * sp * mot + i * 90) % (W + 20), x = dir > 0 ? ph - 10 : W + 10 - ph;
      spr(Math.floor(T * 4 + i) % 2 ? PED1 : PED2, { h: HAIR[i], F: '#f0c8a0', S: SHIRT[i], L: '#2a2a4a' }, x, gy - 7, dir < 0);
    }
    for (i = 0; i < 2; i++) { var peck = Math.floor(T * 2 + i * 1.3) % 3 === 0; spr(PIGEON, { G: '#8a8aa0', B: '#5a5a70', O: '#ff9a2e' }, W * (0.64 + i * 0.07), gy - 3 + (peck ? 1 : 0), i === 1); }
    var tx = Math.floor(W * 0.05);
    g.fillStyle = '#5a3418'; g.fillRect(tx - 1, gy - 18, 2, 12);
    disc(tx, gy - 22, 7, '#2f8a4a'); disc(tx - 2, gy - 24, 4, '#4fae6a');
    g.fillStyle = '#a0603a'; g.fillRect(tx - 5, gy - 7, 11, 7); g.fillStyle = '#c8804a'; g.fillRect(tx - 6, gy - 8, 13, 2);
    lamp(W * 0.16, gy, false); lamp(W * 0.94, gy, false);
    var bx = Math.floor(W * 0.8);
    g.fillStyle = '#8a5a30'; g.fillRect(bx, gy - 7, 15, 2); g.fillRect(bx, gy - 12, 15, 2); g.fillRect(bx, gy - 11, 15, 1);
    g.fillStyle = '#3a3a4a'; g.fillRect(bx + 1, gy - 5, 1, 5); g.fillRect(bx + 13, gy - 5, 1, 5); g.fillRect(bx + 1, gy - 12, 1, 5); g.fillRect(bx + 13, gy - 12, 1, 5);
    drawBirds(2, '#2a3a6a', 9);
  }
  function drawProps(dt) {
    var k = scene.kind;
    if (k === 'meadow') propsMeadow();
    else if (k === 'forest') propsForest(dt);
    else if (k === 'city') propsCity();
    else if (k === 'cosmos') propsCosmos();
    else if (k === 'mountain') propsMountain();
    else if (k === 'beach') propsBeach();
    else if (k === 'moon') propsMoon();
    else if (k === 'town') propsTown();
  }

  // ---------- Éléments de décor supplémentaires ----------
  var KITE = ['..R..', '.RRY.', 'RRYYY', '.BBG.', '..B..'];
  var STAR = ['..O..', 'OOOOO', '.OOO.', 'O...O'];
  function extraMeadow() {
    // moulins à vent : plantés sur les sommets de la colline (là où sin(wx * 0.025) = 1) et qui défilent avec elle
    var off = T * 9 * mot, per = 2 * Math.PI / 0.025, n0 = Math.ceil((off - 20 - Math.PI / 0.05) / per), n;
    for (n = n0; (Math.PI / 0.05 + n * per) - off < W + 20; n++) {
      if (n % 2) continue; // un sommet sur deux
      var wx = Math.PI / 0.05 + n * per, hh = Math.round(groundY * (0.12 + 0.07 + 0.03 * Math.sin(wx * 0.071)));
      windmill(Math.round(wx - off), groundY - hh - 14);
    }
    // touffes d'herbe au premier plan
    g.fillStyle = '#3f9a5a';
    for (var x = 6; x < W; x += 17) { g.fillRect(x, groundY - 2, 1, 2); g.fillRect(x + 1, groundY - 3, 1, 3); g.fillRect(x + 2, groundY - 2, 1, 2); }
  }
  function windmill(hx, hy) {
    var k, r;
    for (r = 0; r < 16; r++) { var hw = 2 + Math.floor(r * 0.25); g.fillStyle = r % 4 ? '#f0ecf8' : '#c8c4d8'; g.fillRect(hx - hw, hy + r, hw * 2, 1); }
    g.fillStyle = '#c8504a'; for (r = 0; r < 4; r++) g.fillRect(hx - r - 1, hy - 3 + r, r * 2 + 2, 1);
    g.fillStyle = '#5a3a2a'; g.fillRect(hx - 1, hy + 11, 2, 5);
    for (k = 0; k < 4; k++) {
      var a = T * 1.2 * (mot || 0.3) + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      for (r = 2; r < 13; r++) {
        g.fillStyle = '#5a3a2a'; g.fillRect(Math.round(hx + ca * r), Math.round(hy - 1 + sa * r), 1, 1);
        if (r > 4) { g.fillStyle = '#ffffff'; g.fillRect(Math.round(hx + ca * r - sa * 2), Math.round(hy - 1 + sa * r + ca * 2), 1, 1); }
      }
    }
  }
  function extraForest() {
    // tente près du feu de camp
    var tx = Math.floor(W * 0.8) - 26, r;
    for (r = 0; r < 13; r++) { var w = Math.floor(r * 1.1) + 1; g.fillStyle = '#d86a3a'; g.fillRect(tx - w, groundY - 13 + r, w * 2, 1); g.fillStyle = '#a84a2a'; g.fillRect(tx - w, groundY - 13 + r, 1, 1); }
    g.fillStyle = '#3a1a10'; for (r = 4; r < 13; r++) { var dw = Math.floor((r - 4) * 0.45); g.fillRect(tx - dw, groundY - 13 + r, dw * 2 + 1, 1); }
    g.fillStyle = '#ffd27a'; g.fillRect(tx, groundY - 3, 1, 2);
    // lianes qui pendent
    [0.3, 0.52, 0.68].forEach(function (fx, i) {
      var x = Math.floor(W * fx), len = 12 + i * 7;
      for (var y = 0; y < len; y++) {
        var sx = x + Math.round(Math.sin(T * 1.2 + i + y * 0.15) * (y / len) * 2 * (mot || 0));
        g.fillStyle = '#1e3a2a'; g.fillRect(sx, y, 1, 1);
        if (y % 4 === 2) { g.fillStyle = '#2f6a4a'; g.fillRect(sx + (y % 8 ? 1 : -1), y, 1, 1); }
      }
    });
  }
  function extraCity() {
    // dirigeable publicitaire
    var bx = crossing(45, 12, 7);
    if (bx !== null) {
      var by = Math.floor(groundY * 0.14), x0 = Math.floor(bx);
      for (var r = -4; r <= 4; r++) { var hw = Math.floor(Math.sqrt(16 - r * r) * 3); g.fillStyle = r < -1 ? '#8a8ab8' : '#5a5a8a'; g.fillRect(x0 + 12 - hw, by + r, hw * 2, 1); }
      g.fillStyle = '#3a3a5a'; g.fillRect(x0, by - 3, 3, 6); g.fillRect(x0 + 10, by + 4, 5, 2);
      for (var k = 0; k < 14; k += 2) { g.fillStyle = (Math.floor(T * 6) + k) % 4 < 2 ? '#ff5ec8' : '#5ef2ff'; g.fillRect(x0 + 5 + k, by, 1, 1); }
    }
    // distributeur de boissons lumineux
    var vx = Math.floor(W * 0.95) - 4;
    g.fillStyle = 'rgba(94,242,255,.15)'; g.fillRect(vx - 3, groundY - 21, 14, 21);
    g.fillStyle = '#e43b44'; g.fillRect(vx, groundY - 18, 8, 18);
    g.fillStyle = '#5ef2ff'; g.fillRect(vx + 1, groundY - 16, 4, 9);
    g.fillStyle = '#ffd23f'; g.fillRect(vx + 6, groundY - 15, 1, 1); g.fillRect(vx + 6, groundY - 13, 1, 1); g.fillRect(vx + 6, groundY - 11, 1, 1);
    g.fillStyle = '#1a0b14'; g.fillRect(vx + 1, groundY - 5, 5, 2);
  }
  function extraCosmos() {
    // orbes dorées qui montent lentement
    for (var i = 0; i < 6; i++) {
      var ph = (T * 0.05 * (mot || 0.2) + i / 6) % 1, x = Math.floor(W * (0.12 + i * 0.15) + Math.sin(T + i) * 6), y = Math.floor(groundY - ph * groundY * 0.8);
      disc(x, y, 3, 'rgba(255,210,63,' + (0.25 * Math.sin(ph * Math.PI)).toFixed(2) + ')');
      g.fillStyle = '#fff3a0'; g.fillRect(x, y, 1, 1);
    }
  }
  function extraMountain() {
    // télésiège
    var x0 = 0, y0 = Math.floor(groundY * 0.22), y1 = Math.floor(groundY * 0.5), x, i;
    g.fillStyle = '#2a3a5a';
    for (x = 0; x < W; x += 2) g.fillRect(x, Math.round(y0 + (y1 - y0) * x / W), 1, 1);
    for (i = 0; i < 4; i++) {
      var u = (T * 0.025 * (mot || 0.2) + i / 4) % 1, cx = Math.floor(u * W), cy = Math.round(y0 + (y1 - y0) * u);
      g.fillStyle = '#2a3a5a'; g.fillRect(cx, cy, 1, 5);
      g.fillStyle = '#e43b44'; g.fillRect(cx - 3, cy + 5, 7, 2); g.fillRect(cx - 3, cy + 2, 1, 3);
      if (i % 2) { g.fillStyle = '#3a6ad8'; g.fillRect(cx - 1, cy + 2, 2, 3); g.fillStyle = '#ffd23f'; g.fillRect(cx - 1, cy + 1, 2, 1); }
    }
  }
  function extraBeach() {
    // cerf-volant
    var kx = Math.floor(W * 0.62 + Math.sin(T * 0.8) * 10 * (mot || 0)), ky = Math.floor(groundY * 0.24 + Math.sin(T * 1.3) * 5 * (mot || 0)), ax = Math.floor(W * 0.55);
    g.fillStyle = 'rgba(255,255,255,.6)';
    for (var k = 0; k < 30; k++) { var u = k / 30; g.fillRect(Math.round(kx + 2 + (ax - kx - 2) * u), Math.round(ky + 5 + (groundY - 4 - ky - 5) * u + Math.sin(u * Math.PI) * 6), 1, 1); }
    spr(KITE, { R: '#e43b44', Y: '#ffd23f', B: '#3a6ad8', G: '#2a9a3a' }, kx, ky);
    for (k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#ff5ec8' : '#ffd23f'; g.fillRect(kx + 2 + Math.round(Math.sin(T * 4 + k) * 2), ky + 6 + k * 3, 1, 2); }
    // étoile de mer et coquillages sur le sable
    spr(STAR, { O: '#ff8a5a' }, W * 0.42, groundY + 4);
    g.fillStyle = '#ffe0f0'; g.fillRect(Math.floor(W * 0.6), groundY + 6, 3, 2); g.fillStyle = '#ffffff'; g.fillRect(Math.floor(W * 0.66), groundY + 9, 2, 2);
  }
  function extraMoon() {
    // rover qui se balade
    var rx = Math.floor(W * 0.32 + Math.sin(T * 0.25) * W * 0.12 * (mot || 0)), gy = groundY, moving = Math.cos(T * 0.25) > 0;
    g.fillStyle = '#d8d8e4'; g.fillRect(rx - 6, gy - 7, 13, 4);
    g.fillStyle = '#3a6ad8'; g.fillRect(rx - 5, gy - 9, 8, 2);
    g.fillStyle = '#9a9aae'; g.fillRect(rx + 4, gy - 12, 1, 5); g.fillRect(rx + 3, gy - 13, 3, 1);
    g.fillStyle = '#2a2a3a'; [-5, 0, 5].forEach(function (d) { g.fillRect(rx + d - 1, gy - 3, 3, 3); });
    if (!reduce && Math.random() < 0.3) { g.fillStyle = 'rgba(200,200,210,.5)'; g.fillRect(rx + (moving ? -9 : 8), gy - 2, 2, 1); }
  }
  function extraTown() {
    // guirlande de fanions entre les lampadaires
    var x0 = Math.floor(W * 0.16) + 7, x1 = Math.floor(W * 0.94) + 7, y0 = groundY - 33, cols = ['#e43b44', '#ffd23f', '#3a6ad8', '#2a9a3a', '#ff5ec8'], i = 0;
    for (var x = x0; x < x1; x++) {
      var u = (x - x0) / (x1 - x0), y = Math.round(y0 + Math.sin(u * Math.PI) * 9);
      g.fillStyle = '#5a5a6a'; g.fillRect(x, y, 1, 1);
      if ((x - x0) % 7 === 3) { g.fillStyle = cols[i++ % cols.length]; g.fillRect(x - 1, y + 1, 3, 1); g.fillRect(x - 1, y + 2, 3, 1); g.fillRect(x, y + 3, 1, 1); }
    }
    // terrasse de café
    var cx = Math.floor(W * 0.3);
    g.fillStyle = '#c8c8d8'; g.fillRect(cx, groundY - 16, 1, 16);
    for (var r = 0; r < 4; r++) { g.fillStyle = r % 2 ? '#ffffff' : '#2a9a3a'; g.fillRect(cx - 7 + r, groundY - 19 + r, 15 - r * 2, 1); }
    g.fillStyle = '#f4f4ff'; g.fillRect(cx - 4, groundY - 7, 9, 1); g.fillStyle = '#3a3a4a'; g.fillRect(cx, groundY - 6, 1, 6);
    g.fillStyle = '#8a5a30'; g.fillRect(cx - 8, groundY - 5, 3, 1); g.fillRect(cx - 8, groundY - 9, 1, 9); g.fillRect(cx + 6, groundY - 5, 3, 1); g.fillRect(cx + 8, groundY - 9, 1, 9);
    g.fillStyle = '#ffffff'; g.fillRect(cx - 2, groundY - 9, 2, 2); g.fillStyle = '#8a5a30'; g.fillRect(cx - 2, groundY - 8, 2, 1);
  }
  function drawExtras() {
    var k = scene.kind;
    if (k === 'meadow') extraMeadow();
    else if (k === 'forest') extraForest();
    else if (k === 'city') extraCity();
    else if (k === 'cosmos') extraCosmos();
    else if (k === 'mountain') extraMountain();
    else if (k === 'beach') extraBeach();
    else if (k === 'moon') extraMoon();
    else if (k === 'town') extraTown();
  }

  // ---------- Espèces : sprites générés pour chaque niveau (1 à 10) ----------
  // Chaque espèce est dessinée à sa taille maximale (niveau 10) avec des formes : e = ellipse [cx,cy,rx,ry],
  // p = polygone, r = rectangle [x0,y0,x1,y1]. Pour un niveau donné, on réduit l'ensemble (k), on grossit
  // la tête des petits (hk) et on n'active que les attributs débloqués. head: true = partie de la tête.
  function scaleAbout(pts, c, f) { return pts.map(function (q) { return [c[0] + (q[0] - c[0]) * f, c[1] + (q[1] - c[1]) * f]; }); }
  var SPECIES = {
    dino: {
      name: 'DINO', head: [34, 16], foot: [28, 45.6], kMin: 0.5, kMax: 1, headMax: 1.12, flame: true,
      eye: [37, 13.5], mouth: [38, 45, 19], nose: [46, 16], halo: [32, 7], top: [32, 8], neck: [36, 24], tail: [2, 33], hip: 36,
      parts: function (L) {
        var p = [], spikes = [
          { p: [[27,8],[17,6],[25,15]], head: true }, { p: [[24,14],[13,15],[23,21]] }, { p: [[23,22],[13,24],[23,29]] },
          { p: [[22,30],[14,32],[22,35]] }, { p: [[17,35],[11,32],[14,37]] }, { p: [[9,35],[4,31],[7,36]] }
        ];
        if (L >= 9) {
          var wk = L >= 10 ? 1 : 0.65;
          p.push({ p: scaleAbout([[26,24],[22,12],[14,1],[10,3],[11,9],[5,8],[7,14],[2,15],[8,21],[17,27]], [24, 24], wk), c: 'V' });
          p.push({ p: scaleAbout([[24,23],[21,13],[15,4],[16,11],[19,19]], [24, 24], wk), c: 'v' });
        }
        p.push({ p: [[23,30],[12,35],[4,33],[1,35],[5,39],[14,41],[25,40]], c: 'O' });
        var n = [1, 2, 2, 3, 3, 4, 5, 5, 6, 6][L - 1];
        for (var i = 0; i < n; i++) {
          var sp0 = spikes[i].p, base = [(sp0[0][0] + sp0[2][0]) / 2, (sp0[0][1] + sp0[2][1]) / 2];
          p.push({ p: [sp0[0], scaleAbout([sp0[1]], base, 1.35)[0], sp0[2]], head: spikes[i].head, c: 'S' });
        }
        p.push({ e: [24.5,38.1,3.85,4.4], c: 'D', tag: 'bl' }, { e: [24.5,43.6,4.95,2], c: 'D', tag: 'bl' }, { e: [38.8,29.3,2.2,2.75], c: 'D' });
        p.push({ e: [28.9,31.5,7.7,9.35], c: 'O' }, { e: [32.2,16.1,9.9,8.25], c: 'O', head: true }, { e: [41,18.85,7.7,4.95], c: 'O', head: true });
        if (L >= 7) {
          var hk2 = L >= 9 ? 1 : 0.6;
          p.push({ p: scaleAbout([[28,11],[24,1],[33,9]], [30, 10], hk2), c: 'H', head: true }, { p: scaleAbout([[33,9],[34,2],[37,9]], [35, 9], hk2), c: 'H', head: true });
        }
        if (L >= 3) { // rayures de prédateur
          p.push({ p: [[21.5,26],[25.5,25],[22.5,28]], c: 'M' }, { p: [[21,31],[25,30.5],[22,33]], c: 'M' }, { p: [[16,34.5],[18.5,34],[16.5,37.5]], c: 'M' }, { p: [[9,34.5],[11,34],[9.5,37]], c: 'M' });
          p.push({ p: [[30,9.5],[35,10.5],[31,11.5]], c: 'M', head: true });
        }
        p.push({ e: [31.65,33.15,4.95,6.6], c: 'B' });
        p.push({ e: [31.1,39.2,4.4,3.85], c: 'O', ol: true, tag: 'fl' }, { e: [33.3,43.6,5.5,2], c: 'O', ol: true, tag: 'fl' });
        if (L >= 2) p.push({ p: [[37,44],[40.5,45.6],[37,45.6]], c: 'W', tag: 'fl' });
        p.push({ e: [36.6,29.3,2.75,3.3], c: 'O', ol: true, tag: 'fa' });
        if (L >= 2) p.push({ p: [[38.5,31],[41.5,33.5],[38.5,33]], c: 'W', tag: 'fa' });
        return p;
      }
    },
    phenix: {
      name: 'PHÉNIX', head: [37, 19], foot: [27, 45], kMin: 0.52, kMax: 1, headMax: 1.15, flame: true,
      eye: [38, 17.5], mouth: [43, 47, 20], nose: null, halo: [36, 12], top: [36, 13], neck: [37, 25], tail: [3, 37], hip: 37,
      parts: function (L) {
        var p = [], t = (L - 1) / 9;
        if (L >= 9) {
          var wk = L >= 10 ? 1 : 0.7;
          p.push({ p: scaleAbout([[24,26],[18,12],[10,2],[12,10],[4,6],[8,15],[1,14],[8,22],[16,30]], [22, 27], wk), c: 'V' });
          p.push({ p: scaleAbout([[22,25],[16,13],[13,8],[14,16],[18,24]], [22, 27], wk), c: 'v' });
        }
        p.push({ p: scaleAbout([[18,34],[8,30],[2,32],[6,35],[1,38],[8,39],[3,43],[18,40]], [18, 36], 0.35 + 0.65 * t), c: 'S' });
        p.push({ r: [24,38,25,43], c: 'D', tag: 'bl' }, { r: [22,44,26,44], c: 'H', tag: 'bl' });
        p.push({ e: [27,32,9.5,8.5], c: 'O' }, { e: [30,34,5,5.5], c: 'B' });
        p.push({ e: [36,19,7,6.5], c: 'O', head: true }, { p: [[42,16],[48,17],[50,20],[48.5,22],[47,20],[42,22]], c: 'H', head: true });
        if (L >= 4) p.push({ p: [[30,15],[34,13],[33,16]], c: 'M', head: true });
        var crest = [[[34,14],[31,6],[36,13]], [[36,13],[37,5],[39,13]], [[38,13],[42,6],[40,14]]], nc = [0, 0, 1, 1, 2, 2, 3, 3, 3, 3][L - 1];
        for (var i = 0; i < nc; i++) p.push({ p: crest[i], c: 'S', head: true });
        p.push({ r: [30,38,31,43], c: 'D', tag: 'fl' }, { r: [29,44,34,44], c: 'H', tag: 'fl' });
        if (L >= 2) p.push({ p: [[34,44],[36.5,45.5],[34,45.5]], c: 'W', tag: 'fl' }, { p: [[21,44],[19,45.5],[21,45.5]], c: 'W', tag: 'bl' });
        if (L < 9) p.push({ e: [24,31,7,5], c: 'V', ol: true, tag: 'fa' });
        return p;
      }
    },
    renard: {
      name: 'RENARD', head: [42, 23], foot: [29, 45], kMin: 0.52, kMax: 1, headMax: 1.1, flame: false,
      eye: [43, 21], mouth: [45, 48, 26], nose: [50, 24], halo: [41, 15], top: [41, 16], neck: [38, 29], tail: null, hip: 36,
      parts: function (L) {
        var p = [], n = Math.min(9, L), base = [16, 31], len = 18;
        // Une queue de plus à chaque niveau (9 au maximum), disposées en éventail
        for (var i = 0; i < n; i++) {
          var a = (n === 1 ? -150 : -100 - 100 * i / (n - 1)) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
          var pt = function (f, w) { return [base[0] + dx * len * f + px * w, base[1] + dy * len * f + py * w]; };
          p.push({ p: [pt(0, 2), pt(0.5, 4), pt(0.85, 3), pt(1, 0), pt(0.85, -3), pt(0.5, -4), pt(0, -2)], c: 'O' });
          var tip = pt(0.86, 0);
          p.push({ e: [tip[0], tip[1], 2.6, 2.6], c: 'T' });
        }
        p.push({ r: [19,37,21,43], c: 'D', tag: 'bl' }, { r: [33,37,35,43], c: 'D', tag: 'bl' });
        p.push({ e: [27,33,12,6.5], c: 'O' }, { e: [36,33,4.5,5.5], c: 'B' });
        p.push({ p: [[36,19],[36,7],[41,17]], c: 'O', head: true }, { p: [[41,17],[45,6],[46,18]], c: 'O', head: true });
        p.push({ p: [[37.5,17],[38,13],[40,17]], c: 'S', head: true }, { p: [[42,16],[44,12],[44.5,17]], c: 'S', head: true });
        p.push({ e: [41,23,7,6], c: 'O', head: true }, { p: [[45,20.5],[54,24.5],[52,25.5],[45,28]], c: 'O', head: true }, { e: [42,27,4,2.5], c: 'B', head: true });
        if (L >= 3) p.push({ p: [[39.5,17.5],[41,13.5],[42.5,17.5]], c: 'M', head: true }, { p: [[44,23.5],[48.5,23],[44.5,24.5]], c: 'M', head: true });
        p.push({ r: [23,37,25,43], c: 'O', ol: true, tag: 'fl' }, { r: [37,37,39,43], c: 'O', ol: true, tag: 'fl' });
        p.push({ r: [23,44,26,44], c: 'B', tag: 'fl' }, { r: [37,44,40,44], c: 'B', tag: 'fl' });
        return p;
      }
    },
    lezard: { // varan au ras du sol : collerette (niv. 5), cornes (niv. 7), voile dorsale de dimétrodon (niv. 9)
      name: 'LÉZARD', head: [42, 31], foot: [28, 45.6], kMin: 0.55, kMax: 1, headMax: 1.15, flame: false,
      eye: [43, 29.5], mouth: [46, 53, 33], nose: [52, 31], halo: [42, 24], top: [42, 27], neck: [39, 35], tail: [1, 41], hip: 38,
      parts: function (L) {
        var p = [], i;
        if (L >= 9) {
          var wk = L >= 10 ? 1 : 0.72, sc = [25, 34];
          p.push({ p: scaleAbout([[13,36],[15,25],[19,18],[25,15],[31,18],[35,25],[37,34]], sc, wk), c: 'V' });
          [[19,33,19.5,22],[25,33,25,17],[31,33,30.5,20]].forEach(function (r) { p.push({ p: scaleAbout([[r[0] - 0.6,r[1]],[r[2] - 0.5,r[3]],[r[2] + 0.5,r[3]],[r[0] + 0.6,r[1]]], sc, wk), c: 'v' }); });
        }
        p.push({ p: [[20,34],[10,36],[3,39],[0,42],[6,42.5],[14,41.5],[21,41]], c: 'O' });
        p.push({ r: [17,40,19,44], c: 'D', tag: 'bl' }, { r: [33,40,35,44], c: 'D', tag: 'bl' });
        var spines = [[35,32.6],[31,32],[27,32],[23,32.4],[19,33.6],[14,35.6],[9,37.6]], ns = [2, 3, 3, 4, 4, 5, 5, 6, 7, 7][L - 1], sh = L >= 8 ? 3.5 : 2.5;
        for (i = 0; i < ns; i++) { var q = spines[i]; p.push({ p: [[q[0] - 1.6, q[1] + 1],[q[0], q[1] - sh],[q[0] + 1.6, q[1] + 1]], c: 'S' }); }
        p.push({ e: [27,37,10.5,5], c: 'O' });
        if (L >= 5) { // collerette déployée derrière la tête
          var fk = L >= 9 ? 1.3 : L >= 7 ? 1.1 : 0.9;
          p.push({ p: scaleAbout([[40,36],[34,35],[31,30],[32,24],[35,21],[39,23],[41,27]], [38, 30], fk), c: 'S', head: true });
          p.push({ p: scaleAbout([[35,33],[33,29.5],[36,30.5]], [38, 30], fk), c: 'M', head: true }, { p: scaleAbout([[34,25],[36,22.5],[37,26]], [38, 30], fk), c: 'M', head: true });
        }
        p.push({ e: [42,31,6,4.5], c: 'O', head: true }, { p: [[45,28.5],[54,31],[54,33.5],[45,35.5]], c: 'O', head: true });
        p.push({ e: [28,40,8,2.2], c: 'B' }, { p: [[44,34],[53,33.6],[46,35.6]], c: 'B', head: true });
        if (L >= 3) {
          p.push({ p: [[22,33.5],[24.5,33],[23,37.5]], c: 'M' }, { p: [[28,32.5],[30.5,32.5],[29,36.5]], c: 'M' }, { p: [[12,37],[14.5,36.5],[13,40]], c: 'M' }, { p: [[5,39.5],[7.5,39],[6.5,41.5]], c: 'M' });
          p.push({ p: [[40,28],[45,28.5],[41,29.5]], c: 'M', head: true });
        }
        if (L >= 7) p.push({ p: [[39.5,28],[35.5,21.5],[42,27]], c: 'H', head: true }, { p: [[43,27.2],[42.5,21.5],[45.5,27.8]], c: 'H', head: true });
        p.push({ r: [21,40,23,44], c: 'O', ol: true, tag: 'fl' }, { r: [37,39,39,44], c: 'O', ol: true, tag: 'fl' });
        if (L >= 2) p.push({ p: [[23,44],[25.5,45.6],[23,45.6]], c: 'W', tag: 'fl' }, { p: [[39,44],[41.5,45.6],[39,45.6]], c: 'W', tag: 'fl' });
        return p;
      }
    },
    meduse: { // gorgone : queue de serpent, chevelure de serpents (un de plus presque à chaque niveau), capuchon de cobra (niv. 9)
      name: 'GORGONE', head: [33, 16], foot: [26, 45.6], kMin: 0.55, kMax: 1, headMax: 1.15, flame: false,
      eye: [35.5, 15.5], mouth: [36, 39, 20.5], nose: [40, 17], halo: [33, 6], top: [33, 9], neck: [32, 23], tail: [1, 38], hip: 35,
      parts: function (L) {
        var p = [], i;
        if (L >= 9) {
          var wk = L >= 10 ? 1 : 0.75;
          p.push({ p: scaleAbout([[27,27],[20,16],[21,6],[28,0],[37,0],[43,7],[42,20]], [32, 16], wk), c: 'V', head: true });
          p.push({ p: scaleAbout([[29,23],[24,15],[25,8],[30,4],[35,4],[39,9],[38,19]], [32, 16], wk), c: 'v', head: true });
        }
        // chevelure de serpents, en éventail derrière et au-dessus de la tête
        var n = [2, 3, 3, 4, 4, 5, 5, 6, 7, 7][L - 1], len = L >= 9 ? 9 : 7.5;
        for (i = 0; i < n; i++) {
          var a = (-205 + 135 * (n === 1 ? 0.5 : i / (n - 1))) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
          var b0 = [32 + dx * 4.5, 15 + dy * 4.5], left = [], right = [], c;
          for (var f = 0; f <= 1.001; f += 0.25) {
            var wave = Math.sin(f * Math.PI * 1.6 + i * 1.3) * 1.3, w = 1.5 * (1 - f * 0.3);
            c = [b0[0] + dx * len * f + px * wave, b0[1] + dy * len * f + py * wave];
            left.push([c[0] + px * w, c[1] + py * w]); right.unshift([c[0] - px * w, c[1] - py * w]);
          }
          p.push({ p: left.concat(right), c: 'S', head: true });
          p.push({ e: [c[0] + dx * 1.2, c[1] + dy * 1.2, 2.1, 2.1], c: 'T', head: true });
        }
        p.push({ p: [[16,41],[7,41.5],[1,38.5],[3,36.5],[7,38.8],[17,37.5]], c: 'O', tag: 'bl' });
        p.push({ e: [25.5,41,11,4.6], c: 'O' }, { e: [27,43,8,1.8], c: 'B' });
        p.push({ e: [26.5,29,2.2,4.5], c: 'D' });
        p.push({ e: [31,30,6.5,8], c: 'O' }, { e: [34,31,3,5.5], c: 'B' });
        if (L >= 3) p.push({ p: [[20,38],[22.5,37.5],[21.5,41]], c: 'M' }, { p: [[27,37.5],[29.5,37.5],[28.5,40.5]], c: 'M' }, { p: [[10,38.5],[12,38.5],[11,40.5]], c: 'M' });
        p.push({ e: [33,16,6,6.5], c: 'O', head: true }, { e: [37,17.5,3.2,3.6], c: 'O', head: true });
        if (L >= 5) p.push({ p: [[28,11],[33,8],[38,10.5],[37,12],[33,10],[29,12.5]], c: 'H', head: true }, { e: [33,9.4,1,1], c: 'T', head: true });
        p.push({ e: [37,30,2.2,4.6], c: 'O', ol: true, tag: 'fa' });
        if (L >= 7) p.push({ r: [36,31,38,31], c: 'H', tag: 'fa' });
        return p;
      }
    },
    horus: { // ÉPIQUE : dieu-faucon pharaon. Némès rayé, collier ousekh, sceptre (niv. 3), uræus (niv. 5), disque solaire (niv. 7), ailes (niv. 9)
      name: 'HORUS', epic: true, head: [30, 13], foot: [29.5, 45.6], kMin: 0.6, kMax: 1, headMax: 1.12, flame: false,
      eye: [32, 12.5], mouth: [35, 39, 14.5], nose: null, halo: [30, 3], top: [30, 7], neck: [30, 20], tail: null, hip: 30,
      parts: function (L) {
        var p = [];
        if (L >= 9) {
          var wk = L >= 10 ? 1 : 0.72, sc = [25, 22];
          p.push({ p: scaleAbout([[27,22],[21,11],[12,3],[1,4],[6,9],[0,12],[7,15],[1,19],[9,21],[18,28]], sc, wk), c: 'V' });
          p.push({ p: scaleAbout([[25,21],[20,13],[12,7],[15,12],[20,20]], sc, wk), c: 'v' });
          p.push({ p: scaleAbout([[27,22],[21,11],[12,3],[13,5.5],[21,13],[26,23]], sc, wk), c: 'H' });
        }
        if (L >= 7) p.push({ e: [29.5,0,4.8,4.8], c: 'T', head: true }, { p: [[24,2.5],[35,2.5],[34.5,3.8],[24.5,3.8]], c: 'H', head: true });
        p.push({ p: [[23.5,8],[30,6],[35,8.5],[33.5,12],[29,14],[27.5,23.5],[20.5,23.5],[22,13]], c: 'V', head: true });
        p.push({ p: [[22,14.5],[29,14.5],[28.8,15.6],[21.8,15.6]], c: 'H', head: true }, { p: [[21.5,17.5],[28.4,17.5],[28.2,18.6],[21.3,18.6]], c: 'H', head: true }, { p: [[21,20.5],[27.9,20.5],[27.7,21.6],[20.9,21.6]], c: 'H', head: true });
        p.push({ r: [25,38,27,43], c: 'D', tag: 'bl' }, { r: [24,44,28,44], c: 'H', tag: 'bl' });
        p.push({ e: [22.8,26,2.4,5], c: 'D' });
        p.push({ e: [29.5,25.5,6.8,7], c: 'O' });
        p.push({ p: [[22.5,30.5],[36.5,30.5],[39,38.5],[20,38.5]], c: 'B' }, { r: [22,30,36,30], c: 'H' }, { p: [[28.3,31],[30.7,31],[31.4,38],[27.6,38]], c: 'H' });
        p.push({ e: [30,20.8,7,3], c: 'H' }, { e: [30,20.9,5.6,1.5], c: 'V' }, { e: [30,20.7,3.8,0.7], c: 'H' });
        p.push({ e: [30,13,6,6], c: 'S', head: true }, { e: [31.5,16,3.5,2], c: 'B', head: true }, { p: [[35,10.5],[40.5,12.5],[40,15.5],[38.2,14.6],[35,16]], c: 'H', head: true }); // tête de faucon : plumage brun, gorge claire
        p.push({ p: [[24,7.6],[34,8],[34.2,9.6],[24,9.6]], c: 'H', head: true });
        if (L >= 2) p.push({ p: [[31.5,15],[33,15],[32,18.5],[31,18.5]], c: 'M', head: true });
        if (L >= 5) p.push({ p: [[32.5,7.5],[33.5,4.5],[35.2,5.5],[34.5,8.2]], c: 'H', head: true });
        p.push({ r: [31,38,33,43], c: 'O', ol: true, tag: 'fl' }, { r: [30,44,35,44], c: 'H', tag: 'fl' });
        if (L >= 3) p.push({ r: [40,10,40,44], c: 'H', tag: 'fa' }, { p: [[40,10],[43.5,8.5],[44,10],[41,11]], c: 'H', tag: 'fa' });
        p.push({ e: [36.5,26,2.4,5], c: 'O', ol: true, tag: 'fa' }, { e: [38.6,30,1.8,1.8], c: 'O', ol: true, tag: 'fa' });
        return p;
      }
    },
    lapin: { // lapin de combat : à 4 pattes jusqu'au niveau 4, debout dès le niveau 5, piercings (6), muscles (7), cicatrice (8), ceinture de champion (10)
      name: 'LAPIN', kMin: 0.55, kMax: 1, headMax: 1.15, flame: false, tail: null,
      // Les points d'ancrage changent quand il se lève sur ses pattes arrière
      byLevel: function (L) {
        return L < 5
          ? { head: [36, 30], foot: [27, 45.6], eye: [37.5, 28.5], mouth: [40, 43, 33.5], nose: [43.5, 31.5], halo: [34, 9], top: [35, 25], neck: [33, 34], hip: 40 }
          : { head: [30, 14], foot: [28, 45.6], eye: [31.5, 12.5], mouth: [34, 37, 17], nose: [37.5, 15], halo: [29, -8], top: [29.5, 9], neck: [30, 20.5], hip: 34 };
      },
      parts: function (L) {
        var p = [];
        if (L < 5) { // petit lapin à quatre pattes, regard déjà mauvais
          p.push({ r: [29,41,30,44], c: 'D', tag: 'bl' });
          p.push({ e: [26,38,9,6.5], c: 'O' }, { e: [30,40.5,4,3.2], c: 'B' }, { e: [16.5,36.5,2.6,2.6], c: 'B' });
          p.push({ e: [22,40,5.5,4.5], c: 'O', ol: true, tag: 'bl' }, { e: [24,44.4,5,1.4], c: 'O', ol: true, tag: 'bl' });
          p.push({ p: [[32,26],[30,13],[33,11],[35,25]], c: 'O', head: true }, { p: [[32.5,24],[31.5,15],[33,14],[34,24]], c: 'S', head: true });
          p.push({ p: [[35,25],[36,12],[39,11.5],[38,25]], c: 'O', head: true }, { p: [[36,23.5],[37,14],[38.3,14],[37.3,24]], c: 'S', head: true });
          p.push({ e: [36,30,6,5.5], c: 'O', head: true }, { e: [41,32,3,2.6], c: 'O', head: true }, { e: [40,33.6,2.5,1.4], c: 'B', head: true });
          if (L >= 3) p.push({ p: [[33,26],[36,26.5],[34,28]], c: 'M', head: true });
          p.push({ r: [32,40,33,44], c: 'O', ol: true, tag: 'fl' });
          return p;
        }
        var mk = L >= 9 ? 1.25 : L >= 7 ? 1.12 : 1; // muscles qui gonflent
        // bras et épaule arrière
        p.push({ e: [19.5,21,3.6 * mk,3.2 * mk], c: 'D' }, { e: [18.5,27,2.8 * mk,4.5 * mk], c: 'D' }, { e: [18.5,32.5,2.4 * mk,2.2 * mk], c: 'D' });
        p.push({ e: [24,38,4.5,4], c: 'D', tag: 'bl' }, { p: [[19,43],[29,43],[30,45.6],[18,45.6]], c: 'D', tag: 'bl' });
        p.push({ e: [21,34,2.6,2.6], c: 'B' });
        // oreilles immenses, dressées
        p.push({ p: [[25.5,9],[22.5,-6],[26.5,-8],[28.5,8]], c: 'O', head: true }, { p: [[25.8,6],[24,-4.5],[26,-6],[27.3,6]], c: 'S', head: true });
        p.push({ p: [[30,8],[31.5,-8],[35.5,-7],[33,9]], c: 'O', head: true }, { p: [[30.9,6],[32.1,-5.5],[34,-5],[32.3,6.5]], c: 'S', head: true });
        // torse en V très large, pectoraux et abdos
        p.push({ p: scaleAbout([[17,19],[40,19],[35.5,34.5],[22,34.5]], [28.5, 26], mk), c: 'O' });
        p.push({ p: [[24.5,25.5],[32.5,25.5],[31.5,34],[25.5,34]], c: 'B' });
        p.push({ p: [[22,22.5],[28.5,25.4],[35,22.5],[35,23.8],[28.5,26.6],[22,23.8]], c: 'M' });
        p.push({ r: [28,27,28,33], c: 'b' }, { r: [26,28.5,30,28.5], c: 'b' }, { r: [26,31,30,31], c: 'b' });
        p.push({ e: [28.5,38.5,4.8,4.6], c: 'O', ol: true, tag: 'fl' }, { p: [[25,43],[35,43],[36.5,45.6],[24,45.6]], c: 'O', ol: true, tag: 'fl' });
        if (L >= 10) p.push({ r: [22,33,35,34], c: 'H' }, { e: [28.5,33.5,2.6,1.8], c: 'T' });
        // tête
        p.push({ e: [30,13.5,6.6,6], c: 'O', head: true }, { e: [35.5,15.5,3.2,2.7], c: 'O', head: true }, { e: [35,17.4,2.5,1.3], c: 'B', head: true });
        if (L >= 6) p.push({ e: [23,-3,0.9,0.9], c: 'H', head: true }, { e: [23.8,0.5,0.9,0.9], c: 'H', head: true }, { e: [35.2,-4.5,0.9,0.9], c: 'H', head: true });
        if (L >= 8) p.push({ p: [[30,8.8],[31,8.6],[33.5,15],[32.5,15.2]], c: 'M', head: true }, { e: [22.2,4,1.2,1.2], c: 'H', head: true });
        // bras avant : épaule, biceps, avant-bras, poing serré
        p.push({ e: [37.5,21.5,3.8 * mk,3.4 * mk], c: 'O', ol: true, tag: 'fa' }, { e: [39,27,3.2 * mk,4.2 * mk], c: 'O', ol: true, tag: 'fa' });
        p.push({ e: [39.5,32.5,2.8 * mk,3.4 * mk], c: 'O', ol: true, tag: 'fa' }, { e: [39.5,36.5,2.8 * mk,2.4 * mk], c: 'O', ol: true, tag: 'fa' });
        if (L >= 7) p.push({ r: [37,33,42,34], c: 'H', tag: 'fa' });
        return p;
      }
    },
    requin: { // requin des terres : sur ses nageoires jusqu'au niv. 4, debout et musclé dès le niv. 5. Dents (2), branchies (3), rayures (5), cicatrice (7), aileron royal (9), ceinture (10)
      name: 'REQUIN', kMin: 0.62, kMax: 1.06, headMax: 1.12, flame: false,
      byLevel: function (L) {
        return L < 5
          ? { head: [43, 33], foot: [33, 45.6], eye: [44, 30.5], mouth: [46, 51, 36.2], nose: [52, 31.5], halo: [43, 21], top: [43, 26], neck: [39, 37], tail: [3, 24], hip: 37 }
          : { head: [30, 8], foot: [28, 45.6], eye: [31.5, 5.6], mouth: [35, 40, 12.2], nose: [41.5, 7.5], halo: [29, -9], top: [29.5, 1.5], neck: [30, 17], tail: [16, 40], hip: 34 };
      },
      parts: function (L) {
        var p = [];
        if (L < 5) { // jeune requin qui marche sur ses nageoires
          var fk = 0.65 + 0.35 * (L - 1) / 3;
          p.push({ p: [[13,33],[7,26],[3,22],[1,23],[5,31],[8,36]], c: 'O' }, { p: [[8,36],[3,43],[6,43.5],[13,38]], c: 'D' });
          p.push({ r: [28,40,30,44], c: 'D', tag: 'bl' }, { p: [[26,44],[32,44],[31,45.6],[25,45.6]], c: 'D', tag: 'bl' });
          p.push({ p: [[7,34],[18,29],[20,39],[9,37.5]], c: 'O' });
          p.push({ e: [28,34.5,14,7.5], c: 'O' });
          p.push({ p: scaleAbout([[23,28],[29,16],[31,16.5],[33,28]], [28, 28], fk), c: 'O' });
          if (L >= 4) p.push({ p: [[13,31],[15,26.5],[17,30.5]], c: 'O' });
          p.push({ e: [30,39,12,3.4], c: 'B' });
          p.push({ e: [42,33.5,8.5,6.5], c: 'O', head: true }, { p: [[45,28],[55,31.8],[53,35.6],[45,39]], c: 'O', head: true });
          p.push({ p: [[38,38],[53,35.4],[49,38.6],[38,40.2]], c: 'B', head: true });
          if (L >= 2) [46.5, 49, 51.2].forEach(function (x) { p.push({ p: [[x - 0.9, 36.8],[x, 38.6],[x + 0.9, 36.6]], c: 'W', head: true }); });
          if (L >= 3) [36.5, 38.3, 40.1].forEach(function (x) { p.push({ p: [[x,31],[x + 0.7,31],[x + 0.3,36.5],[x - 0.4,36.5]], c: 'M', head: true }); });
          p.push({ p: [[37,39],[42,39],[42.5,44],[41.5,45.6],[36,45.6]], c: 'O', ol: true, tag: 'fl' });
          p.push({ p: [[30,36],[35,36.5],[31,41.5],[28,40]], c: 'O', ol: true, tag: 'fa' });
          return p;
        }
        var mk = L >= 9 ? 1.32 : L >= 7 ? 1.2 : 1.06; // bras de plus en plus gonflés
        var hf = L >= 9 ? 1.15 : L >= 7 ? 1 : 0.8;       // aileron de tête de plus en plus tranchant
        if (L >= 9) { // aileron royal dans le dos : étroit et très haut
          var wk = L >= 10 ? 1 : 0.8, sc = [21, 26];
          p.push({ p: scaleAbout([[19,31],[16,20],[17,6],[20,-2],[23,8],[25,22],[25,31]], sc, wk), c: 'V' });
          p.push({ p: scaleAbout([[20,29],[18,19],[19.5,8],[21.5,12],[23,24]], sc, wk), c: 'v' });
        }
        // petite queue entre les jambes
        p.push({ p: [[23,37],[16,40.5],[13,38],[13.5,45.6],[21,44],[24,41]], c: 'D', tag: 'bl' });
        // bras arrière et épaule arrière, très gonflés
        p.push({ e: [19.5,20.5,4 * mk,3.6 * mk], c: 'D' }, { e: [18.8,26.5,3 * mk,4.6 * mk], c: 'D' }, { e: [19,32,2.6 * mk,2.4 * mk], c: 'D' });
        p.push({ e: [24.5,38,4.2,4.2], c: 'D', tag: 'bl' }, { p: [[20.5,43],[28.5,43],[29.5,45.6],[19.5,45.6]], c: 'D', tag: 'bl' });
        // trapèzes massifs autour du cou
        p.push({ p: [[21.5,20],[25,13],[33,13],[36.5,20]], c: 'O' });
        // torse en V, ventre blanc de requin, pectoraux et abdos
        p.push({ p: [[18.5,18.5],[38.5,18.5],[33.5,35],[23.5,35]], c: 'O' });
        p.push({ p: [[24.5,22.5],[32.5,22.5],[31.5,35],[25.5,35]], c: 'B' });
        p.push({ p: [[21.5,22],[28.5,25.6],[35.5,22],[35.5,23.6],[28.5,27],[21.5,23.6]], c: 'M' });
        p.push({ r: [28,27.5,28,34], c: 'b' }, { r: [26,29,30,29], c: 'b' }, { r: [26,31.5,30,31.5], c: 'b' }, { r: [26.5,33.6,29.5,33.6], c: 'b' });
        [[21,25],[20.5,30],[36,25],[36.5,30]].forEach(function (q) { p.push({ p: [[q[0] - 1.2,q[1]],[q[0] + 1.2,q[1] - 0.6],[q[0] + 0.8,q[1] + 1],[q[0] - 1,q[1] + 1.4]], c: 'M' }); }); // rayures de tigre
        p.push({ e: [29,38.5,4.4,4.6], c: 'O', ol: true, tag: 'fl' }, { p: [[25.5,43],[34,43],[35.5,45.6],[24.5,45.6]], c: 'O', ol: true, tag: 'fl' });
        if (L >= 10) p.push({ r: [23,33,34,34], c: 'H' }, { e: [28.5,33.5,2.6,1.8], c: 'T' });
        // aileron tranchant sur le crâne, penché vers l'arrière
        p.push({ p: scaleAbout([[25.5,3.5],[22,-7],[24.2,-7.6],[30,2.5]], [27, 3], hf), c: 'O', head: true });
        p.push({ p: scaleAbout([[26,3],[22.8,-5.6],[23.8,-6],[27.4,2.8]], [27, 3], hf), c: 'D', head: true });
        // tête de requin : museau pointu vers l'avant, mâchoire claire, dents, branchies
        p.push({ e: [30,7.5,6.4,5.6], c: 'O', head: true }, { p: [[33,3],[42,6.8],[40.8,10.8],[33,13.4]], c: 'O', head: true });
        p.push({ p: [[28,12.4],[40.8,10.6],[37,14.2],[28,14.8]], c: 'B', head: true });
        var tk = L >= 7 ? 1.35 : 1.1;
        [34.4, 36.5, 38.5].forEach(function (x) { p.push({ p: [[x - 0.9 * tk, 12],[x, 12 + 1.9 * tk],[x + 0.9 * tk, 11.8]], c: 'W', head: true }); });
        [25, 26.6, 28.2].forEach(function (x) { p.push({ p: [[x,5],[x + 0.7,5],[x + 0.4,10.5],[x - 0.3,10.5]], c: 'M', head: true }); });
        p.push({ p: [[30.5,3.4],[35.5,4.6],[30.8,5]], c: 'M', head: true }); // sourcil froncé
        if (L >= 7) p.push({ p: [[30.3,1.8],[31.3,1.6],[33.8,7.5],[32.8,7.7]], c: 'b', head: true });
        // bras avant : épaule, biceps énorme, avant-bras, nageoire en guise de poing
        p.push({ e: [37,21,4.2 * mk,3.8 * mk], c: 'O', ol: true, tag: 'fa' }, { e: [38.5,26.5,3.4 * mk,4.4 * mk], c: 'O', ol: true, tag: 'fa' });
        p.push({ e: [39,32,3 * mk,3.4 * mk], c: 'O', ol: true, tag: 'fa' }, { p: [[37,35],[42,35],[44,40],[38.5,38.5]], c: 'O', ol: true, tag: 'fa' });
        p.push({ p: [[36.5,24.5],[39.5,23.5],[40,26],[37,26.5]], c: 'L', tag: 'fa' }); // reflet sur le biceps
        if (L >= 7) p.push({ r: [37,32.5,41.5,33.5], c: 'H', tag: 'fa' });
        return p;
      }
    }
  };
  // Génère la définition du sprite d'une espèce à un niveau : formes mises à l'échelle + points d'ancrage
  function spriteDef(sp, L) {
    var S = SPECIES[sp];
    if (S.byLevel) S = Object.assign({}, S, S.byLevel(L)); // anatomie qui change selon le niveau (le lapin se lève)
    var t = (L - 1) / 9, k = S.kMin + (S.kMax - S.kMin) * t, hk = S.headMax + (1 - S.headMax) * t;
    function tp(q, head) {
      var x = q[0], y = q[1];
      if (head) { x = S.head[0] + (x - S.head[0]) * hk; y = S.head[1] + (y - S.head[1]) * hk; }
      return [(x - S.foot[0]) * k, (y - S.foot[1]) * k];
    }
    var parts = S.parts(L).map(function (p) {
      var o = { c: p.c, ol: p.ol, tag: p.tag };
      if (p.e) { var c = tp(p.e, p.head), f = k * (p.head ? hk : 1); o.e = [c[0], c[1], Math.max(0.8, p.e[2] * f), Math.max(0.8, p.e[3] * f)]; }
      else {
        var pts = p.p || [[p.r[0], p.r[1]], [p.r[2] + 1, p.r[1]], [p.r[2] + 1, p.r[3] + 1], [p.r[0], p.r[3] + 1]];
        o.p = pts.map(function (q) { return tp(q, p.head); });
        if (p.r) { // garde au moins 1 pixel d'épaisseur aux petits rectangles (pattes, griffes)
          var xs = o.p.map(function (q) { return q[0]; }), ys = o.p.map(function (q) { return q[1]; });
          var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
          if (x1 - x0 < 1) x1 = x0 + 1; if (y1 - y0 < 1) y1 = y0 + 1;
          o.p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        }
      }
      return o;
    });
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    parts.forEach(function (o) {
      if (o.e) { minX = Math.min(minX, o.e[0] - o.e[2]); maxX = Math.max(maxX, o.e[0] + o.e[2]); minY = Math.min(minY, o.e[1] - o.e[3]); maxY = Math.max(maxY, o.e[1] + o.e[3]); }
      else o.p.forEach(function (q) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); });
    });
    var ox = Math.ceil(-minX) + 3, oy = Math.ceil(-minY) + 9; // marge en haut pour les accessoires et l'auréole
    parts.forEach(function (o) {
      if (o.e) { o.e[0] += ox; o.e[1] += oy; }
      else o.p = o.p.map(function (q) { return [q[0] + ox, q[1] + oy]; });
    });
    function A(q, head) { if (!q) return null; var r = tp(q, head); return [Math.round(r[0] + ox), Math.round(r[1] + oy)]; }
    var eyeC = A(S.eye, true), m0 = A([S.mouth[0], S.mouth[2]], true), m1 = A([S.mouth[1], S.mouth[2]], true);
    if (m1[0] - m0[0] < 3) m1[0] = m0[0] + 3;
    return {
      gw: Math.ceil(maxX + ox) + 3, gh: Math.ceil(maxY + oy) + 2, parts: parts, flame: S.flame && L >= 10,
      eye: [eyeC[0] - 2, eyeC[1] - 2], mouth: [m0[0], m1[0], m0[1]], nose: A(S.nose, true),
      halo: A(S.halo, true), top: A(S.top, true), neck: A(S.neck, false), tail: A(S.tail, false),
      hip: Math.round(tp([0, S.hip], false)[1] + oy)
    };
  }

  // 10 niveaux selon l'âge. Les 4 paliers (bébé → légende) pilotent le décor et la musique.
  var LEVELS = [0, 0.25, 0.75, 1.5, 3, 6, 12, 24, 48, 96].map(function (h) { return h * 3600e3; });
  var TIERS = [{ k: 'bebe', n: 'BÉBÉ' }, { k: 'junior', n: 'JUNIOR' }, { k: 'adulte', n: 'ADULTE' }, { k: 'legende', n: 'LÉGENDE' }];
  var TIER_OF = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
  function tierOf(i) { return TIER_OF[Math.max(0, i)]; }
  // ?stage=1..10 force l'affichage d'un niveau (mode dev uniquement)
  var forceStage = (function () {
    var m = /[?&]stage=(\d+)/.exec(location.search), n = m ? +m[1] : 0;
    return n >= 1 && n <= 10 ? n - 1 : -1;
  })();
  function stageOf(s) {
    if (forceStage >= 0 && s && s.dev) return forceStage;
    if (!s) return 0;
    var age = (s.dead ? s.deadAt : Date.now() + offset) - s.born, i = 0;
    for (var j = 0; j < LEVELS.length; j++) if (age >= LEVELS[j]) i = j;
    return i;
  }
  function speciesOf(s) { return s && SPECIES[s.species] ? s.species : 'dino'; }
  var SPRITES = {}; // définitions générées, mises en cache par espèce et niveau
  function sprKey(i) {
    var key = speciesOf(st) + ':' + (Math.max(0, i) + 1);
    if (!SPRITES[key]) SPRITES[key] = spriteDef(speciesOf(st), Math.max(0, i) + 1);
    return key;
  }

  var POSES = { idle: {}, w1: { fl: 1, bl: -1, fa: -1 }, w2: { fl: -1, bl: 1, fa: 1 } };
  var gridCache = {};
  function inPoly(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function partHas(p, x, y, dx) {
    var cx = x + 0.5 - dx, cy = y + 0.5;
    if (p.e) { var a = (cx - p.e[0]) / p.e[2], b = (cy - p.e[1]) / p.e[3]; return a * a + b * b <= 1; }
    if (p.r) return cx >= p.r[0] && cx <= p.r[2] + 1 && cy >= p.r[1] && cy <= p.r[3] + 1;
    return inPoly(cx, cy, p.p);
  }
  function spriteGrid(key, pose) {
    var ck = key + ':' + pose;
    if (gridCache[ck]) return gridCache[ck];
    var sd = SPRITES[key], GW = sd.gw, GH = sd.gh, P = POSES[pose], gr = [], x, y;
    for (y = 0; y < GH; y++) { gr.push([]); for (x = 0; x < GW; x++) gr[y].push('.'); }
    sd.parts.forEach(function (p) {
      var dx = (p.tag && P[p.tag]) || 0, m = [], set = {};
      for (var yy = 0; yy < GH; yy++) for (var xx = 0; xx < GW; xx++) if (partHas(p, xx, yy, dx)) { m.push([xx, yy]); set[xx + ',' + yy] = 1; }
      if (p.ol) m.forEach(function (q) {
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = q[0] + d[0], ny = q[1] + d[1];
          if (nx >= 0 && ny >= 0 && nx < GW && ny < GH && !set[nx + ',' + ny] && gr[ny][nx] !== '.') gr[ny][nx] = 'K';
        });
      });
      m.forEach(function (q) { gr[q[1]][q[0]] = p.c; });
    });
    var empty = function (x, y) { return x < 0 || y < 0 || x >= GW || y >= GH || gr[y][x] === '.' || gr[y][x] === 'K'; };
    var out = gr.map(function (r) { return r.slice(); });
    for (y = 0; y < GH; y++) for (x = 0; x < GW; x++) {
      var c = gr[y][x];
      if (c === 'O') { if (empty(x, y - 1)) out[y][x] = 'L'; else if (empty(x, y + 1) || empty(x - 1, y)) out[y][x] = 'D'; }
      else if (c === 'B' && empty(x, y + 1)) out[y][x] = 'b';
    }
    for (y = 0; y < GH; y++) for (x = 0; x < GW; x++) {
      if (out[y][x] === '.' && (!empty(x - 1, y) || !empty(x + 1, y) || !empty(x, y - 1) || !empty(x, y + 1))) out[y][x] = 'K';
    }
    return (gridCache[ck] = out);
  }

  var K = '#1a0b14';
  var cre = { x: 0, tx: 0, dir: 1, wait: 2, walking: false, walkT: 0, jy: 0, vy: 0, eat: 0, blink: 0, nextBlink: 2, stage: -1, evo: 0, evoFrom: 0, dash: 0, travel: null };
  var EVO_TIME = 2.6;
  var T = 0, shake = 0, parts = [];

  function moodOf(s) {
    if (!s) return 'ok';
    if (s.dead) return 'dead';
    if (s.food < 15 || s.joy < 15) return 'sad';
    if (s.food > 55 && s.joy > 55) return 'happy';
    return 'ok';
  }
  function rainbow() { return st && !st.dead && st.food > 80 && st.joy > 80; }
  var HUES = { bleu: 212, vert: 118, rose: 330, violet: 272, or: 46 };
  var SPIKES = { orange: '#2fd6c8', bleu: '#ffd23f', vert: '#ff8a1f', rose: '#5ef2ff', violet: '#7dff7a', or: '#ff4f6f' };
  // o (facultatif) : { sp, lvl } pour colorer une autre créature (teasers en arrière-plan) avec ses couleurs naturelles
  function creCols(o) {
    if (!o && (!st || st.dead)) return { O: '#9a9aae', L: '#cfcfdc', D: '#6a6a7e', B: '#d8d8e4', b: '#a8a8b8', S: '#7a7a8e', W: '#ffffff', K: K, V: '#5a5a6e', v: '#3e3e50', H: '#e0e0ea', T: '#e0e0ea', M: '#55556a' };
    var s = o ? 80 : Math.round(45 + st.joy * 0.5), lf = o ? 5 : Math.round(st.food * 0.08), lvl = o ? o.lvl : Math.max(0, cre.stage), leg = lvl === 9, sp = o ? o.sp : speciesOf(st);
    // Teinte d'origine propre à chaque espèce (le phénix passe du jaune poussin au rouge feu), sinon celle achetée en boutique
    var natural = ({ phenix: Math.round(50 - lvl * 4.6), renard: 22, lezard: 100, meduse: 158, horus: 36, lapin: 28, requin: 205 })[sp];
    if (natural === undefined) natural = leg ? 12 : 26;
    var col = (!o && st.color) || 'orange', hue = col === 'orange' ? natural : HUES[col];
    if (col === 'or') { s = Math.min(100, s + 10); lf += 6; }
    var rb = !o && rainbow() ? 'hsl(' + Math.round(T * 120) % 360 + ',100%,60%)' : null;
    var c = {
      O: 'hsl(' + hue + ',' + s + '%,' + (48 + lf) + '%)', L: 'hsl(' + (hue + 12) + ',' + s + '%,' + (64 + lf) + '%)', D: 'hsl(' + (hue - 10) + ',' + s + '%,' + (34 + lf) + '%)',
      B: '#ffe9b8', b: '#e2be86', W: '#ffffff', K: K, V: '#7a3ae0', v: '#4a1c9a', H: '#fff3d0', T: '#ffffff',
      M: 'hsl(' + (hue - 14) + ',' + Math.min(100, s + 10) + '%,' + (24 + lf) + '%)', // marques sombres de prédateur
      S: rb || (leg ? (col === 'or' ? '#ff4f6f' : '#ffd23f') : SPIKES[col])
    };
    if (sp === 'phenix') {
      c.B = '#fff3b0'; c.b = '#e8d080'; c.H = '#ffb02e';
      c.V = 'hsl(' + (hue - 6) + ',' + s + '%,' + (40 + lf) + '%)'; c.v = 'hsl(' + (hue - 14) + ',' + s + '%,' + (30 + lf) + '%)';
      c.S = rb || (leg ? '#ffd23f' : 'hsl(' + (hue + 18) + ',100%,' + (58 + lf) + '%)');
    } else if (sp === 'renard') {
      c.B = '#ffffff'; c.b = '#d8d8e8'; c.S = '#8a2a4a'; c.M = leg ? '#5ef2ff' : '#c8204a'; // marques de kitsune
      c.T = rb || (leg ? '#5ef2ff' : '#ffffff');
    } else if (sp === 'lezard') {
      c.B = '#f0e2a0'; c.b = '#c8b46a'; c.S = rb || (leg ? '#ffd23f' : '#ff5a3a');
      c.V = leg ? '#ff3d6e' : '#ff7a2e'; c.v = '#8a1030';
    } else if (sp === 'meduse') { // peau de jade pâle, chevelure de serpents vert sombre à têtes claires
      c.O = 'hsl(' + hue + ',' + Math.round(s * 0.6) + '%,' + (60 + lf) + '%)'; c.L = 'hsl(' + hue + ',' + Math.round(s * 0.6) + '%,' + (74 + lf) + '%)'; c.D = 'hsl(' + hue + ',' + Math.round(s * 0.6) + '%,' + (44 + lf) + '%)';
      c.B = '#f0f8e0'; c.b = '#b8d0a0'; c.H = '#ffd23f';
      c.S = rb || (leg ? '#14806a' : '#1f6a34'); c.T = leg ? '#5ef2c8' : '#7dd45a';
      c.V = leg ? '#0e4a52' : '#1a4a2a'; c.v = leg ? '#2a9a8a' : '#3a7a4a';
    } else if (sp === 'lapin') { // pelage gris-beige peu saturé, intérieur des oreilles rose, piercings en or
      var ls = Math.round(s * (col === 'orange' ? 0.42 : 0.8));
      c.O = 'hsl(' + hue + ',' + ls + '%,' + (60 + lf) + '%)'; c.L = 'hsl(' + hue + ',' + ls + '%,' + (76 + lf) + '%)'; c.D = 'hsl(' + hue + ',' + ls + '%,' + (44 + lf) + '%)';
      c.B = '#fff6ec'; c.b = '#d8c8b8'; c.S = rb || '#ff9ab8'; c.H = '#ffd23f'; c.T = '#e8203a';
      c.M = 'hsl(' + hue + ',' + ls + '%,' + (30 + lf) + '%)';
    } else if (sp === 'requin') { // gris-bleu océan, ventre blanc, dents blanches, aileron royal turquoise
      var rs = Math.round(s * (col === 'orange' ? 0.45 : 0.85));
      c.O = 'hsl(' + hue + ',' + rs + '%,' + (52 + lf) + '%)'; c.L = 'hsl(' + hue + ',' + rs + '%,' + (68 + lf) + '%)'; c.D = 'hsl(' + hue + ',' + rs + '%,' + (36 + lf) + '%)';
      c.M = 'hsl(' + hue + ',' + rs + '%,' + (30 + lf) + '%)';
      c.B = '#f4f8ff'; c.b = '#e8c8c8'; c.S = rb || (leg ? '#ffd23f' : '#5ef2ff');
      c.V = leg ? '#1ac8d8' : '#2a8aff'; c.v = leg ? '#0a5a7a' : '#14407a';
    } else if (sp === 'horus') {
      c.B = '#f8f4e8'; c.b = '#d8ccb0'; c.H = rb || '#ffd23f'; c.S = leg ? '#b0782e' : '#8a5428';
      c.V = '#2a5ad8'; c.v = '#1a2a8a'; c.M = '#14206a'; c.T = leg ? '#ff8a1f' : '#ff3d2e';
    }
    return c;
  }


  // Dessin d'un pixel du sprite, avec miroir (regard à gauche) et respiration (haut du corps)
  var ox = 0, oy = 0, curGW = 0, curHip = 0, curBob = 0, flip = false;
  function D(x, y, col) {
    if (y < curHip) y += curBob;
    if (flip) x = curGW - 1 - x;
    g.fillStyle = col; g.fillRect(ox + x * C, oy + y * C, C, C);
  }
  function row(y, x0, x1, col) { for (var x = x0; x <= x1; x++) D(x, y, col); }

  // Yeux féroces : forme en amande, pupille fendue, arcade sourcilière qui plonge vers le museau.
  // Chaque motif fait 6 x 5 pixels, à partir de (ex - 1, ey). K = contour, W = blanc, G = iris, S = pupille fendue.
  var EYES = {
    normal: ['KKK...', 'KWGKK.', 'KWGSGK', '.KGSGK', '..KKK.'],
    happy:  ['KKK...', '.KKKK.', '.WGSGK', '..KKK.', '......'],
    blink:  ['KKK...', '..KKK.', '.KKKKK', '......', '......'],
    sad:    ['....KK', '..KK..', 'KWGSGK', '.KGSGK', '..KKK.'],
    dead:   ['K...K.', '.K.K..', '..K...', '.K.K..', 'K...K.']
  };
  function drawEye(ex, ey, kind) {
    var sp = speciesOf(st);
    var G = sp === 'meduse' && cre.stage >= 6 ? '#5ef2ff' : cre.stage === 9 ? '#ffc21a' : ({ dino: '#3fd46a', phenix: '#ff7a2e', renard: '#ffd23f', lezard: '#ff4f6f', meduse: '#7dff7a', horus: '#2a8aff', lapin: '#ff3d4a', requin: '#ffd23f' })[sp];
    var pal = { K: K, W: '#fff4d8', G: G, S: K };
    var pat = kind === 'dead' ? EYES.dead : (cre.blink > 0 || kind === 'sleep') ? EYES.blink : kind === 'happy' ? EYES.happy : kind === 'sad' ? EYES.sad : EYES.normal;
    for (var y = 0; y < 5; y++) for (var x = 0; x < 6; x++) { var c = pat[y][x]; if (c !== '.') D(ex - 1 + x, ey + y, pal[c]); }
    if (kind === 'sad') D(ex + 1, ey + 6 + ((T * 6 | 0) % 5), '#5ef2ff');
  }
  // Gueule : crocs au repos, sourire carnassier plein de dents, mâchoires dentées quand il mange
  function drawMouth(m, kind) {
    var x0 = m[0], x1 = m[1], y = m[2], x, F = '#fff4d8';
    var sp = speciesOf(st);
    if (sp === 'lezard' && kind !== 'dead' && kind !== 'sad' && (T % 3.2) < 0.35) { // langue fourchue qui goûte l'air
      var tg = '#ff4f6f'; D(x1 + 1, y, tg); D(x1 + 2, y, tg); D(x1 + 3, y - 1, tg); D(x1 + 3, y + 1, tg);
    }
    if (sp === 'phenix' || sp === 'horus') { // un bec, pas des crocs : simple fente, entrouverte quand il est content ou mange
      row(y, x0, x1, K);
      if (kind === 'happy' || cre.eat > 0 && (cre.eat * 10 | 0) % 2 === 0) { row(y + 1, x0 + 1, x1 - 2, '#5a0a1a'); row(y + 2, x0 + 1, x1 - 2, K); }
      return;
    }
    if (cre.eat > 0 && (cre.eat * 10 | 0) % 2 === 0) {
      row(y, x0, x1, K);
      for (x = x0; x <= x1; x++) D(x, y + 1, (x - x0) % 2 ? '#5a0a1a' : F);
      row(y + 2, x0 + 1, x1 - 1, '#5a0a1a'); D(x0, y + 2, K); D(x1, y + 2, K);
      for (x = x0 + 1; x <= x1; x++) D(x, y + 3, (x - x0) % 2 ? F : '#5a0a1a');
      row(y + 4, x0, x1, K);
      return;
    }
    if (kind === 'happy') {
      row(y, x0 - 1, x1, K);
      for (x = x0; x <= x1; x++) D(x, y + 1, (x - x0) % 2 ? K : F);
      row(y + 2, x0 + 1, x1 - 1, K);
    } else if (kind === 'sad') { row(y, x0, x1, K); D(x0 - 1, y + 1, K); D(x1 - 1, y + 1, F); }
    else if (kind === 'dead') { row(y, x0, x1, K); D(x1 - 2, y + 1, '#ff4f6f'); D(x1 - 2, y + 2, '#ff4f6f'); }
    else { row(y, x0, x1, K); D(x1 - 1, y + 1, F); D(x1 - 3, y + 1, F); if (x1 - x0 >= 5) D(x0 + 1, y + 1, F); }
  }

  // Aura dorée qui pulse autour de la légende (silhouette décalée dans 4 directions)
  function drawAura(grid, sd, rgb) {
    var a = (rgb ? 0.24 : 0.16) + 0.12 * Math.sin(T * (rgb ? 7 : 4));
    g.fillStyle = 'rgba(' + (rgb || '255,210,63') + ',' + a.toFixed(3) + ')';
    for (var y = 0; y < sd.gh; y++) for (var x = 0; x < sd.gw; x++) {
      if (grid[y][x] !== 'K') continue;
      var yy = y < curHip ? y + curBob : y, xx = flip ? curGW - 1 - x : x;
      g.fillRect(ox + xx * C - C, oy + yy * C - C, C * 3, C * 3);
    }
  }
  // Flamme qui crépite au bout de la queue
  function drawFlame(tx, ty) {
    var cols = ['#fff3a0', '#ffd23f', '#ff8a1f', '#ff3d2e'], h = 5 + ((T * 12 | 0) % 2);
    for (var y = 0; y < h; y++) {
      var w = Math.max(1, Math.round((h - y) * 0.6)), sway = Math.round(Math.sin(T * 10 + y) * (y / h) * 1.5);
      for (var x = -w; x <= w; x++) {
        var d = Math.abs(x) / (w + 1) + y / h;
        D(tx + x + sway, ty - y, cols[Math.min(3, Math.floor(d * 2.2))]);
      }
    }
  }
  // Regard pétrifiant de la gorgone (niveau 7+) : un rayon qui part de l'œil et balaie le décor
  function drawGaze(sd) {
    var a = Math.sin((T % 7) * Math.PI), ex = sd.eye[0] + 4, ey = sd.eye[1] + 2;
    g.globalAlpha = 0.55 * a;
    for (var d = 0; d < 46; d++) {
      var w = Math.floor(d / 7);
      for (var k = -w; k <= w; k++) if ((d + k + Math.floor(T * 20)) % 3) D(ex + d, ey + k, Math.abs(k) === w ? '#5ef2ff' : '#d8fff8');
    }
    g.globalAlpha = 1;
  }
  // Taches de boue quand il est sale, et des mouches quand c'est vraiment grave
  function drawDirt(grid, sd) {
    var mod = st.clean < 15 ? 7 : 13;
    for (var y = 0; y < sd.gh; y++) for (var x = 0; x < sd.gw; x++) {
      var ch = grid[y][x];
      if ((ch === 'O' || ch === 'L' || ch === 'D' || ch === 'B') && (((x * 73856093) ^ (y * 19349663)) >>> 0) % mod === 0) D(x, y, '#6a4628');
    }
    if (st.clean < 15) for (var i = 0; i < 2; i++) {
      var a = T * (5 + i * 2) + i * 3;
      D(sd.eye[0] + Math.round(Math.cos(a) * 9), sd.eye[1] - 4 + Math.round(Math.sin(a * 1.4) * 3), '#111');
    }
  }
  // Accessoires achetés en boutique, ancrés sur la tête, l'œil ou le cou du sprite
  function drawAccessories(sd) {
    var a = st.acc, tx = sd.top[0], ty = sd.top[1], x, y, px = [];
    // Les pixels sont d'abord collectés, puis dessinés avec un contour sombre pour rester lisibles sur toutes les couleurs
    function P(x, y, col) { px.push([x, y, col]); }
    function R(y, x0, x1, col) { for (var x = x0; x <= x1; x++) P(x, y, col); }
    if (a.head === 'chapeau') {
      R(ty - 1, tx - 5, tx + 4, '#1a1a2e');
      for (y = ty - 7; y <= ty - 2; y++) R(y, tx - 3, tx + 2, y === ty - 3 ? '#e43b44' : '#2a2a44');
      for (y = ty - 7; y <= ty - 4; y++) P(tx - 3, y, '#5a5a7a');
    } else if (a.head === 'bonnet') {
      R(ty - 1, tx - 5, tx + 4, '#f4f4ff');
      R(ty - 2, tx - 4, tx + 3, '#e43b44'); R(ty - 3, tx - 4, tx + 3, '#e43b44'); R(ty - 4, tx - 3, tx + 2, '#e43b44');
      for (x = tx - 4; x <= tx + 3; x += 2) P(x, ty - 3, '#ffffff');
      R(ty - 6, tx - 1, tx, '#ffffff'); R(ty - 5, tx - 1, tx, '#ffffff');
    } else if (a.head === 'couronne') {
      R(ty - 1, tx - 4, tx + 3, '#ffd23f'); R(ty - 2, tx - 4, tx + 3, '#ffd23f');
      [tx - 4, tx - 1, tx, tx + 3].forEach(function (cx) { P(cx, ty - 3, '#ffd23f'); P(cx, ty - 4, '#ffe98a'); });
      P(tx - 2, ty - 2, '#e43b44'); P(tx + 1, ty - 2, '#5ef2ff');
    }
    var nx = sd.neck[0], ny = sd.neck[1];
    if (a.neck === 'noeud') {
      [[-3, -1], [-2, -1], [2, -1], [3, -1], [-3, 0], [-2, 0], [-1, 0], [1, 0], [2, 0], [3, 0], [-3, 1], [-2, 1], [2, 1], [3, 1]].forEach(function (q) { P(nx + q[0], ny + q[1], '#e43b44'); });
      P(nx, ny, '#8a1020');
    } else if (a.neck === 'echarpe') {
      for (x = nx - 4; x <= nx + 3; x++) { var c = (x >> 1) % 2 ? '#e43b44' : '#f4f4ff'; P(x, ny, c); P(x, ny + 1, c); }
      for (y = ny + 2; y <= ny + 5; y++) { P(nx - 3, y, y % 2 ? '#e43b44' : '#f4f4ff'); P(nx - 2, y, y % 2 ? '#e43b44' : '#f4f4ff'); }
    }
    var set = {};
    px.forEach(function (q) { set[q[0] + ',' + q[1]] = 1; });
    px.forEach(function (q) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { if (!set[(q[0] + d[0]) + ',' + (q[1] + d[1])]) D(q[0] + d[0], q[1] + d[1], K); });
    });
    px.forEach(function (q) { D(q[0], q[1], q[2]); });
    if (a.face === 'lunettes') {
      var ex = sd.eye[0], ey = sd.eye[1];
      for (y = ey + 1; y <= ey + 4; y++) row(y, ex - 1, ex + 4, K);
      for (y = ey + 2; y <= ey + 3; y++) row(y, ex, ex + 3, '#26265a');
      D(ex, ey + 2, '#8a8aff'); row(ey + 2, ex - 4, ex - 2, K); D(ex + 5, ey + 2, K);
    }
  }
  // ---------- Œuf : éclosion après une mort, ou œuf mystère acheté en boutique ----------
  var EGG_TIME = 3.6;
  function startEgg(data, morph) {
    cre.egg = EGG_TIME; cre.eggMorph = morph; cre.eggCrack = 0;
    cre.evo = 0; cre.stage = -1; cre.emote = null; cre.jy = 0; cre.vy = 0; cre.dash = 0;
    Audio8.fx('evo');
    setDialog('SYSTÈME', morph ? st.name + ' se transforme en œuf mystère… Qu’est-ce qui va en sortir ?' : 'Un œuf ! Il bouge… il va éclore !', EGG_TIME * 1000 + 300, true);
  }
  function updateEgg(dt) {
    cre.egg -= dt;
    var crack = cre.egg < EGG_TIME * 0.25 ? 3 : cre.egg < EGG_TIME * 0.5 ? 2 : cre.egg < EGG_TIME * 0.75 ? 1 : 0;
    if (crack > cre.eggCrack) { cre.eggCrack = crack; Audio8.fx('deny'); shake = 0.15; spawnSparks(cre.x, groundY - 18 * C, 6, '#fff4d8'); }
    if (cre.egg > 0) return;
    cre.egg = 0;
    Audio8.fx('hatch'); flash(); shake = 0.4; jump(170);
    spawnSparks(cre.x, groundY - 15 * C, 50);
    spawnSparks(cre.x, groundY - 10 * C, 16, '#fff4d8'); // éclats de coquille
    setDialog('SYSTÈME', 'C’est ' + SPECIES[speciesOf(st)].name + ' ! Bonjour, ' + st.name + ' !' + (cre.eggMorph ? ' Retour au niveau 1.' : ''), 6000, true);
  }
  // Œuf en pixels : coquille crème à taches, qui tremble de plus en plus et se fissure
  function drawEgg() {
    var EW = 17, EH = 21, cx = 8, cy = 12, p = 1 - cre.egg / EGG_TIME, u = C;
    var amp = reduce ? 0 : p < 0.3 ? 0.6 : p < 0.7 ? 1.4 : 2.4, wob = Math.sin(T * (8 + p * 18)) * amp;
    var x0 = Math.round(cre.x - EW * u / 2), y0 = groundY - EH * u;
    var cracks = [[2, 9], [3, 8], [4, 9], [5, 10], [6, 9], [7, 8], [8, 9], [9, 10], [10, 9], [11, 8], [12, 9], [13, 10], [14, 9]];
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(Math.round(cre.x - 6 * u), groundY - u, 12 * u, u);
    for (var y = 0; y < EH; y++) {
      var sh = Math.round(wob * (1 - y / EH)); // le haut oscille, la base reste posée
      for (var x = 0; x < EW; x++) {
        var dx = (x - cx) / 8.5, dy = (y - cy) / (y < cy ? 12 : 9), r = dx * dx + dy * dy;
        if (r > 1) continue;
        var col = r > 0.78 ? K : (x - cx) > 4 - (y - cy) * 0.3 ? '#e2cfa6' : '#fff4d8';
        if (col !== K && ((x - 5) * (x - 5) + (y - 6) * (y - 6) < 3 || (x - 11) * (x - 11) + (y - 13) * (y - 13) < 4 || (x - 4) * (x - 4) + (y - 15) * (y - 15) < 2)) col = cre.eggMorph ? '#b23aff' : '#3fd46a';
        if (col !== K && x > 3 && x < 7 && y > 3 && y < 6 && (x + y) % 2) col = '#ffffff'; // reflet
        g.fillStyle = col; g.fillRect(x0 + (x + sh) * u, y0 + y * u, u, u);
      }
    }
    // fissures : de plus en plus longues
    var n = [0, 4, 8, 13][cre.eggCrack || 0];
    g.fillStyle = K;
    for (var i = 0; i < n; i++) {
      var c = cracks[i], s2 = Math.round(wob * (1 - c[1] / EH));
      g.fillRect(x0 + (c[0] + s2) * u, y0 + c[1] * u, u, u);
    }
    return { x: cre.x, y: y0 + 10 * u, top: y0 };
  }
  function drawCreature() {
    if (cre.egg > 0) return drawEgg();
    var si = cre.stage < 0 ? 0 : cre.stage;
    var evoWhite = false;
    if (cre.evo > 0) {
      var e = EVO_TIME - cre.evo, ph = Math.floor(e * e * 5) % 2;
      if (ph) si = cre.evoFrom;
      evoWhite = true;
    }
    var key = sprKey(si), sd = SPRITES[key];
    var big = SPRITES[sprKey(Math.max(si, cre.stage))];
    C = (groundY - hudBottom >= big.gh * 2 + 10 && big.gw * 2 <= W * 0.6) ? 2 : 1;
    var kind = cre.eat > 0 ? 'happy' : asleep() ? 'sleep' : moodOf(st);
    var pose = 'idle', bob = 0;
    if (cre.walking) { var f = Math.floor(cre.walkT * 8) % 4; pose = f === 0 ? 'w1' : f === 2 ? 'w2' : 'idle'; bob = f % 2; }
    else if (kind === 'sad') bob = 1;
    else if (kind !== 'dead' && !reduce) bob = Math.floor(T * (kind === 'sleep' ? 0.8 : 1.4)) % 2;
    if (cre.jy > 0) { pose = 'w1'; bob = 0; }
    var em = cre.emote && kind !== 'dead' && kind !== 'sleep' ? cre.emote : null, emt = em ? T - em.t0 : 0;
    if (em && cre.jy <= 0) {
      if (em.k === 'laugh') { bob = Math.floor(T * 12) % 2; kind = 'happy'; }
      else if (em.k === 'squat') bob = Math.floor(emt / 0.4) % 2 ? 2 : 0;          // le haut du corps descend : flexion
      else if (em.k === 'dance') { bob = Math.floor(T * 5) % 2; pose = Math.floor(T * 5) % 2 ? 'w1' : 'w2'; kind = 'happy'; }
      else if (em.k === 'read') bob = 0;
      else if (em.k === 'sprint') { var sf = Math.floor(cre.walkT * 8) % 4; pose = sf === 0 ? 'w1' : sf === 2 ? 'w2' : 'idle'; bob = sf % 2; }
      else if (em.k === 'flex') { bob = Math.floor(T * 8) % 2; kind = 'happy'; }
      else if (em.k === 'roar') bob = Math.floor(T * 16) % 2;
      else if (em.k === 'sneeze' && emt < 0.45) kind = 'sleep'; // yeux plissés juste avant l'éternuement
    }
    var float = kind === 'dead' ? 6 + Math.round(Math.sin(T * 1.5) * 3) : 0;

    curGW = sd.gw; curHip = sd.hip; curBob = bob; flip = cre.dir < 0;
    ox = Math.round(cre.x - sd.gw * C / 2);
    oy = Math.round(groundY - (sd.gh - 1) * C - cre.jy) - float * C;

    // ombre
    var sw = Math.max(4, Math.round(sd.gw * 0.55) - Math.round((cre.jy + float * C) / C / 3));
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(Math.round(cre.x - sw * C / 2), groundY - C, sw * C, C);
    g.fillRect(Math.round(cre.x - (sw - 4) * C / 2), groundY, (sw - 4) * C, C);

    var grid = spriteGrid(key, pose), cols = creCols();
    var legend = si === 9 && kind !== 'dead' && !evoWhite;
    if (speciesOf(st) === 'lapin' && si >= 5 && kind !== 'dead' && !evoWhite) drawAura(grid, sd, si === 9 ? '255,79,200' : '255,50,80');
    else if (legend) drawAura(grid, sd);
    if (em && em.k === 'sprint') { // effet de vitesse : traits de vent et images rémanentes derrière la créature
      var ox0 = ox, back = flip ? 1 : -1, gx, gy;
      for (gy = 0; gy < 7; gy++) {
        var ly = oy + Math.round(sd.gh * C * (0.15 + gy * 0.12)), seedL = (Math.floor(T * 20) + gy * 7) % 5;
        var len = (18 + seedL * 9) * C, lx = cre.x + back * (sd.gw * C * 0.35 + 4 * C + seedL * 3 * C);
        g.fillStyle = gy % 2 ? 'rgba(255,255,255,.7)' : 'rgba(94,242,255,.6)';
        g.fillRect(Math.round(back > 0 ? lx : lx - len), ly, len, C);
      }
      [[16, 0.18], [8, 0.35]].forEach(function (gh) {
        ox = ox0 + back * gh[0] * C; g.globalAlpha = gh[1];
        for (gy = 0; gy < sd.gh; gy++) for (gx = 0; gx < sd.gw; gx++) { var gc = grid[gy][gx]; if (gc !== '.' && gc !== 'K') D(gx, gy, cols[gc]); }
      });
      ox = ox0; g.globalAlpha = 1;
    }
    if (kind === 'dead') g.globalAlpha = 0.85;
    for (var y = 0; y < sd.gh; y++) for (var x = 0; x < sd.gw; x++) {
      var ch = grid[y][x]; if (ch === '.') continue;
      D(x, y, evoWhite ? (ch === 'K' ? '#5ef2ff' : '#ffffff') : cols[ch]);
    }
    if (!evoWhite) {
      drawEye(sd.eye[0], sd.eye[1], kind);
      drawMouth(sd.mouth, kind === 'sleep' ? 'ok' : kind);
      if (sd.nose) D(sd.nose[0], sd.nose[1], K);
      if (st && !st.dead && st.clean < 35) drawDirt(grid, sd);
      if (st && st.acc) drawAccessories(sd);
      if (em && em.k === 'squat') { // barre d'haltère posée sur les épaules (elle descend et remonte avec le haut du corps)
        var hy = sd.neck[1] - 2, hx0 = sd.neck[0] - 11, hx1 = sd.neck[0] + 9, yy;
        for (var hx = hx0 - 1; hx <= hx1 + 1; hx++) { D(hx, hy - 1, K); D(hx, hy, '#f0f0ff'); D(hx, hy + 1, '#a8a8c0'); D(hx, hy + 2, K); }
        [hx0 - 4, hx1 + 2].forEach(function (px0) { // gros disques rouges aux deux bouts
          for (yy = hy - 5; yy <= hy + 6; yy++) { D(px0 - 1, yy, K); D(px0, yy, '#ff7a7a'); D(px0 + 1, yy, '#e43b44'); D(px0 + 2, yy, '#a01828'); D(px0 + 3, yy, K); }
          for (var xx = px0 - 1; xx <= px0 + 3; xx++) { D(xx, hy - 6, K); D(xx, hy + 7, K); }
        });
      }
      if (em && em.k === 'read') { // livre ouvert tenu devant la gueule
        var bk = { W: '#fff8e8', L: '#a8a0c8', K: '#3a2410', B: '#8a2a2a' }, bx = sd.mouth[0] - 2, by = sd.mouth[2] + 2;
        for (var ry = 0; ry < BOOK.length; ry++) for (var rx = 0; rx < BOOK[ry].length; rx++) { var bc = BOOK[ry][rx]; if (bc !== '.') D(bx + rx, by + ry, bk[bc]); }
      }
      if (legend && sd.flame && sd.tail) drawFlame(sd.tail[0], sd.tail[1]);
      if (speciesOf(st) === 'meduse' && si >= 6 && kind !== 'dead' && kind !== 'sleep' && (T % 7) < 1) drawGaze(sd);
      if (kind === 'dead') {
        var hx = sd.halo[0], ht = sd.halo[1], gold = '#ffe25e';
        row(ht - 4, hx - 5, hx + 5, gold); row(ht - 2, hx - 5, hx + 5, gold); D(hx - 6, ht - 3, gold); D(hx + 6, ht - 3, gold);
      }
    }
    g.globalAlpha = 1;
    var mx = (sd.mouth[0] + sd.mouth[1]) / 2;
    return { x: ox + (flip ? sd.gw - 1 - mx : mx) * C, y: oy + (sd.mouth[2] + bob) * C, top: oy + sd.halo[1] * C };
  }

  // ---------- Petites animations au hasard (quand la créature n'a rien d'autre à faire) ----------
  // Chaque espèce peut tout faire ; le rire et les gestes « de costaud » dépendent du niveau.
  var EMOTE_DUR = { sprint: 8, jump: 0.9, laugh: 1.4, sneeze: 1.3, dance: 5, read: 5.5, squat: 3.4, flex: 1.8, roar: 1.6 };
  var BOOK = ['.WWWKWWW.', 'WLLLKLLLW', 'WWLLKLLWW', 'WLLLKLLLW', 'WWWWKWWWW', '.BBBBBBB.'];
  var NOTE = ['..KK', '..K.', '..K.', 'KKK.', 'KK..'];
  function pickEmote() {
    var lv = Math.max(0, cre.stage), pool = ['jump', 'jump', 'laugh', 'laugh', 'sneeze', 'dance', 'read'];
    var fours = { lezard: 1, renard: 1 }[speciesOf(st)] || ((speciesOf(st) === 'lapin' || speciesOf(st) === 'requin') && lv < 4); // à quatre pattes : pas de squats
    if (lv >= 3 && !fours) pool.push('squat', 'squat');
    if (lv >= 2 && fours) pool.push('sprint', 'sprint'); // les quadrupèdes font un sprint à la place
    if (lv >= 5) pool.push('flex');
    if (lv >= 6) pool.push('roar');
    if ((speciesOf(st) === 'lapin' || speciesOf(st) === 'requin') && lv >= 4) pool.push('squat', 'flex', 'flex');
    return pool[Math.random() * pool.length | 0];
  }
  function startEmote(k) {
    var lv = Math.max(0, cre.stage);
    cre.emote = { k: k, t0: T, dur: EMOTE_DUR[k] + (k === 'laugh' && lv >= 8 ? 0.8 : 0), beat: 0 };
    if (k === 'jump') { jump(150); Audio8.fx('jump'); }
    else if (k === 'laugh') {
      var tier = lv >= 8 ? 3 : lv >= 3 ? 2 : 1;
      Audio8.fx('laugh' + tier);
      floatText(['HIHI !', 'HA HA HA !', 'MWAHAHAHA !'][tier - 1], ['#ffd2f0', '#ffe25e', '#ff4f6f'][tier - 1]);
      if (tier === 3) shake = 0.5;
    } else if (k === 'sneeze') Audio8.fx('sneeze');
    else if (k === 'sprint') { cre.dir = cre.x < playCx ? -1 : 1; Audio8.fx('dash'); floatText('ZOOM !', '#5ef2ff'); } // part vers le bord le plus proche
    else if (k === 'read') { Audio8.fx('page'); floatText('…', '#d8d4ff'); }
    else if (k === 'flex') { Audio8.fx('flex'); floatText('FLEX !', '#ffd23f'); spawnSparks(cre.x, mouth.y + 8 * C, 14, '#ffd23f'); }
    else if (k === 'roar') { Audio8.fx('roar'); floatText('ROAAAR !', '#ff8a1f'); shake = 0.6; }
  }
  function updateEmote(dt) {
    var e = cre.emote; if (!e) return;
    var et = T - e.t0;
    if (e.k === 'sprint') {
      // Sprint : sort de l'écran d'un côté, réapparaît de l'autre et freine au milieu
      var sp = 150 + Math.min(1, et * 2) * 60;
      cre.x += cre.dir * sp * dt; cre.walkT += dt * 2.5;
      if (Math.random() < dt * 30) parts.push({ k: 'spark', x: cre.x - cre.dir * 10 * C, y: groundY - 2 - Math.random() * 3, vx: -cre.dir * (20 + Math.random() * 30), vy: -10 - Math.random() * 15, gr: 60, life: 0.4, col: '#d8c8a8' });
      if (!e.wrapped && (cre.x > W + 50 || cre.x < -50)) { e.wrapped = true; cre.x = cre.dir > 0 ? -50 : W + 50; Audio8.fx('dash'); }
      if (e.wrapped && Math.abs(cre.x - playCx) < 6) { cre.emote = null; cre.tx = cre.x; cre.wait = 1.5; spawnSparks(cre.x, groundY - 2, 10, '#d8c8a8'); }
      else if (et >= e.dur) { cre.emote = null; cre.x = playCx; cre.tx = cre.x; }
      return;
    }
    if (e.k === 'sneeze' && !e.done && et > 0.45) { e.done = true; floatText('ATCHOUM !', '#9fffb0'); spawnBubbles(5); jump(60); }
    else if (e.k === 'dance') {
      if (Math.floor(et / 0.4) !== e.beat) { e.beat = Math.floor(et / 0.4); cre.dir = -cre.dir; }
      if (Math.random() < dt * 3) parts.push({ k: 'note', x: cre.x + (Math.random() - 0.5) * 20 * C, y: mouth.top + 6 * C, vx: (Math.random() - 0.5) * 20, vy: -25, gr: 0, life: 1.4, col: ['#ff9ad0', '#5ef2ff', '#ffe25e', '#7dff7a'][Math.random() * 4 | 0] });
    } else if (e.k === 'squat') {
      var rep = Math.floor(et / 0.8);
      if (rep !== e.beat && rep < 4) { e.beat = rep; if (rep > 0) { Audio8.fx('grunt'); floatText('SQUAT ' + rep + ' !', '#ffffff'); } }
    } else if (e.k === 'read' && Math.floor(et / 1.6) !== e.beat) { e.beat = Math.floor(et / 1.6); Audio8.fx('page'); }
    if (et >= e.dur) cre.emote = null;
  }

  // Boule disco pendant la danse : elle descend du plafond, tourne, et projette des taches de couleur
  var DISCO_COLS = ['#ff4fa0', '#5ef2ff', '#ffe25e', '#7dff7a', '#b06bff'];
  function drawDisco(e, front) {
    var et = T - e.t0, dur = e.dur, drop = Math.min(1, et / 0.5, (dur - et) / 0.5);
    if (drop <= 0) return;
    if (e.cx === undefined) e.cx = Math.round(cre.x);
    var r = 5 + 3 * C, cx = e.cx, cy = Math.round(-r - 4 + (Math.max(hudBottom + 12, mouth.top - 30) + r + 4) * drop), i, x, y;
    if (!front) {
      g.fillStyle = 'rgba(20,0,40,' + (0.32 * drop).toFixed(2) + ')'; g.fillRect(0, 0, W, H); // la lumière baisse
      for (i = 0; i < 8; i++) {
        var a = T * 1.6 + i * Math.PI / 4, sx = Math.round(cx + Math.cos(a) * W * 0.45), sy = Math.round(groundY - 6 - ((Math.sin(a * 1.3) + 1) / 2) * (groundY - cy) * 0.8);
        var col = DISCO_COLS[i % DISCO_COLS.length];
        g.globalAlpha = 0.3 * drop; g.strokeStyle = col; g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx + 0.5, cy + 0.5); g.lineTo(sx + 0.5, sy + 0.5); g.stroke();
        g.globalAlpha = 0.7 * drop; g.fillStyle = col; g.fillRect(sx - 1, sy - 1, 3, 2); g.fillRect(sx, sy - 2, 1, 4);
      }
      g.globalAlpha = 1;
      return;
    }
    g.fillStyle = '#c8c8d8'; g.fillRect(cx, 0, 1, cy - r); // fil
    var spin = Math.floor(T * 10);
    for (y = -r; y <= r; y++) for (x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      var fx = Math.floor((x + r) / C / 1.5), fy = Math.floor((y + r) / C / 1.5), edge = x * x + y * y > (r - 1.5) * (r - 1.5);
      var v = (fx + fy * 3 + spin) % 7;
      g.fillStyle = edge ? '#5a5a7a' : v === 0 ? '#ffffff' : v === 1 ? DISCO_COLS[(fx + spin) % DISCO_COLS.length] : (x + y) % 2 ? '#a8a8c8' : '#d8d8ec';
      g.fillRect(cx + x, cy + y, 1, 1);
    }
    if (spin % 3 === 0) { g.fillStyle = '#ffffff'; g.fillRect(cx - 4, cy - 6, 1, 5); g.fillRect(cx - 6, cy - 4, 5, 1); } // éclat
  }

  // ---------- Particules ----------
  var HEART = ['.WX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  var PIZZA = ['CCCCCCC', 'YRYYYRY', '.YYRYY.', '.YYYYY.', '..YRY..', '..YYY..', '...Y...'];
  var SPR_COL = { X: '#ff4fa0', W: '#ffffff', C: '#c8701e', Y: '#ffd23f', R: '#e43b44' };
  function drawSprite(rows, x, y, s) {
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
      var ch = rows[r][c]; if (ch === '.') continue;
      g.fillStyle = SPR_COL[ch]; g.fillRect(Math.floor(x + c * s), Math.floor(y + r * s), s, s);
    }
  }
  var mouth = { x: 0, y: 0, top: 0 };
  function spawnPizza(s) { parts.push({ k: 'pizza', x: mouth.x - 3.5 * s, y: -12, vx: 0, vy: 30, gr: 240, life: 6, s: s }); }
  function spawnHearts(n, s) {
    for (var i = 0; i < n; i++) parts.push({ k: 'heart', x: cre.x + (Math.random() - 0.5) * 24 * C, y: mouth.top + 6 * C, vx: (Math.random() - 0.5) * 50, vy: -50 - Math.random() * 60, gr: -15, life: 1.3 + Math.random() * 0.7, s: s, sw: Math.random() * 6 });
  }
  function jump(v) { cre.vy = v * (st && st.place && st.place.key === 'espace' ? 0.8 : 1); cre.jy = 0.01; }
  function spawnBubbles(n) {
    for (var i = 0; i < n; i++) parts.push({ k: 'bubble', x: cre.x + (Math.random() - 0.5) * 30 * C, y: groundY - Math.random() * 20 * C, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, gr: 0, life: 1 + Math.random() * 1.2, sw: Math.random() * 6, r: Math.random() < 0.4 ? 2 : 1 });
  }
  function spawnZ(n) {
    for (var i = 0; i < n; i++) parts.push({ k: 'txt', text: i % 2 ? 'z' : 'Z', col: '#aab4ff', x: mouth.x + (Math.random() - 0.3) * 10 * C, y: mouth.top + 4 * C - i * 6, vx: 6 + Math.random() * 6, vy: -16, gr: 0, life: 1.8 });
  }
  function spawnBall() {
    parts.push({ k: 'ball', x: cre.x + cre.dir * 16 * C, y: groundY - 30 * C, vx: cre.dir * 70, vy: -90, gr: 380, life: 3 });
  }
  // Animation de like, visible par tous : pluie de cœurs, gros cœur qui s'envole, le dino saute de joie
  function likeShow(n, forMe) {
    var count = Math.min(40, 10 + n * 6) * (forMe ? 1.6 : 1);
    for (var i = 0; i < count; i++) parts.push({ k: 'heart', x: Math.random() * W, y: -10 - Math.random() * 60, vx: (Math.random() - 0.5) * 20, vy: 30 + Math.random() * 40, gr: 25, life: 3 + Math.random(), s: Math.random() < 0.3 ? 2 : 1, sw: Math.random() * 6 });
    parts.push({ k: 'bigheart', x: cre.x, y: mouth.top, vx: 0, vy: -28, gr: 0, life: 1.6, s: forMe ? 4 : 3 });
    parts.push({ k: 'txt', text: forMe ? 'LIKE POUR TOI !' : 'LIKE!', col: '#ff4f6f', x: cre.x, y: mouth.top - 14, vx: 0, vy: -20, gr: 0, life: 1.8 });
    if (!cre.travel) jump(forMe ? 170 : 130);
    Audio8.fx('like');
    if (forMe) { flash(); spawnSparks(cre.x, groundY - 20 * C, 30, '#ff9ad0'); }
  }
  function spawnSparks(x, y, n, col) {
    for (var i = 0; i < n; i++) parts.push({ k: 'spark', x: x, y: y, vx: (Math.random() - 0.5) * 170, vy: -Math.random() * 150, gr: 320, life: 0.5 + Math.random() * 0.5, col: col || 'hsl(' + (Math.random() * 360 | 0) + ',100%,65%)' });
  }
  function floatText(text, col) { parts.push({ k: 'txt', text: text, col: col, x: cre.x, y: mouth.top - 4 * C, vx: 0, vy: -22, gr: 0, life: 1.4 }); }

  // ---------- Passants bonus : rares, cliquables, +points (plafonnés par le serveur) ----------
  var BONUS_SPR = {
    skieur: { rows: ['...H.....', '...F.....', '..JJJ....', '.PJJJ....', '.P.JJ....', 'P..LL....', '...L.L...', 'SSSSSSSSS'], pal: { H: '#e43b44', F: '#f0c8a0', J: '#3a6ad8', P: '#55556a', L: '#1a1a2e', S: '#ffd23f' } },
    surfeur: { rows: ['..F....', '.JJJ...', 'J.J.J..', '..L....', '.L.L...', 'BBBBBBB'], pal: { F: '#c8805a', J: '#ff5ec8', L: '#1a1a2e', B: '#ffd23f' } },
    astronaute: { rows: ['..WWW..', '.WGGGW.', '.WGGGW.', '..WWW..', 'WWWWWWW', 'W.WWW.W', '..W.W..', '..W.W..'], pal: { W: '#f4f4ff', G: '#ffb02e' } },
    livreur: { rows: ['....F....', '...JJ.BB.', '..JJJJBB.', '...LL....', '.KK...KK.', 'K..K.K..K', '.KK...KK.'], pal: { F: '#f0c8a0', J: '#ffd23f', B: '#e43b44', L: '#1a1a2e', K: '#2a2a3a' } },
    lapin: { rows: ['.W.W...', '.W.W...', '.WWWW..', 'WWKWWW.', 'WWWWWWP', '.W..W..'], pal: { W: '#f4f0ff', K: '#1a0b14', P: '#ff9ad0' } },
    renard: { rows: ['O.......OO', 'OO....OOKO', '.OOOOOOOO.', 'WOWWOOOO..', '.K.K..K.K.'], pal: { O: '#ff8a1f', K: '#1a0b14', W: '#ffffff' } },
    drone: { rows: ['K.......K', 'KKKGGGKKK', '...GYG...', '....R....'], pal: { K: '#2a2a3a', G: '#ffd23f', Y: '#5ef2ff', R: '#ff4f6f' } },
    comete: { rows: ['..Y..', '.YWY.', 'YWWWY', '.YWY.', '..Y..'], pal: { Y: '#ffd23f', W: '#fff8d0' } }
  };
  var BONUS_FOR = { meadow: 'lapin', forest: 'renard', city: 'drone', cosmos: 'comete', mountain: 'skieur', beach: 'surfeur', moon: 'astronaute', town: 'livreur' };
  var BONUS_LABEL = { skieur: 'le skieur', surfeur: 'le surfeur', astronaute: 'l’astronaute', livreur: 'le livreur', lapin: 'le lapin', renard: 'le renard', drone: 'le drone', comete: 'la comète' };
  var bonus = null;
  function bonusReady() {
    return started && st && !st.dead && st.me && st.me.bonusLeft > 0 && Date.now() + offset >= st.me.bonusAt;
  }
  function spawnBonus() {
    var kind = BONUS_FOR[scene.kind] || 'comete', sp = BONUS_SPR[kind], dir = Math.random() < 0.5 ? 1 : -1;
    if (kind === 'skieur' || kind === 'livreur' || kind === 'surfeur') dir = 1;
    bonus = { kind: kind, dir: dir, t: 0, x: dir > 0 ? -24 : W + 24, y: 0, w: sp.rows[0].length * 2, h: sp.rows.length * 2, sp: kind === 'astronaute' ? 14 : kind === 'comete' ? 45 : 32 };
  }
  function updateBonus(dt) {
    if (!bonus) {
      // En moyenne un passant toutes les ~4 min, seulement quand le serveur accepterait le bonus
      if (bonusReady() && !cre.travel && cre.evo <= 0 && !shopOpen && !document.hidden && Math.random() < dt / 240) spawnBonus();
      return;
    }
    var b = bonus, u;
    b.t += dt; b.x += b.dir * b.sp * dt;
    u = Math.max(0, Math.min(1, b.dir > 0 ? b.x / W : 1 - b.x / W));
    if (b.kind === 'skieur') b.y = groundY * 0.45 + (groundY * 0.55 - 10) * u;
    else if (b.kind === 'surfeur') b.y = groundY * 0.68 + 4 + Math.sin(T * 3) * 2;
    else if (b.kind === 'lapin') b.y = groundY - b.h - Math.abs(Math.sin(T * 6)) * 12;
    else if (b.kind === 'renard' || b.kind === 'livreur') b.y = groundY - b.h;
    else if (b.kind === 'astronaute') b.y = groundY * 0.3 + Math.sin(T * 1.2) * 8;
    else if (b.kind === 'drone') b.y = groundY * 0.35 + Math.sin(T * 2.5) * 4;
    else b.y = groundY * 0.2 + u * groundY * 0.25;
    if (Math.random() < dt * 8) parts.push({ k: 'spark', x: b.x + Math.random() * b.w, y: b.y + Math.random() * b.h, vx: 0, vy: -10, gr: 0, life: 0.5, col: '#ffe25e' });
    if (b.kind === 'skieur' && Math.random() < dt * 25) parts.push({ k: 'spark', x: b.x, y: b.y + b.h, vx: -20, vy: -15, gr: 60, life: 0.4, col: '#ffffff' });
    if (b.x < -40 || b.x > W + 40) bonus = null;
  }
  function drawBonus() {
    if (!bonus) return;
    var b = bonus, sp = BONUS_SPR[b.kind];
    if (b.kind === 'comete') { for (var i = 1; i < 10; i++) { g.fillStyle = 'rgba(255,226,94,' + (0.5 - i * 0.05).toFixed(2) + ')'; g.fillRect(Math.floor(b.x + b.w / 2 - b.dir * i * 3), Math.floor(b.y + b.h / 2 - i * 0.8), 2, 2); } }
    // halo doré qui pulse pour attirer l'œil
    g.fillStyle = 'rgba(255,226,94,' + (0.15 + 0.12 * Math.sin(T * 8)).toFixed(2) + ')';
    g.fillRect(Math.floor(b.x) - 2, Math.floor(b.y) - 2, b.w + 4, b.h + 4);
    var rows = sp.rows;
    if (b.kind === 'drone' && Math.floor(T * 20) % 2) rows = ['.K.....K.'].concat(rows.slice(1));
    spr(rows, sp.pal, b.x, b.y, b.dir < 0, 2);
  }
  // Clic (ou tap) sur le passant : zone de clic généreuse pour les petits écrans
  function bonusHit(clientX, clientY) {
    if (!bonus) return false;
    var r = cv.getBoundingClientRect(), x = (clientX - r.left) / S, y = (clientY - r.top) / S, pad = 8;
    return x >= bonus.x - pad && x <= bonus.x + bonus.w + pad && y >= bonus.y - pad && y <= bonus.y + bonus.h + pad;
  }
  function claimBonus() {
    var b = bonus; bonus = null;
    gaEvent('catch_bonus', { kind: b.kind });
    Audio8.fx('bonus'); spawnSparks(b.x + b.w / 2, b.y + b.h / 2, 24);
    parts.push({ k: 'txt', text: '+20 PTS', col: '#ffe25e', x: b.x + b.w / 2, y: b.y - 4, vx: 0, vy: -18, gr: 0, life: 1.6 });
    call('POST', '/api/bonus', { kind: b.kind }).then(function (r) {
      if (r.code === 200) setDialog('INFO', 'Tu as attrapé ' + BONUS_LABEL[b.kind] + ' ! +' + r.body.gained + ' points.', 5000, true);
      else setDialog('SYSTÈME', 'Trop tard, ce bonus n’est plus disponible.', 3000, true);
      apply(r.body, true);
    }).catch(function () {});
  }

  // ---------- Teasers : d'autres espèces passent au loin, s'arrêtent pour regarder, puis repartent ----------
  var TEASE_LABEL = { dino: 'un dino', phenix: 'un phénix', renard: 'un renard mystique', lezard: 'un lézard géant', meduse: 'une gorgone', horus: 'un dieu-faucon ÉPIQUE', lapin: 'un lapin de combat', requin: 'un requin des terres' };
  var QMARK = ['QQQ', '..Q', '.Q.', '...', '.Q.'];
  var tease = null, teaseNext = 30 + Math.random() * 40;
  function spawnTease(sp) {
    if (!sp) {
      var pool = Object.keys(SPECIES).filter(function (k) { return k !== speciesOf(st) && (!SPECIES[k].epic || Math.random() < 0.3); });
      sp = pool[Math.random() * pool.length | 0];
    }
    var L = 3 + (Math.random() * 7 | 0), key = sp + ':' + L, dir = Math.random() < 0.5 ? 1 : -1;
    if (!SPRITES[key]) SPRITES[key] = spriteDef(sp, L);
    var sd = SPRITES[key];
    tease = { sp: sp, lvl: L - 1, key: key, dir: dir, x: dir > 0 ? -sd.gw : W + sd.gw, walkT: 0, stopAt: W * (0.2 + Math.random() * 0.6), pause: 0, stopped: false };
  }
  function updateTease(dt) {
    if (!tease) {
      teaseNext -= dt;
      if (teaseNext <= 0 && started && st && !cre.travel && cre.evo <= 0 && !document.hidden) { teaseNext = 80 + Math.random() * 120; spawnTease(); }
      return;
    }
    var t = tease, sd = SPRITES[t.key];
    if (t.pause > 0) { t.pause -= dt; return; }
    t.x += t.dir * 14 * dt; t.walkT += dt;
    if (!t.stopped && Math.abs(t.x - t.stopAt) < 1) {
      t.stopped = true; t.pause = 2.5 + Math.random() * 2;
      if (st && !st.dead && Date.now() > dlg.hold) setDialog('SYSTÈME', 'Au loin, ' + TEASE_LABEL[t.sp] + ' sauvage observe ' + st.name + '… Qui sortira du prochain œuf ?', 4500, true);
    }
    if (t.x < -sd.gw - 4 || t.x > W + sd.gw + 4) tease = null;
  }
  function drawTease() {
    if (!tease) return;
    var t = tease, sd = SPRITES[t.key], pose = 'idle', x, y;
    if (t.pause <= 0) { var f = Math.floor(t.walkT * 7) % 4; pose = f === 0 ? 'w1' : f === 2 ? 'w2' : 'idle'; }
    var grid = spriteGrid(t.key, pose), cols = creCols({ sp: t.sp, lvl: t.lvl });
    var face = t.pause > 0 ? (cre.x > t.x ? 1 : -1) : t.dir, fl = face < 0;
    // Posée sur le sol, comme la créature principale (dernière ligne du sprite sur groundY)
    var x0 = Math.round(t.x - sd.gw / 2), y0 = groundY - sd.gh + 1, bob = t.pause <= 0 ? Math.floor(t.walkT * 7) % 2 : 0;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x0 + Math.round(sd.gw * 0.25), groundY - 1, Math.round(sd.gw * 0.5), 1);
    g.globalAlpha = 0.92;
    for (y = 0; y < sd.gh; y++) for (x = 0; x < sd.gw; x++) {
      var ch = grid[y][x]; if (ch === '.') continue;
      g.fillStyle = cols[ch]; g.fillRect(x0 + (fl ? sd.gw - 1 - x : x), y0 + y + (y < sd.hip ? bob : 0), 1, 1);
    }
    var ex = sd.eye[0] + 2, ey = sd.eye[1] + 2 + bob;
    g.fillStyle = '#fff4d8'; g.fillRect(x0 + (fl ? sd.gw - 2 - ex : ex - 1), y0 + ey, 2, 1);
    g.fillStyle = K; g.fillRect(x0 + (fl ? sd.gw - 1 - ex : ex), y0 + ey, 1, 1);
    g.globalAlpha = 1;
    if (t.pause > 0 && Math.floor(T * 3) % 2) spr(QMARK, { Q: '#ffe25e' }, x0 + Math.round(sd.gw / 2) - 1, y0 - 2);
  }

  // ---------- Mini-jeux : une occasion apparaît de temps en temps (bouton clignotant), partie de 20 s ----------
  var GAMES = {
    catch: { name: 'ATTRAPE-MIAM', help: 'Déplace la créature (doigt, souris ou flèches) pour attraper la nourriture. Évite les bombes !' },
    mole: { name: 'TAPE-CORNICHONS', help: 'Tape les cornichons qui sortent des trous. Les dorés valent 3. Surtout pas les bombes !' },
    rhythm: { name: 'DANSE-RYTHME', help: 'Tape (ou ESPACE) quand une note passe dans le cercle. Enchaîne pour le combo !' }
  };
  var GAME_DUR = 20, GAME_INTRO = 2.4, GAME_OUTRO = 3;
  var game = null, gameOffer = null, gameNext = 60 + Math.random() * 90;
  var FOODS = [
    { rows: ['..KK..', '.KYYK.', 'KYRYYK', 'KYYYRK', '.KYYK.', '..KK..'], pal: { K: K, Y: '#ffd23f', R: '#e43b44' } },            // pizza
    { rows: ['.KKKK.', 'KOOOOK', 'KOLOOK', 'KOOOLK', 'KOOOOK', '.KKKK.'], pal: { K: K, O: '#ff8a1f', L: '#ffd28a' } },            // croissant
    { rows: ['...G..', '.KKGK.', 'KRRRRK', 'KRWRRK', 'KRRRRK', '.KKKK.'], pal: { K: K, R: '#e43b44', W: '#ffffff', G: '#3fd46a' } }, // pomme
    { rows: ['.KKKK.', 'KGGGGK', 'KGLGGK', 'KGGLGK', 'KGGGGK', '.KKKK.'], pal: { K: K, G: '#3fd46a', L: '#9aff8a' } }               // cornichon
  ];
  var BOMB = { rows: ['....F.', '...K..', '.KKKK.', 'KKWKKK', 'KKKKKK', 'KKKKKK', '.KKKK.'], pal: { K: '#2a2a3e', W: '#ffffff', F: '#ff8a1f' } };
  var PICKLE = ['.KKK.', 'KGGGK', 'KWGWK', 'KKGKK', 'KGGGK', 'KGLGK', 'KGGGK', 'KGGGK', '.KKK.'];

  function gameOverlayOpen() { return shopOpen || achOpen || hallOpen || nickOpen; }
  function updateGameOffer() {
    var b = $('gameBtn');
    if (game) { b.hidden = true; return; }
    if (gameOffer) {
      if (T > gameOffer.until || !st || st.dead || gameOverlayOpen()) { gameOffer = null; b.hidden = true; gameNext = T + 90 + Math.random() * 120; return; }
      b.querySelector('small').textContent = GAMES[gameOffer.kind].name + ' · ' + Math.ceil(gameOffer.until - T) + ' S';
      return;
    }
    if (started && st && !st.dead && !asleep() && !document.hidden && !gameOverlayOpen() && !cre.travel && !(cre.egg > 0) && T > gameNext) {
      var ks = Object.keys(GAMES);
      gameOffer = { kind: ks[Math.floor(Math.random() * ks.length)], until: T + 12 };
      b.hidden = false; Audio8.fx('bonus');
    }
  }
  function acceptGame() {
    if (!gameOffer || game) return;
    var kind = gameOffer.kind; gameOffer = null; $('gameBtn').hidden = true;
    gameNext = T + 180 + Math.random() * 240;
    call('POST', '/api/game/start', { kind: kind }).then(function (r) {
      if (r.code !== 200) return setDialog('SYSTÈME', 'Pas de mini-jeu possible pour l’instant, réessaie plus tard.', 3000, true);
      beginGame(kind);
    }).catch(function () { setDialog('SYSTÈME', 'Erreur réseau.', 3000, true); });
  }
  function beginGame(kind) {
    gameEvent('game_start', kind);
    gamingUi(true);
    game = { kind: kind, t: 0, score: 0, items: [], spawn: 0.6, combo: 0, px: cre.x, keys: 0, live: true, sent: false, msg: null };
    cre.emote = null; cre.dash = 0; cre.jy = 0; cre.vy = 0; cre.tx = cre.x;
    Audio8.fx('start');
    setDialog('SYSTÈME', GAMES[kind].name + ' : ' + GAMES[kind].help, (GAME_INTRO + 4) * 1000, true);
    if (kind === 'mole') {
      var top = gameTop + 40, bot = groundY - 20, xs = [0.2, 0.5, 0.8];
      game.holes = [];
      [top + (bot - top) * 0.25, top + (bot - top) * 0.75].forEach(function (y) { xs.forEach(function (fx) { game.holes.push({ x: Math.round(playR * fx), y: Math.round(y), it: null }); }); });
    }
    if (kind === 'rhythm') { // partition : une note par temps (120 bpm), avec des trous, et des doubles croches après 10 s
      game.notes = [];
      for (var t = 1; t < GAME_DUR - 0.4; t += 0.5) {
        if (Math.random() < 0.72) game.notes.push({ t: t, hit: false, miss: false });
        if (t > 10 && Math.random() < 0.25) game.notes.push({ t: t + 0.25, hit: false, miss: false });
      }
      game.lane = Math.round(gameTop + 34 + (groundY - gameTop - 34) * 0.3); game.tx = 34;
    }
  }
  // Pendant une partie, le journal est masqué : le jeu prend toute la largeur
  function gamingUi(on) { document.body.classList.toggle('gaming', on); resize(); }
  function gameEvent(name, kind) { gaEvent(name, { game: kind }); }
  function gamePlayT() { return game.t - GAME_INTRO; } // temps de jeu (négatif pendant le compte à rebours)
  function gameFloat(text, col, x, y) { parts.push({ k: 'txt', text: text, col: col, x: x, y: y, vx: 0, vy: -24, gr: 0, life: 0.9 }); }
  function gameAdd(n, x, y) {
    game.score = Math.max(0, game.score + n);
    gameFloat((n > 0 ? '+' : '') + n, n > 0 ? '#7dff7a' : '#ff4f6f', x, y);
  }

  function updateGame(dt) {
    updateGameOffer();
    if (!game) return;
    game.t += dt;
    var pt = gamePlayT(), i;
    if (pt >= GAME_DUR) { finishGame(); if (game && game.t > GAME_INTRO + GAME_DUR + GAME_OUTRO && game.sent) { game = null; gamingUi(false); } return; }
    if (pt < 0) return;
    if (game.kind === 'catch') {
      game.spawn -= dt;
      if (game.spawn <= 0) {
        game.spawn = Math.max(0.32, 0.62 - pt * 0.012) * (0.7 + Math.random() * 0.6);
        var bad = Math.random() < 0.2 + pt * 0.005;
        game.items.push({ x: 18 + Math.random() * (playR - 36), y: gameTop + 26, vy: 45 + Math.random() * 25 + pt * 2.5, bad: bad, f: Math.floor(Math.random() * FOODS.length) });
      }
      for (i = game.items.length - 1; i >= 0; i--) {
        var it = game.items[i]; it.y += it.vy * dt;
        var half = (SPRITES[sprKey(Math.max(0, cre.stage))] || { gw: 40 }).gw * C * 0.4;
        if (it.y >= mouth.top && it.y <= groundY && Math.abs(it.x - cre.x) < half) {
          game.items.splice(i, 1);
          if (it.bad) { gameAdd(-3, it.x, it.y); shake = 0.3; flash('red'); Audio8.fx('deny'); spawnSparks(it.x, it.y, 14, '#ff8a1f'); }
          else { gameAdd(1, it.x, it.y); cre.eat = 0.3; Audio8.fx('chomp'); spawnSparks(it.x, it.y, 6, '#ffd23f'); }
        } else if (it.y > groundY + 4) game.items.splice(i, 1);
      }
    } else if (game.kind === 'mole') {
      game.spawn -= dt;
      if (game.spawn <= 0) {
        game.spawn = Math.max(0.3, 0.75 - pt * 0.02) * (0.7 + Math.random() * 0.6);
        var free = game.holes.filter(function (h) { return !h.it; });
        if (free.length) {
          var h = free[Math.floor(Math.random() * free.length)], r = Math.random();
          h.it = { t: 0, life: Math.max(0.6, 1.1 - pt * 0.025), k: r < 0.17 ? 'bomb' : r < 0.29 ? 'gold' : 'pickle' };
        }
      }
      game.holes.forEach(function (h) { if (h.it) { h.it.t += dt; if (h.it.t > h.it.life) h.it = null; } });
    } else if (game.kind === 'rhythm') {
      if (!cre.emote) startEmote('dance');
      game.notes.forEach(function (n) { if (!n.hit && !n.miss && pt - n.t > 0.18) { n.miss = true; game.combo = 0; } });
    }
  }
  function finishGame() {
    if (game.sent) return;
    game.sent = true; game.live = false; game.items = [];
    if (game.holes) game.holes.forEach(function (h) { h.it = null; });
    var g0 = game;
    Audio8.fx('ach');
    call('POST', '/api/game/end', { score: g0.score }).then(function (r) {
      if (r.code !== 200) { g0.msg = 'PARTIE NON COMPTÉE'; return; }
      g0.msg = (r.body.gameRecord && r.body.gameScore > 0 ? 'RECORD PERSO ! ' : 'MEILLEUR : ' + r.body.gameBest + ' · ') + (r.body.gained ? '+' + r.body.gained + ' PTS' : 'PLUS DE POINTS AUJOURD’HUI, MAIS BIEN JOUÉ !');
      if (r.body.gained) parts.push({ k: 'txt', text: '+' + r.body.gained + ' PTS', col: '#ffe25e', x: cre.x + 20 * C, y: mouth.top, vx: 0, vy: -18, gr: 0, life: 1.6 });
      gameEvent('game_end', g0.kind);
      apply(r.body, true);
    }).catch(function () { g0.msg = 'ERREUR RÉSEAU'; });
  }
  // La créature pendant une partie : elle suit le joueur (Attrape-miam), danse (rythme) ou encourage (cornichons)
  function gameCreature(dt) {
    cre.walking = false;
    if (game.kind === 'catch' && game.live) {
      if (game.keys) game.px = cre.x + game.keys * 40;
      var half = (SPRITES[sprKey(Math.max(0, cre.stage))] || { gw: 40 }).gw * C / 2;
      var tx = Math.max(half, Math.min(playR - half, game.px)), d = tx - cre.x;
      if (Math.abs(d) > 1) { cre.x += Math.sign(d) * Math.min(Math.abs(d), 150 * dt); cre.dir = d > 0 ? 1 : -1; cre.walking = true; cre.walkT += dt * 1.5; }
    }
    if (game.kind === 'rhythm') updateEmote(dt);
  }
  function gameTap(x, y) {
    if (!game.live || gamePlayT() < 0) return;
    if (game.kind === 'catch') { game.px = x; return; }
    if (game.kind === 'mole') {
      for (var i = 0; i < game.holes.length; i++) {
        var h = game.holes[i];
        if (!h.it || Math.abs(x - h.x) > 15 || y < h.y - 26 || y > h.y + 6) continue;
        var k = h.it.k; h.it = null;
        if (k === 'bomb') { gameAdd(-3, h.x, h.y - 16); shake = 0.3; flash('red'); Audio8.fx('deny'); spawnSparks(h.x, h.y - 8, 16, '#ff8a1f'); }
        else { gameAdd(k === 'gold' ? 3 : 1, h.x, h.y - 16); Audio8.fx(k === 'gold' ? 'bonus' : 'chomp'); spawnSparks(h.x, h.y - 8, 10, k === 'gold' ? '#ffd23f' : '#7dff7a'); if (Math.random() < 0.3) jump(90); }
        return;
      }
      return;
    }
    // rythme : la note la plus proche du cercle
    var pt = gamePlayT(), best = null;
    game.notes.forEach(function (n) { if (!n.hit && !n.miss && Math.abs(n.t - pt) < 0.18 && (!best || Math.abs(n.t - pt) < Math.abs(best.t - pt))) best = n; });
    if (!best) { game.combo = 0; gameFloat('RATÉ', '#ff4f6f', game.tx, game.lane - 12); Audio8.fx('deny'); return; }
    best.hit = true; game.combo++;
    var perfect = Math.abs(best.t - pt) < 0.07, n2 = perfect ? 2 : 1;
    if (game.combo % 10 === 0) { n2 += 2; gameFloat('COMBO ' + game.combo + ' !', '#ffd23f', playCx, game.lane - 24); }
    game.score += n2;
    gameFloat(perfect ? 'PARFAIT' : 'BIEN', perfect ? '#5ef2ff' : '#7dff7a', game.tx, game.lane - 12);
    spawnSparks(game.tx, game.lane, perfect ? 10 : 5, perfect ? '#5ef2ff' : '#7dff7a');
    Audio8.fx(perfect ? 'jump' : 'blip');
  }
  function gameKey(k, e) {
    if (game.kind === 'catch') { if (k === 'arrowleft' || k === 'q' || k === 'a') game.keys = -1; else if (k === 'arrowright' || k === 'd') game.keys = 1; return; }
    if (game.kind === 'rhythm' && (k === ' ' || k === 'enter')) { e.preventDefault(); gameTap(0, 0); }
  }

  // Texte centré qui tient toujours dans la zone de jeu : le gros texte rapetisse, le petit passe à la ligne.
  // Renvoie la hauteur utilisée, pour placer la ligne suivante.
  function gameText(text, x, y, col, big) {
    var maxW = playR - 8, size = big ? 16 : 8, lines = [text];
    g.textAlign = 'center';
    g.font = size + 'px "Press Start 2P", monospace';
    if (big && g.measureText(text).width > maxW) { size = 8; g.font = '8px "Press Start 2P", monospace'; }
    if (g.measureText(text).width > maxW) {
      lines = []; var cur = '';
      text.split(' ').forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (cur && g.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
      });
      if (cur) lines.push(cur);
    }
    lines.forEach(function (l, i) {
      var ly = Math.floor(y) + i * (size + 3);
      g.fillStyle = '#000'; g.fillText(l, Math.floor(x) + 1, ly + 1);
      g.fillStyle = col; g.fillText(l, Math.floor(x), ly);
    });
    return lines.length * (size + 3);
  }
  function drawGame() {
    if (!game) return;
    var pt = gamePlayT(), i;
    if (game.kind !== 'catch') { g.fillStyle = 'rgba(8,4,24,.28)'; g.fillRect(0, gameTop, playR, groundY - gameTop); }
    if (game.kind === 'catch') game.items.forEach(function (it) {
      var sp = it.bad ? BOMB : FOODS[it.f];
      spr(sp.rows, sp.pal, it.x - 6, it.y - 6, false, 2);
      if (it.bad && Math.floor(T * 10) % 2) { g.fillStyle = '#ffe25e'; g.fillRect(Math.floor(it.x + 3), Math.floor(it.y - 8), 2, 2); }
    });
    if (game.kind === 'mole') game.holes.forEach(function (h) {
      g.fillStyle = '#1a0b14'; g.fillRect(h.x - 13, h.y - 2, 26, 5); g.fillRect(h.x - 11, h.y - 3, 22, 7);
      g.fillStyle = '#3a2410'; g.fillRect(h.x - 14, h.y + 3, 28, 2);
      if (h.it) {
        var a = h.it.t / h.it.life, rise = Math.min(1, a * 5, (1 - a) * 5), top = h.y - Math.round(rise * 20);
        g.save(); g.beginPath(); g.rect(h.x - 15, h.y - 30, 30, 31); g.clip(); // l'objet sort du trou
        if (h.it.k === 'bomb') spr(BOMB.rows, BOMB.pal, h.x - 6, top, false, 2);
        else spr(PICKLE, { K: K, G: h.it.k === 'gold' ? '#ffd23f' : '#3fd46a', L: h.it.k === 'gold' ? '#fff3a0' : '#9aff8a', W: '#ffffff' }, h.x - 5, top, false, 2);
        g.restore();
        g.fillStyle = '#1a0b14'; g.fillRect(h.x - 13, h.y, 26, 2);
      }
    });
    if (game.kind === 'rhythm') {
      var lane = game.lane, tx = game.tx, speed = 95;
      g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, lane - 1, playR, 3);
      var pulse = Math.max(0, 1 - ((pt % 0.5 + 0.5) % 0.5) * 6);
      g.strokeStyle = pulse > 0.2 ? '#ffffff' : '#5ef2ff'; g.lineWidth = 2;
      g.beginPath(); g.arc(tx, lane, 9 + pulse * 2, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
      game.notes.forEach(function (n) {
        if (n.hit) return;
        var x = tx + (n.t - pt) * speed;
        if (x > playR + 10 || x < -10) return;
        var col = n.miss ? '#6a6a7e' : (Math.round(n.t * 4) % 2 ? '#ff5ec8' : '#ffd23f');
        g.fillStyle = K; g.fillRect(Math.round(x) - 5, lane - 5, 10, 10);
        g.fillStyle = col; g.fillRect(Math.round(x) - 4, lane - 4, 8, 8);
        g.fillStyle = '#ffffff'; g.fillRect(Math.round(x) - 3, lane - 3, 2, 2);
      });
      if (game.combo >= 3) gameText('COMBO ×' + game.combo, tx + 40, lane + 22, '#ffd23f');
    }
    // bandeau : nom, score, temps restant
    var y0 = gameTop + 12;
    gameText(GAMES[game.kind].name, playCx, y0, '#5ef2ff');
    gameText('SCORE ' + game.score, playCx, y0 + 11, '#ffffff');
    var left = Math.max(0, Math.min(1, 1 - pt / GAME_DUR)), bw = Math.min(160, playR - 40);
    g.fillStyle = K; g.fillRect(Math.round(playCx - bw / 2) - 1, y0 + 15, bw + 2, 5);
    g.fillStyle = left < 0.25 ? '#ff4f6f' : '#7dff7a'; g.fillRect(Math.round(playCx - bw / 2), y0 + 16, Math.round(bw * left), 3);
    var cy = Math.round(gameTop + (groundY - gameTop) * 0.45);
    if (pt < 0) { var c = Math.ceil(-pt / (GAME_INTRO / 3)); gameText(c > 0 && c <= 3 ? String(c) : 'GO !', playCx, cy, '#ffe25e', true); }
    else if (pt < 0.6) gameText('GO !', playCx, cy, '#7dff7a', true);
    if (pt >= GAME_DUR) {
      var hEnd = gameText('FIN ! SCORE ' + game.score, playCx, cy, '#ffe25e', true);
      gameText(game.msg || '…', playCx, cy + hEnd + 2, '#ffffff');
    }
  }

  // ---------- Toucher l'écran : petits points en rafale (comptés et plafonnés par le serveur) ----------
  var taps = { pending: 0, combo: 0, last: 0, count: 0, sending: false, capSaid: false };
  function tapAt(clientX, clientY) {
    var r = cv.getBoundingClientRect(), x = (clientX - r.left) / S, y = (clientY - r.top) / S, now = performance.now(), i;
    taps.combo = now - taps.last < 650 ? taps.combo + 1 : 1; taps.last = now;
    taps.pending++; taps.count++;
    var hue = (taps.combo * 23) % 360, n = 4 + Math.min(10, taps.combo >> 2);
    for (i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 60 + taps.combo * 2;
      parts.push({ k: 'spark', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, gr: 140, life: 0.35 + Math.random() * 0.3, col: 'hsl(' + (hue + i * 12) % 360 + ',100%,65%)' });
    }
    parts.push({ k: 'ring', x: x, y: y, vx: 0, vy: 0, gr: 0, life: 0.3, col: 'hsl(' + hue + ',100%,70%)' });
    var left = st && st.me ? st.me.tapLeft : 0;
    if (taps.count % 10 === 0 && left > 0) parts.push({ k: 'txt', text: '+1', col: '#ffe25e', x: x, y: y - 6, vx: 0, vy: -26, gr: 0, life: 1 });
    if (taps.combo === 15) gaEvent('combo_max');
    if (taps.combo === 15) { parts.push({ k: 'txt', text: 'COMBO MAX !', col: '#ffd23f', x: x, y: y - 14, vx: 0, vy: -16, gr: 0, life: 1.6 }); shake = 0.15; }
    else if (taps.combo >= 10 && taps.combo % 10 === 0) { parts.push({ k: 'txt', text: 'COMBO x' + taps.combo, col: 'hsl(' + hue + ',100%,70%)', x: x, y: y - 14, vx: 0, vy: -16, gr: 0, life: 1.3 }); shake = 0.08; }
    // Toucher la créature elle-même : elle réagit
    if (st && !st.dead && !cre.travel && Math.abs(x - cre.x) < 14 * C && y > mouth.top && y < groundY + 2) {
      spawnHearts(1, 1);
      if (cre.jy <= 0 && taps.combo % 4 === 0) jump(70);
    }
    Audio8.tap(taps.combo);
    if (left <= 0 && st && st.me && !taps.capSaid) { taps.capSaid = true; setDialog('SYSTÈME', 'Plafond de points au toucher atteint pour aujourd’hui. Tu peux continuer pour le plaisir !', 4000, true); }
  }
  // Envoi groupé des touches toutes les 4 s (une seule requête, le serveur borne le compte au temps écoulé)
  function flushTaps() {
    if (!taps.pending || taps.sending) return;
    var n = Math.min(1000, taps.pending); taps.pending -= n; taps.sending = true;
    call('POST', '/api/tap', { n: n }).then(function (r) {
      taps.sending = false;
      if (r.code === 200 && r.body.gained) { var pb = $('ptsBox'); pb.classList.remove('bump'); void pb.offsetWidth; pb.classList.add('bump'); }
      apply(r.body, false);
    }).catch(function () { taps.sending = false; });
  }

  // ---------- Voyage vers un nouveau lieu (décapotable ou jetpack) ----------
  var TRAVEL_DUR = 4.2, TRAVEL_MID = 2.0;
  function sceneFor(key) { return key.charAt(0) === 'p' ? PLACE_SCENES[key.slice(2)] : SCENES[+key.slice(2)]; }
  function startTravel(dest) {
    if (reduce || !started || sceneI === -1) return;
    var kind = dest === 'montagne' || dest === 'espace' ? 'fly' : 'car';
    cre.travel = { kind: kind, t: 0, from: sceneI, x0: cre.x, switched: false };
    cre.vy = 0; cre.jy = 0; cre.dash = 0;
    Audio8.fx(kind);
    var where = { montagne: 'la montagne', plage: 'la plage', espace: 'l’espace', ville: 'la ville' };
    setDialog('SYSTÈME', dest ? 'En route pour ' + where[dest] + ' !' : 'Retour à la maison !', 4500, true);
  }
  function updateTravel(dt) {
    var tr = cre.travel, gh = SPRITES[sprKey(Math.max(0, cre.stage))].gh * C;
    tr.t += dt;
    if (tr.t < TRAVEL_MID) {
      var u = tr.t / TRAVEL_MID;
      if (tr.kind === 'car') {
        cre.dir = 1; cre.x = tr.x0 + (W + 50 * C - tr.x0) * u * u; cre.jy = 6 * C;
        if (Math.random() < dt * 20) parts.push({ k: 'spark', x: cre.x - 18 * C, y: groundY - 4 * C, vx: -30, vy: -10, gr: -20, life: 0.5, col: '#c8c8d8' });
      } else {
        cre.dir = 1; cre.x = tr.x0; cre.jy = (groundY + gh) * u * u;
      }
    } else {
      if (!tr.switched) { tr.switched = true; if (tr.kind === 'car') Audio8.fx('car'); else Audio8.fx('fly'); }
      var v = Math.min(1, (tr.t - TRAVEL_MID) / (TRAVEL_DUR - TRAVEL_MID)), e = 1 - (1 - v) * (1 - v);
      if (tr.kind === 'car') { cre.dir = 1; cre.x = -30 * C + (playCx + 30 * C) * e; cre.jy = 6 * C; }
      else { cre.x = playCx; cre.jy = (groundY + gh) * (1 - e); }
    }
    if (tr.kind === 'fly' && Math.random() < dt * 40) parts.push({ k: 'spark', x: cre.x + (Math.random() - 0.5) * 10 * C, y: groundY - cre.jy + 6 * C, vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 60, gr: 0, life: 0.4, col: Math.random() < 0.5 ? '#ffd23f' : '#c8c8d8' });
    if (tr.t >= TRAVEL_DUR) {
      cre.travel = null; cre.jy = 0; cre.vy = 0; cre.x = cre.tx = playCx; cre.wait = 1.5;
      if (tr.kind === 'car') jump(130);
      else { spawnSparks(cre.x, groundY - 2, 14, '#e8e4ff'); shake = 0.25; Audio8.fx('land'); }
    }
  }
  function drawCar(x0, gy) {
    var b = Math.floor(T * 12) % 2; // suspensions qui rebondissent
    function Rc(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x0 + x * C, gy + (y - b) * C, w * C, h * C); }
    for (var r = 0; r < 5; r++) { Rc(27 + Math.floor(r * 0.75), -14 + r, 1, 1, '#1a1a2e'); Rc(28 + Math.floor(r * 0.75), -14 + r, 3, 1, 'rgba(159,232,255,.65)'); }
    Rc(2, -10, 41, 1, '#ff8a92');
    Rc(1, -9, 43, 5, '#e43b44');
    Rc(0, -9, 1, 5, '#1a0b14'); Rc(44, -8, 1, 4, '#1a0b14'); Rc(1, -11, 42, 1, '#1a0b14');
    Rc(1, -5, 43, 1, '#9a1a2a'); Rc(22, -9, 1, 4, '#9a1a2a'); Rc(17, -7, 3, 1, '#ffd0d0');
    Rc(42, -8, 2, 2, '#fff3a0'); Rc(1, -8, 1, 2, '#ff2d2d');
    Rc(0, -4, 45, 1, '#c8c8d8');
    [9, 35].forEach(function (wx) {
      g.fillStyle = '#1a0b14';
      g.fillRect(x0 + (wx - 2) * C, gy - 5 * C, 5 * C, C); g.fillRect(x0 + (wx - 3) * C, gy - 4 * C, 7 * C, 3 * C); g.fillRect(x0 + (wx - 2) * C, gy - C, 5 * C, C);
      g.fillStyle = '#9a9aae'; g.fillRect(x0 + (wx - 1) * C, gy - 3 * C, 3 * C, C);
      g.fillStyle = '#55556a'; g.fillRect(x0 + (wx + ((T * 20 | 0) % 2 ? 0 : -1)) * C, gy - 4 * C, C, 3 * C);
    });
  }
  function drawJet(x, y) {
    var cols = ['#fff3a0', '#ffd23f', '#ff8a1f', '#ff3d2e'], h = 6 + ((T * 14 | 0) % 3);
    for (var r = 0; r < h; r++) {
      var w = Math.max(0, Math.round((h - r) * 0.45));
      for (var c = -w; c <= w; c++) { g.fillStyle = cols[Math.min(3, Math.floor((Math.abs(c) / (w + 1) + r / h) * 2.2))]; g.fillRect(Math.round(x + c * C), Math.round(y + r * C), C, C); }
    }
  }
  function drawTravel() {
    var tr = cre.travel;
    if (tr.kind === 'car') drawCar(Math.round(cre.x - 16 * C), groundY);
    else { var by = Math.round(groundY - cre.jy); drawJet(cre.x - 6 * C, by); drawJet(cre.x + 5 * C, by); }
  }
  // Volets noirs façon rétro au moment où le décor change
  function drawWipe() {
    var k = 1 - Math.abs(cre.travel.t - TRAVEL_MID) / 0.35;
    if (k <= 0) return;
    var bh = Math.ceil(8 * Math.min(1, k));
    g.fillStyle = '#000';
    for (var y = 0; y < H; y += 8) g.fillRect(0, y, W, bh);
  }

  // ---------- Boucle ----------
  var lastFrame = performance.now();
  function updateCreature(dt) {
    if (!cre.x) { cre.x = cre.tx = playCx; }
    var si = stageOf(st);
    if (st) {
      if (cre.stage < 0 || si < cre.stage || (si > cre.stage && !started)) cre.stage = si;
      else if (si > cre.stage && cre.evo <= 0) {
        cre.evoFrom = cre.stage; cre.stage = si; cre.evo = EVO_TIME;
        Audio8.fx('evo'); setDialog('SYSTÈME', 'Quoi ?! ' + st.name + ' est en train d’évoluer !', EVO_TIME * 1000 + 500, true);
      }
    }
    if (cre.evo > 0) {
      cre.evo -= dt;
      if (cre.evo <= 0) {
        flash(); shake = 0.3; spawnSparks(cre.x, mouth.top + 10 * C, 50); Audio8.fx('hatch');
        var newTier = tierOf(cre.stage) !== tierOf(cre.evoFrom);
        setDialog('SYSTÈME', st.name + ' passe au niveau ' + (cre.stage + 1) + ' !' + (newTier ? ' Il devient ' + TIERS[tierOf(cre.stage)].n + '.' : ''), 6000, true);
      }
    }
    if (!cre.travel && (cre.jy > 0 || cre.vy > 0)) {
      cre.vy -= (st && st.place && st.place.key === 'espace' ? 170 : 520) * dt; cre.jy += cre.vy * dt; // apesanteur dans l'espace
      if (cre.jy <= 0) { cre.jy = 0; cre.vy = 0; spawnSparks(cre.x, groundY - 2, 6, '#e8e4ff'); }
    }
    if (cre.eat > 0) cre.eat -= dt;
    if (cre.blink > 0) cre.blink -= dt;
    if (T > cre.nextBlink) { cre.blink = 0.12; cre.nextBlink = T + 2 + Math.random() * 4; }

    if (cre.travel) { cre.walking = false; updateTravel(dt); return; }
    if (cre.egg > 0) { cre.walking = false; updateEgg(dt); return; }
    if (game) { gameCreature(dt); return; }
    // Balade gauche / droite
    var half = (SPRITES[sprKey(Math.max(0, cre.stage))] || { gw: 48 }).gw * C / 2, range = Math.max(0, Math.min(playR * 0.28, 70, playR / 2 - half - 4));
    if (cre.dash > 0) cre.dash -= dt;
    var busy = reduce || !st || st.dead || asleep() || cre.evo > 0 || cre.eat > 0 || (cre.jy > 0 && cre.dash <= 0) || parts.some(function (p) { return p.k === 'pizza'; });
    // Animation au hasard toutes les 15 à 40 s, seulement si la créature ne fait rien d'autre et que la page est visible
    if (!cre.nextEmote) cre.nextEmote = T + 10 + Math.random() * 15;
    if (cre.emote && (st && st.dead || asleep())) cre.emote = null;
    updateEmote(dt);
    if (!busy && !cre.emote && cre.dash <= 0 && started && !document.hidden && T > cre.nextEmote && !shopOpen) { cre.nextEmote = T + 15 + Math.random() * 25; startEmote(pickEmote()); }
    if (cre.emote) busy = true;
    cre.walking = false;
    if (asleep() && Math.random() < dt * 0.8) spawnZ(1);
    if (!busy && cre.dash <= 0 && cre.wait > 0 && st.fit > 80 && Math.random() < dt * 0.12) jump(80);
    if (!busy) {
      if (cre.dash > 0) { cre.wait = 0; if (Math.abs(cre.tx - cre.x) < 2) cre.tx = cre.x < playCx ? playCx + range : playCx - range; }
      if (cre.wait > 0) cre.wait -= dt;
      else {
        var d = cre.tx - cre.x;
        if (Math.abs(d) < 1) { cre.wait = 1.5 + Math.random() * 4; cre.tx = playCx + (Math.random() * 2 - 1) * range; }
        else {
          var sp = cre.dash > 0 ? 70 : (moodOf(st) === 'sad' || st.fit < 25 || st.sleep < 20) ? 7 : 15;
          cre.x += Math.sign(d) * Math.min(Math.abs(d), sp * dt); cre.dir = d > 0 ? 1 : -1;
          cre.walking = true; cre.walkT += dt;
        }
      }
    }
    if (!(cre.emote && cre.emote.k === 'sprint')) cre.x = Math.max(24 * C, Math.min(Math.max(24 * C, playR - half), cre.x));
  }
  function update(dt) {
    T += dt;
    updateCreature(dt);
    updateBonus(dt);
    updateTease(dt);
    updateGame(dt);
    if (shake > 0) shake -= dt;
    if (rainbow() && Math.random() < dt * 2.5) spawnSparks(cre.x + (Math.random() - 0.5) * 30 * C, groundY - Math.random() * 30 * C, 2);
    // Le requin vit hors de l'eau : quelques bulles remontent autour de lui
    if (speciesOf(st) === 'requin' && st && !st.dead && !(cre.egg > 0) && cre.evo <= 0 && Math.random() < dt * 1.6) spawnBubbles(1);
    // Aura de combat du lapin debout : flammèches rouges (roses pour la légende) qui montent autour de lui
    if (speciesOf(st) === 'lapin' && st && !st.dead && cre.stage >= 4 && cre.evo <= 0 && Math.random() < dt * (cre.stage === 9 ? 22 : 12)) parts.push({ k: 'spark', x: cre.x + (Math.random() - 0.5) * 26 * C, y: groundY - Math.random() * 12 * C, vx: (Math.random() - 0.5) * 6, vy: -30 - Math.random() * 35, gr: -15, life: 0.7 + Math.random() * 0.6, col: cre.stage === 9 ? (Math.random() < 0.5 ? '#ff4fc8' : '#ffd23f') : (Math.random() < 0.6 ? '#ff3250' : '#ff8a1f') });
    if (speciesOf(st) === 'horus' && st && !st.dead && cre.evo <= 0 && Math.random() < dt * 3) parts.push({ k: 'spark', x: cre.x + (Math.random() - 0.5) * 30 * C, y: groundY - Math.random() * 40 * C, vx: 0, vy: -12, gr: 0, life: 0.8, col: '#ffe98a' }); // aura de la créature épique
    if (cre.stage === 9 && st && !st.dead && cre.evo <= 0 && Math.random() < dt * 6) parts.push({ k: 'spark', x: cre.x + (Math.random() - 0.5) * 44 * C, y: groundY - Math.random() * 10 * C, vx: (Math.random() - 0.5) * 10, vy: -25 - Math.random() * 30, gr: -10, life: 1 + Math.random(), col: Math.random() < 0.5 ? '#ffd23f' : '#ff8a1f' });

    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += p.gr * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.k === 'heart' || p.k === 'bubble') p.x += Math.sin(T * 6 + p.sw) * 0.4;
      if (p.k === 'heart' && p.vy > 0 && p.y > groundY - 4) { p.vy = 0; p.gr = 0; p.vx = 0; } // les cœurs se posent au sol
      if (p.k === 'ball') {
        if (p.y > groundY - 3 * C) { p.y = groundY - 3 * C; p.vy = -Math.abs(p.vy) * 0.65; p.vx *= 0.85; }
        if (p.x < 4 || p.x > W - 4) p.vx = -p.vx;
      }
      if (p.k === 'pizza') p.x += (mouth.x - 3.5 * p.s - p.x) * Math.min(1, dt * 5);
      if (p.k === 'pizza' && p.y + 4 * p.s >= mouth.y) {
        parts.splice(i, 1); cre.eat = 0.7; Audio8.fx('chomp');
        spawnSparks(mouth.x, mouth.y, 10); floatText('MIAM!', '#ffd23f'); continue;
      }
      if (p.life <= 0 || p.y > H + 20) parts.splice(i, 1);
    }
    typeDialog(dt);
  }

  function draw(dt) {
    var m = moodOf(st);
    // Le décor suit le stade affiché (pendant une évolution, l'ancien décor reste jusqu'au flash)
    // Un séjour acheté en boutique remplace le décor du stade
    var si = tierOf(cre.evo > 0 ? cre.evoFrom : (cre.stage < 0 ? stageOf(st) : cre.stage));
    var sk = st && st.place && !st.dead ? 'p:' + st.place.key : 's:' + si;
    // Pendant un voyage : ancien décor jusqu'aux volets, puis le nouveau
    if (cre.travel && cre.travel.t < TRAVEL_MID) sk = cre.travel.from;
    if (sk !== sceneI) { sceneI = sk; scene = sceneFor(sk); skyKey = ''; }
    if (!skyKey) buildSky();
    mot = reduce ? 0 : 1;
    g.save();
    if (shake > 0 && !reduce) g.translate(Math.round(Math.random() * 4 - 2), Math.round(Math.random() * 4 - 2));
    g.drawImage(skyCv, 0, 0);
    if (scene.kind === 'meadow') drawMeadow();
    else if (scene.kind === 'forest') drawForest();
    else if (scene.kind === 'city') drawCity();
    else if (scene.kind === 'mountain') drawMountain();
    else if (scene.kind === 'beach') drawBeach();
    else if (scene.kind === 'moon') drawMoonScape();
    else if (scene.kind === 'town') drawTown();
    else drawCosmos(dt);

    // sol en tuiles
    var x, y, i;
    for (y = groundY; y < H; y += 16) for (x = 0; x < W; x += 16) g.drawImage(y === groundY ? tileTop : tileFill, x, y);
    drawExtras();
    drawTease();
    drawProps(dt);

    if (scene.kind === 'mountain') drawSnow(dt);
    // ambiance selon l'humeur : triste = teinte froide + pluie, mort = noir et blanc
    if (m === 'sad') {
      g.fillStyle = 'rgba(30,16,70,.35)'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(170,190,255,.55)';
      for (i = 0; i < rain.length; i++) {
        var d = rain[i], ry = ((d.y * groundY + T * 160) % groundY), rx = Math.floor(((d.x * W - ry * 0.4) % W + W) % W);
        g.fillRect(rx, Math.floor(ry), 1, 3);
      }
    } else if (m === 'dead') {
      g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(8,6,16,.45)'; g.fillRect(0, 0, W, H);
    }

    var disco = cre.emote && cre.emote.k === 'dance' && st && !st.dead ? cre.emote : null;
    if (disco) drawDisco(disco, false); // ambiance, faisceaux et taches de lumière derrière la créature
    mouth = drawCreature();
    if (disco) drawDisco(disco, true);  // la boule elle-même, devant
    if (cre.travel) drawTravel();
    drawBonus();

    // particules
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      g.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      if (p.k === 'heart') drawSprite(HEART, p.x, p.y, p.s);
      else if (p.k === 'bigheart') drawSprite(HEART, p.x - 3.5 * p.s, p.y, p.s);
      else if (p.k === 'note') spr(NOTE, { K: p.col }, p.x, p.y, false, C);
      else if (p.k === 'pizza') drawSprite(PIZZA, p.x, p.y, p.s);
      else if (p.k === 'spark') { g.fillStyle = p.col; g.fillRect(Math.floor(p.x), Math.floor(p.y), C, C); }
      else if (p.k === 'bubble') {
        var br = p.r * C; g.fillStyle = 'rgba(200,250,255,.9)';
        g.fillRect(Math.floor(p.x) - br, Math.floor(p.y), C, br * 2); g.fillRect(Math.floor(p.x) + br, Math.floor(p.y), C, br * 2);
        g.fillRect(Math.floor(p.x), Math.floor(p.y) - br, br * 2 - C, C); g.fillRect(Math.floor(p.x), Math.floor(p.y) + br * 2, br * 2 - C, C);
        g.fillStyle = '#ffffff'; g.fillRect(Math.floor(p.x), Math.floor(p.y), C, C);
      } else if (p.k === 'ball') {
        var bx = Math.floor(p.x), by = Math.floor(p.y), u = C;
        g.fillStyle = '#e43b44'; g.fillRect(bx - u, by - 2 * u, 2 * u, 4 * u); g.fillRect(bx - 2 * u, by - u, 4 * u, 2 * u);
        g.fillStyle = '#ffffff'; g.fillRect(bx - 2 * u, by, 4 * u, u); g.fillRect(bx - u, by - u, u, u);
      } else if (p.k === 'ring') {
        var rr = Math.round((0.3 - p.life) * 30) + 2, rx0 = Math.floor(p.x), ry0 = Math.floor(p.y);
        g.fillStyle = p.col; g.globalAlpha = Math.min(1, p.life * 4);
        g.fillRect(rx0 - rr, ry0, 1, 1); g.fillRect(rx0 + rr, ry0, 1, 1); g.fillRect(rx0, ry0 - rr, 1, 1); g.fillRect(rx0, ry0 + rr, 1, 1);
        var dd = Math.round(rr * 0.7);
        g.fillRect(rx0 - dd, ry0 - dd, 1, 1); g.fillRect(rx0 + dd, ry0 - dd, 1, 1); g.fillRect(rx0 - dd, ry0 + dd, 1, 1); g.fillRect(rx0 + dd, ry0 + dd, 1, 1);
      } else if (p.k === 'txt') {
        g.font = '8px "Press Start 2P", monospace'; g.textAlign = 'center';
        g.fillStyle = '#000'; g.fillText(p.text, Math.floor(p.x) + 1, Math.floor(p.y) + 1);
        g.fillStyle = p.col; g.fillText(p.text, Math.floor(p.x), Math.floor(p.y));
      }
    }
    g.globalAlpha = 1;
    drawGame();
    if (cre.travel) drawWipe();
    g.restore();
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    update(dt); draw(dt);
    requestAnimationFrame(frame);
  }

  /* =====================================================================
     HUD & DIALOGUE
     ===================================================================== */
  var SAYINGS = {
    happy: ['Je suis ravi.', 'La vie est belle !', 'Quelqu’un a un cornichon ?', 'Je vous aime tous. Un peu.', 'Je brille de mille couleurs !',
      'Je pourrais danser toute la journée.', 'Aujourd’hui est un grand jour. Je ne sais pas pourquoi.', 'J’ai le ventre plein et le cœur aussi.',
      'Vous êtes mes humains préférés.', 'Je me sens invincible !', 'Tout est parfait. Sauf l’absence de cornichons.', 'Je fredonne une chanson que j’ai inventée.',
      'Si j’avais une queue, je la remuerais. Ah, j’en ai une.', 'On fait une photo ? Je suis à mon avantage.'],
    ok: ['Ça va, ça va.', 'Je digère.', 'Je regarde le plafond.', 'Qu’est-ce qu’on mange ?', 'Je compte les pixels. J’en suis à 412.',
      'Il se passe rien. J’adore.', 'Je réfléchis au sens de la vie. Et au goûter.', 'Tiens, une poussière.', 'Vous saviez que je sais siffler ? Non. Moi non plus.',
      'Je m’ennuie un tout petit peu.', 'On pourrait repeindre le décor.', 'J’ai entendu un bruit. C’était mon ventre.', 'Quelqu’un joue avec moi ?',
      'Je prends la pose. Au cas où.'],
    sad: ['Personne ne m’aime…', 'Un câlin ? Même un petit.', 'Je me sens comme une chaussette seule.', 'Je vais bouder dans mon coin.',
      'Même mon ombre m’a laissé tomber.', 'Il pleut dans mon cœur.', 'Une caresse, juste une…', 'Je crois que je vais pleurer en pixels.',
      'Vous m’avez oublié ?', 'Je fais semblant d’aller bien.'],
    hungry: ['J’ai tellement faim.', 'Je mangerais mon propre chapeau.', 'À manger. S’il vous plaît.', 'Mon ventre fait des bruits de dinosaure.',
      'Je vois des croissants partout.', 'Une miette ? Une seule miette ?', 'Je pourrais manger une chaussette. Encore.', 'Le bouton NOURRIR est juste là…',
      'Je rêve de spaghettis.', 'Mon estomac m’envoie des messages codés.'],
    dying: ['Dites à ma mère que je l’aime…', 'La lumière… elle sent le fromage…', 'Un dernier croissant ?', 'Je vois un tunnel… avec un buffet au bout…',
      'Je lègue mes chaussettes à… personne.', 'Vite… quelque chose… n’importe quoi…', 'C’était bien, la vie…', 'Si vous lisez ça… NOURRISSEZ-MOI.'],
    dirty: ['Je sens un peu le fromage. Beaucoup, en fait.', 'Un bain ? Pourquoi pas…', 'Les mouches m’adorent.', 'Je crois que quelque chose pousse sur moi.',
      'Même les mouches se bouchent le nez.', 'J’ai trouvé une frite dans mes écailles. Elle date.', 'Je suis une œuvre d’art… de la crasse.',
      'Un peu de mousse, c’est trop demander ?'],
    tired: ['*bâille*', 'Mes yeux se ferment tout seuls…', 'Quelqu’un me borde ?', 'Je dors debout. Littéralement.', 'Une berceuse, vite…',
      'Je compte les moutons. J’en suis à trois.', 'Cinq minutes de sieste. Ou cinq heures.', 'Mes paupières pèsent une tonne.'],
    soft: ['Je suis tout mou.', 'On joue ? Allez, on joue !', 'J’ai besoin de me dépenser !', 'Mes muscles ont fondu.', 'Je ressemble à un flan.',
      'Une balle ! Lancez-moi une balle !', 'Je veux courir partout !', 'J’ai des fourmis dans les pattes.'],
    sleeping: ['Zzz…', 'Zzz… cornichon… zzz…', '*ronfle doucement*', 'Zzz… encore cinq minutes… zzz…', '*marmonne quelque chose sur des pizzas*',
      'Zzz… je vole… zzz…', '*sourit en dormant*', 'Zzz… non, pas le bain… zzz…'],
    cold: ['Brrr… il fait froid ici.', 'Un bonnet ? Une écharpe ? Un câlin ?', 'Mes écailles gèlent.', 'Je claque des dents. J’en ai beaucoup.',
      'Il y a une boutique avec des bonnets, non ?'],
    montagne: ['Quelle vue !', 'Il neige, il neige !', 'Je suis bien couvert.', 'Je fais un bonhomme de neige. Il me ressemble.', 'L’air est si pur !',
      'Une fondue ce soir ?', 'Le skieur va trop vite.'],
    plage: ['Le sable, ça gratte.', 'Je bronze !', 'Une glace ? Deux glaces ?', 'J’ai construit un château de sable.', 'Un crabe m’a pincé. On est amis.',
      'Les vagues font fsshhh.', 'Crème solaire, svp !'],
    espace: ['Je flotte !', 'Houston, j’ai faim.', 'Coucou la Terre !', 'Je vois ma maison d’ici !', 'Les étoiles sont si proches.',
      'Mes miettes flottent partout.', 'Y a des extraterrestres ? Ils ont des cornichons ?'],
    ville: ['Que de monde !', 'Ça sent les crêpes par ici.', 'Je fais du lèche-vitrine.', 'Les pigeons me regardent bizarrement.',
      'Tous ces klaxons !', 'Je veux un taxi.', 'Le livreur est passé sans s’arrêter.'],
    // Moment de la journée (heure locale du visiteur)
    morning: ['Bonjour ! Déjà le matin ?', 'Un croissant pour le petit-déjeuner ?', 'Je me suis levé du bon pied. J’en ai quatre.', 'Le soleil se lève, moi aussi.'],
    noon: ['C’est l’heure de manger, non ?', 'Midi pile. Mon ventre le sait.', 'Une petite sieste digestive ?'],
    evening: ['Belle soirée, hein ?', 'C’est bientôt l’heure du dîner.', 'Le ciel est tout orange.', 'Vous me racontez votre journée ?'],
    night: ['Il est tard… vous ne dormez pas ?', 'La nuit, tout est calme.', 'Chut, les voisins dorment.', 'Je veille sur vous.', 'Les étoiles brillent ce soir.'],
    // Selon l'espèce
    dino: ['Rooaar ! C’était effrayant ?', 'Mes ancêtres étaient énormes.', 'Mes petits bras ne m’empêchent pas de rêver.', 'Une météorite ? Où ça ?!'],
    phenix: ['Je renais toujours de mes cendres. Enfin, j’espère.', 'Attention, je suis un peu chaud.', 'Mes plumes brillent, non ?', 'Je crache des étincelles quand j’éternue.'],
    renard: ['Je sais des choses… mystiques.', 'Mes queues voient l’avenir.', 'Chut, j’écoute les esprits.', 'Rusé, moi ? Jamais.'],
    lezard: ['Je suis un lézard géant. Respectez la taille.', 'Je prends le soleil. Il n’y en a pas, mais je le prends.', 'Ma langue attrape les mouches. Toutes.', 'Je change pas de couleur. Sauf à la boutique.'],
    meduse: ['Ne me regardez pas dans les yeux. Ou si, je plaisante.', 'Mes serpents ont faim aussi.', 'J’ai pétrifié une mouche. Oups.', 'Mes cheveux sifflent quand je suis contente.'],
    horus: ['Je suis un dieu. Prosternez-vous. Ou nourrissez-moi.', 'Le soleil m’obéit.', 'J’ai l’œil sur tout.', 'Les pharaons me jalousent.'],
    requin: ['Je ne mords pas. Presque pas.', 'Quelqu’un a vu l’océan ? Je l’ai perdu.', 'Mes dents repoussent. Toutes.', 'Tadam… tadam… tadam-tadam…', 'Je nage dans l’air. C’est un talent.', 'Un sushi ? Non merci, ce sont des amis.'],
    lapin: ['Tu veux te battre ?!', 'Je fais mes squats. Respect.', 'Mes oreilles sont des armes.', 'Personne n’a dit carotte ?'],
    // Réactions juste après une action (la sienne ou celle d'un autre joueur)
    did_feed: ['Miam ! Encore ?', 'C’était délicieux. Je crois.', 'Merci pour le repas !', '*rot* Pardon.', 'Ça avait un goût de chaussette. J’adore.', 'Mon ventre vous remercie.'],
    did_pet: ['Ooooh, encore !', 'Je ronronne. Je savais pas que je savais.', 'Vous êtes trop gentil.', 'Ça chatouille !', 'Je fonds…', 'Câlin de groupe ?'],
    did_wash: ['Je sens la fraise !', 'Brr, c’était froid !', 'Tout propre. Ça va pas durer.', 'J’ai de la mousse dans les oreilles.', 'Je brille comme un sou neuf !'],
    did_play: ['Encore ! Encore !', 'J’ai gagné ! Je crois.', 'Pfiou, quel sport !', 'Je suis un athlète de haut niveau.', 'La balle, la balle !'],
    did_rock: ['Bonne nuit…', 'Une histoire… avec un dragon…', 'Zzz… merci…', 'Je fais de beaux rêves…'],
    did_heal: ['Je me sens beaucoup mieux !', 'Merci docteur !', 'Ça pique, mais ça marche.', 'Je suis requinqué !', 'Je brille un peu. C’est normal ?'],
    refused: ['Non merci, ça ira.', 'Sans façon.', 'Laissez-moi respirer !', 'Trop, c’est trop.', 'J’en ai déjà eu assez, merci.']
  };
  var phrase = { key: '', text: '', at: 0 };
  function say(key) {
    if (phrase.key !== key || Date.now() - phrase.at > 25000) {
      var a = SAYINGS[key], t;
      do { t = a[Math.floor(Math.random() * a.length)]; } while (a.length > 1 && t === phrase.text);
      phrase = { key: key, text: t, at: Date.now() };
    }
    return phrase.text;
  }
  // Dernière action vue (la mienne ou celle d'un autre) : la créature y réagit pendant un moment
  var reaction = { key: '', at: 0 };
  function react(key) { reaction = { key: key, at: Date.now() }; }
  function dayKey() {
    var h = new Date().getHours();
    return h >= 6 && h < 11 ? 'morning' : h >= 11 && h < 14 ? 'noon' : h >= 18 && h < 22 ? 'evening' : h >= 22 || h < 6 ? 'night' : null;
  }
  function asleep() { return st && !st.dead && st.asleepUntil > Date.now() + offset; }
  function covered() { return st.acc && (st.acc.head === 'bonnet' || st.acc.neck === 'echarpe'); }
  function needKey() {
    var reacting = Date.now() - reaction.at < 25000;
    if (asleep()) return reacting && reaction.key === 'did_rock' ? 'did_rock' : 'sleeping';
    if (st.food < 8) return 'dying';
    if (reacting) return reaction.key;
    if (st.food < 25) return 'hungry';
    if (st.place && st.place.key === 'montagne' && !covered()) return 'cold';
    if (st.joy < 25) return 'sad';
    if (st.clean < 25) return 'dirty';
    if (st.sleep < 25) return 'tired';
    if (st.fit < 25) return 'soft';
    // Rien d'urgent : on fait tourner les sujets de conversation pour ne pas radoter
    var mood = moodOf(st) === 'happy' ? 'happy' : 'ok', topics = [mood, speciesOf(st), mood];
    if (st.place) topics.push(st.place.key);
    if (dayKey()) topics.push(dayKey());
    var k = topics[Math.floor(Date.now() / 25000) % topics.length];
    return SAYINGS[k] ? k : mood;
  }

  var dlg = { full: '', speaker: '', shown: 0, acc: 0, hold: 0, n: 0 };
  function setDialog(speaker, text, hold, sys) {
    if (hold) dlg.hold = Date.now() + hold;
    if (dlg.full === text && dlg.speaker === speaker) return;
    dlg.full = text; dlg.speaker = speaker; dlg.shown = 0; dlg.acc = 0;
    $('speaker').textContent = speaker; $('speaker').className = sys ? 'sys' : '';
    $('text').textContent = '';
  }
  function typeDialog(dt) {
    if (dlg.shown >= dlg.full.length) { $('dialog').classList.add('done'); return; }
    $('dialog').classList.remove('done');
    dlg.acc += dt * 48;
    var n = Math.floor(dlg.acc);
    if (n > 0) {
      dlg.acc -= n; dlg.shown = Math.min(dlg.full.length, dlg.shown + n);
      $('text').textContent = dlg.full.slice(0, dlg.shown);
      if (started && dlg.n++ % 3 === 0) Audio8.fx('blip');
    }
  }

  function fmt(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + ' MIN';
    var h = Math.floor(m / 60);
    if (h < 48) return h + 'H ' + (m % 60) + 'MIN';
    return Math.floor(h / 24) + 'J ' + (h % 24) + 'H';
  }
  function fmtShort(ms) { var s = Math.ceil(ms / 1000); return s < 60 ? s + ' S' : Math.ceil(s / 60) + ' MIN'; }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() + offset - ts) / 1000));
    if (s < 60) return 'NOW';
    if (s < 3600) return Math.floor(s / 60) + 'M';
    if (s < 86400) return Math.floor(s / 3600) + 'H';
    return Math.floor(s / 86400) + 'J';
  }
  function pad(n) { return ('000000' + n).slice(-6); }

  var SEGS = 20;
  // Barre d'expérience : progression de l'âge entre le niveau actuel et le suivant
  var XP_SEGS = 20;
  (function () { var bar = $('xpBar'); for (var i = 0; i < XP_SEGS; i++) bar.appendChild(document.createElement('i')); })();
  // Heure du prochain niveau, lisible : « 14H32 », « DEMAIN 09H12 » ou « SAMEDI 18H05 »
  function clockAt(ts) {
    var d = new Date(ts - offset), today = new Date(), hm = ('0' + d.getHours()).slice(-2) + 'H' + ('0' + d.getMinutes()).slice(-2);
    var days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
    if (days === 0) return hm;
    if (days === 1) return 'DEMAIN ' + hm;
    return d.toLocaleDateString('fr-FR', { weekday: 'long' }).toUpperCase() + ' ' + hm;
  }
  // Temps avant de mourir de faim sans repas (même règle que le serveur : MIAM se vide en 14 h, puis 3 h de survie à 0)
  var FOOD_RATE = { espace: 1.3, ville: 1.3 };
  function starveIn() {
    var mult = (st.place && FOOD_RATE[st.place.key]) || 1;
    return (st.food / (100 / 14 * mult) + 3) * 3600e3;
  }
  function renderHint(lvl, nextAt, untilNext) {
    var el = $('xpHint'), name = st.name.toUpperCase();
    if (lvl >= LEVELS.length - 1) { el.className = 'max'; el.textContent = 'LÉGENDE ULTIME : GARDE-LE EN VIE POUR LE PANTHÉON !'; return; }
    var lvlTxt = 'NIV. ' + (lvl + 2);
    // Alerte seulement s'il a vraiment faim : aux hauts niveaux, même le ventre plein ne tient pas jusqu'au palier suivant
    if (st.food < 35 && starveIn() < untilNext) { el.className = 'danger'; el.textContent = 'SANS REPAS, ' + name + ' NE VERRA PAS LE ' + lvlTxt + ' !'; return; }
    var low = st.food < 25 || st.joy < 25 || st.clean < 25 || st.fit < 25 || st.sleep < 25;
    el.className = low ? 'need' : '';
    el.textContent = low
      ? 'SI TOUT VA BIEN, ' + lvlTxt + ' VERS ' + clockAt(nextAt) + '… MAIS ' + name + ' A BESOIN DE TOI !'
      : 'SI TOUT VA BIEN, ' + name + ' PASSERA ' + lvlTxt + ' VERS ' + clockAt(nextAt);
  }
  function renderXp(now) {
    var box = $('xp');
    $('xpHint').hidden = !st || st.dead;
    if (!st || st.dead) { box.hidden = true; return; }
    box.hidden = false;
    var lvl = cre.stage < 0 ? stageOf(st) : cre.stage, segs = $('xpBar').children, i;
    if (lvl >= LEVELS.length - 1) {
      box.classList.add('max');
      for (i = 0; i < segs.length; i++) segs[i].className = 'on';
      $('xpText').textContent = 'NIVEAU MAX';
      renderHint(lvl, 0, 0);
      return;
    }
    box.classList.remove('max');
    var age = now - st.born, from = LEVELS[lvl], to = LEVELS[lvl + 1];
    var p = Math.max(0, Math.min(1, (age - from) / (to - from))), filled = p * XP_SEGS;
    for (i = 0; i < segs.length; i++) {
      var f = filled - i;
      segs[i].className = f >= 1 ? 'on' : f > 0 ? 'part' : '';
      segs[i].style.setProperty('--p', f > 0 && f < 1 ? Math.round(f * 100) + '%' : '0%');
    }
    renderHint(lvl, st.born + to, Math.max(0, to - age));
    $('xpText').textContent = 'VERS NIV. ' + (lvl + 2) + ' · ' + Math.floor(p * 100) + ' % · ENCORE ' + fmt(Math.max(0, to - age));
  }

  var BARS = [['barFood', 'food'], ['barJoy', 'joy'], ['barClean', 'clean'], ['barFit', 'fit'], ['barSleep', 'sleep']];
  BARS.forEach(function (b) {
    var el = $(b[0]).querySelector('.segs');
    for (var i = 0; i < SEGS; i++) { var d = document.createElement('div'); d.className = 'seg'; el.appendChild(d); }
  });
  function setBar(id, v) {
    var segs = $(id).querySelectorAll('.seg'), n = Math.round(v / (100 / SEGS));
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', i < n);
    $(id).classList.toggle('low', v < 25);
  }

  var ACTS = [['feed', 'NOURRIR'], ['pet', 'CÂLINER'], ['wash', 'LAVER'], ['play', 'JOUER'], ['rock', 'BERCER'], ['heal', 'SOIGNER']];
  var PLACE_NAMES = { montagne: 'MONTAGNE', plage: 'PLAGE', espace: 'ESPACE', ville: 'VILLE' };
  var lastPts = null;

  function renderHud() {
    if (!st) return;
    var now = Date.now() + offset;
    BARS.forEach(function (b) { setBar(b[0], st[b[1]]); });
    $('name').textContent = '★ ' + st.name.toUpperCase() + ' ★';
    $('name').classList.toggle('rainbow', rainbow());
    var lvl = cre.stage < 0 ? stageOf(st) : cre.stage;
    $('age').textContent = (cre.egg > 0 ? 'ŒUF MYSTÈRE' : SPECIES[speciesOf(st)].name) + ' · NIV. ' + (lvl + 1) + ' · ' + (st.dead ? 'A VÉCU ' + fmt(st.deadAt - st.born) : 'ÂGE ' + fmt(now - st.born));
    renderXp(now);
    $('place').textContent = st.place ? 'SÉJOUR ' + PLACE_NAMES[st.place.key] + ' · ENCORE ' + fmt(Math.max(0, st.place.until - now)) : '';
    $('score').textContent = pad(st.actions);
    $('best').textContent = st.best ? st.best.name.toUpperCase() + ' ' + fmt(st.best.ms) : '---';
    $('devBtn').hidden = !st.dev;
    if (!st.dev) $('devpanel').hidden = true;
    var pts = st.me ? st.me.pts : 0;
    $('pts').textContent = pts;
    if (lastPts !== null && pts > lastPts) { var pb = $('ptsBox'); pb.classList.remove('bump'); void pb.offsetWidth; pb.classList.add('bump'); }
    lastPts = pts;

    var left = Math.max(0, lastAct + COOLDOWN - Date.now());
    ACTS.forEach(function (a) {
      var b = $(a[0]);
      b.disabled = st.dead || left > 0; b.hidden = st.dead;
      b.querySelector('.lbl').textContent = left > 0 ? Math.ceil(left / 1000) + ' S' : a[1];
    });
    $('hatch').hidden = !st.dead;
    var wait = st.dead ? Math.max(0, st.canHatchAt - now) : 0;
    $('hatch').disabled = wait > 0;
    $('hatch').querySelector('.lbl').textContent = wait > 0 ? 'UN ŒUF ARRIVE… ' + Math.ceil(wait / 1000) + ' S' : 'FAIRE ÉCLORE UN ŒUF';

    renderLog();
    $('nickBtn').textContent = st.me ? st.me.nick.toUpperCase() : '…';
    if (st.me) $('achBtn').textContent = 'HAUTS FAITS ' + st.me.achCount + '/' + st.me.achTotal;
    $('ticker').textContent = st.events[0] ? '» ' + st.events[0].text : '';

    if (Date.now() > dlg.hold) {
      if (st.dead) setDialog('SYSTÈME', st.name + ' est mort. Paix à son blob. Appuie sur START pour faire éclore un nouvel œuf.', 0, true);
      else setDialog(st.name.toUpperCase(), say(needKey()));
    }
    renderShop(false);
    renderHall();
  }

  // Journal avec likes. On ne reconstruit la liste que si elle a changé, pour ne pas perdre un clic en cours.
  var logKey = '';
  function renderLog() {
    var ul = $('log'), evs = st.events.slice(0, 12);
    var key = evs.map(function (e) { return e.id + ':' + e.likes + ':' + (e.liked ? 1 : 0); }).join(',');
    if (key !== logKey) {
      logKey = key; ul.textContent = '';
      evs.forEach(function (e) {
        var li = document.createElement('li'), txt = document.createElement('span'), t = document.createElement('time');
        t.setAttribute('data-ts', e.ts); txt.appendChild(t); txt.appendChild(document.createTextNode(e.text)); li.appendChild(txt);
        if (e.mine) li.className = 'me';
        if (e.likable) {
          var b = document.createElement('button'), h = document.createElement('i'), n = document.createElement('span');
          b.className = 'like' + (e.liked ? ' on' : '') + (e.mine ? ' mine' : '');
          h.className = 'hrt'; n.textContent = e.likes || '';
          b.appendChild(h); b.appendChild(n);
          if (e.mine) { b.disabled = true; b.title = 'Ton action'; if (!e.likes) b.style.visibility = 'hidden'; }
          else { b.title = e.liked ? 'Retirer mon like' : 'J’aime'; b.onclick = function () { likeEvent(e.id, b); }; }
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
    }
    var times = ul.querySelectorAll('time');
    for (var i = 0; i < times.length; i++) times[i].textContent = ago(+times[i].getAttribute('data-ts'));
  }
  function likeEvent(id, btn) {
    var adding = !btn.classList.contains('on');
    btn.classList.add('likepop');
    if (adding) likeShow(1, false); else Audio8.fx('blip');
    call('POST', '/api/like', { id: id }).then(function (r) { apply(r.body, true); }).catch(function () {});
  }

  /* ---------- Pseudo : choix dans des listes fermées ---------- */
  var nickOpen = false;
  function fillSelect(sel, items, cur) {
    sel.textContent = '';
    items.forEach(function (it) { var o = document.createElement('option'); o.value = it; o.textContent = it.toUpperCase(); if (it === cur) o.selected = true; sel.appendChild(o); });
  }
  function nickPreview() { $('nickPrev').textContent = ($('nickNoun').value + ' ' + $('nickAdj').value + ' ##').toUpperCase(); }
  function openNick() {
    if (!st || !st.me || !st.nickParts) return;
    var parts3 = st.me.nick.split(' ');
    fillSelect($('nickNoun'), st.nickParts.nouns, parts3[0]);
    fillSelect($('nickAdj'), st.nickParts.adjs, parts3[1]);
    nickPreview(); nickOpen = true; $('nickm').hidden = false; Audio8.fx('blip');
  }
  function closeNick() { nickOpen = false; $('nickm').hidden = true; }
  function saveNick() {
    call('POST', '/api/nick', { noun: $('nickNoun').value, adj: $('nickAdj').value }).then(function (r) {
      if (r.code === 200) { Audio8.fx('buy'); closeNick(); setDialog('SYSTÈME', 'Tu t’appelles maintenant ' + r.body.me.nick + ' !', 4000, true); }
      else { Audio8.fx('deny'); setDialog('SYSTÈME', r.body.error === 'cooldown' ? 'Doucement, attends quelques secondes avant de rechanger.' : 'Pseudo refusé.', 3000, true); }
      apply(r.body, true);
    }).catch(function () {});
  }

  /* ---------- Hauts faits ---------- */
  var achQueue = [], achShowing = false, achOpen = false;
  function queueAch(list) {
    list.forEach(function (a) { achQueue.push(a); });
    if (!achShowing) nextAch();
  }
  function nextAch() {
    var a = achQueue.shift(), t = $('achToast');
    if (!a) { achShowing = false; return; }
    achShowing = true;
    $('achToastName').textContent = a.name.toUpperCase();
    $('achToast').querySelector('small').textContent = a.secret ? 'HAUT FAIT SECRET DÉBLOQUÉ !' : 'HAUT FAIT DÉBLOQUÉ !';
    $('achToastDesc').textContent = a.desc + (a.pts ? ' · +' + a.pts + ' PTS' : '');
    t.style.top = Math.ceil($('hud').getBoundingClientRect().bottom + 14) + 'px'; // juste sous le HUD
    t.classList.add('show');
    Audio8.fx('ach'); spawnSparks(cre.x, mouth.top, 24, '#ffd23f');
    setTimeout(function () { t.classList.remove('show'); setTimeout(nextAch, 450); }, 3600);
  }
  function openAch() {
    if (!st) return;
    achOpen = true; $('achm').hidden = false; Audio8.fx('blip');
    call('GET', '/api/achievements').then(function (r) { if (achOpen && r.body.list) renderAch(r.body.list); }).catch(function () {});
  }
  function closeAch() { achOpen = false; $('achm').hidden = true; }
  function renderAch(list) {
    var got = list.filter(function (a) { return a.at; }).length, ul = $('achList');
    // Les secrets encore cachés en fin de liste
    list = list.filter(function (a) { return !(a.secret && !a.at); }).concat(list.filter(function (a) { return a.secret && !a.at; }));
    $('achTitle').textContent = 'HAUTS FAITS ' + got + '/' + list.length;
    ul.textContent = '';
    list.forEach(function (a) {
      var li = document.createElement('li'), ic = document.createElement('i'), box = document.createElement('div'), b = document.createElement('b'), d = document.createElement('span');
      ic.className = 'trophy' + (a.at ? '' : ' off');
      b.textContent = a.name.toUpperCase(); d.textContent = a.desc + (a.pts ? ' (+' + a.pts + ' pts)' : '');
      box.appendChild(b); box.appendChild(d);
      if (a.secret && !a.at) {
        li.className = 'secret';
      } else if (a.at) {
        li.className = 'got' + (a.secret ? ' wassecret' : '');
        var em = document.createElement('em'); em.textContent = 'DÉBLOQUÉ LE ' + new Date(a.at).toLocaleDateString('fr-FR'); box.appendChild(em);
      } else {
        var bar = document.createElement('div'), fill = document.createElement('div');
        bar.className = 'achbar'; fill.style.width = Math.round(100 * a.progress / a.n) + '%'; bar.appendChild(fill); box.appendChild(bar);
        var pr = document.createElement('em'); pr.textContent = a.progress + ' / ' + a.n; pr.style.color = '#5ef2ff'; box.appendChild(pr);
      }
      li.appendChild(ic); li.appendChild(box); ul.appendChild(li);
    });
  }

  /* ---------- Panthéon : top 10 des plus longues vies ---------- */
  var hallOpen = false, hallBoard = 'creatures', leaders = null, leadersAt = 0;
  var BOARD_HELP = {
    creatures: 'LES CRÉATURES QUI ONT VÉCU LE PLUS LONGTEMPS. GARDE LA TIENNE EN VIE POUR GRIMPER !',
    earned: 'LES JOUEURS QUI ONT GAGNÉ LE PLUS DE POINTS DEPUIS LEUR ARRIVÉE.',
    spent: 'LES PLUS GROS DÉPENSIERS DE LA BOUTIQUE.',
    presence: 'LES JOUEURS QUI ONT PASSÉ LE PLUS DE TEMPS AUPRÈS DE LA BÊTE.',
    gamePts: 'LES POINTS GAGNÉS AUX MINI-JEUX. GUETTE LE BOUTON QUI CLIGNOTE !'
  };
  function openHall() { if (!st) return; hallOpen = true; $('hallm').hidden = false; Audio8.fx('blip'); loadLeaders(); renderHall(); }
  function closeHall() { hallOpen = false; $('hallm').hidden = true; }
  function loadLeaders() {
    if (Date.now() - leadersAt < 10000) return;
    leadersAt = Date.now();
    call('GET', '/api/leaders').then(function (r) { if (r.code === 200) { leaders = r.body; renderHall(); } }).catch(function () {});
  }
  function boardVal(b, v) { return b === 'presence' ? fmt(v * 60000) : v + ' PTS'; }
  function renderBoard() {
    var ol = $('hallList'), b = hallBoard, top = leaders ? leaders.boards[b] || [] : [], me = leaders && leaders.me[b];
    ol.textContent = '';
    $('hallEmpty').hidden = top.length > 0;
    $('hallEmpty').textContent = leaders ? 'PERSONNE AU CLASSEMENT POUR L’INSTANT… À TOI DE JOUER !' : 'CHARGEMENT…';
    function line(rank, nick, val, mine) {
      var li = document.createElement('li'), rk = document.createElement('div'), nb = document.createElement('b'), life = document.createElement('div');
      if (mine) li.className = 'me';
      rk.className = 'rk'; rk.textContent = '#' + rank;
      nb.textContent = nick.toUpperCase();
      life.className = 'life'; life.textContent = boardVal(b, val);
      li.appendChild(rk); li.appendChild(nb); li.appendChild(life);
      ol.appendChild(li);
    }
    top.forEach(function (r, i) { line(i + 1, r.nick, r.val, r.me); });
    // Hors du top 10 : on affiche quand même sa propre ligne, avec son rang
    if (me && !top.some(function (r) { return r.me; })) {
      var gap = document.createElement('li'); gap.className = 'gap'; gap.textContent = '· · ·'; ol.appendChild(gap);
      line(me.rank, me.nick, me.val, true);
    }
  }
  function renderHall() {
    if (!hallOpen || !st) return;
    $('hallHelp').textContent = BOARD_HELP[hallBoard];
    var tabs = $('hallTabs').children;
    for (var t = 0; t < tabs.length; t++) tabs[t].classList.toggle('on', tabs[t].getAttribute('data-board') === hallBoard);
    if (hallBoard !== 'creatures') { loadLeaders(); return renderBoard(); }
    $('hallEmpty').textContent = 'AUCUNE CRÉATURE N’EST ENCORE ENTRÉE AU PANTHÉON… LA TIENNE SERA PEUT-ÊTRE LA PREMIÈRE.';
    var rows = (st.hall || []).map(function (h) { return { h: h, alive: false }; });
    // La créature actuelle, à la place qu'elle occuperait si elle mourait maintenant
    if (!st.dead) {
      var lived = Date.now() + offset - st.born;
      var cur = { name: st.name, species: st.species, lived: lived, level: stageOf(st) + 1, actions: st.actions, hatchedBy: st.hatchedBy };
      var pos = rows.filter(function (r) { return r.h.lived >= lived; }).length;
      if (pos < 10) rows.splice(pos, 0, { h: cur, alive: true });
    }
    rows = rows.slice(0, 10);
    var ol = $('hallList'); ol.textContent = '';
    $('hallEmpty').hidden = rows.length > 0;
    rows.forEach(function (r, i) {
      var h = r.h, li = document.createElement('li'), rk = document.createElement('div'), b = document.createElement('b'), info = document.createElement('span'), life = document.createElement('div');
      if (r.alive) li.className = 'alive';
      rk.className = 'rk'; rk.textContent = '#' + (i + 1);
      var sp = h.species && SPECIES[h.species] ? SPECIES[h.species].name : '?';
      b.textContent = h.name.toUpperCase();
      info.textContent = sp + (h.level ? ' · NIV. ' + h.level : '') + (h.actions !== null && h.actions !== undefined ? ' · ' + h.actions + ' SOINS' : '') +
        (h.hatchedBy ? ' · ÉCLOS PAR ' + h.hatchedBy.toUpperCase() : '') + (h.deadAt ? (h.morphed ? ' · MÉTAMORPHOSÉ LE ' : ' · † ') + new Date(h.deadAt).toLocaleDateString('fr-FR') : '');
      life.className = 'life'; life.textContent = fmt(h.lived);
      li.appendChild(rk); li.appendChild(b); li.appendChild(life); li.appendChild(info);
      ol.appendChild(li);
    });
  }

  function pickMusic() {
    if (!started || !st) return;
    // Pendant une évolution, on garde la musique de l'ancien stade jusqu'au flash final
    var si = cre.evo > 0 ? cre.evoFrom : (cre.stage < 0 ? stageOf(st) : cre.stage);
    Audio8.play(st.dead ? 'dead' : TIERS[tierOf(si)].k, st.food < 25);
  }

  /* =====================================================================
     BOUTIQUE
     ===================================================================== */
  var shopOpen = false, shopCat = 'lieux';
  var SWATCH = { orange: '#ff8a1f', bleu: '#3f8cff', vert: '#3fd46a', rose: '#ff6fb8', violet: '#a05eff', or: '#ffd23f' };
  function openShop() { if (!st) return; shopOpen = true; $('shop').hidden = false; Audio8.fx('blip'); renderShop(true); }
  function closeShop() { shopOpen = false; $('shop').hidden = true; }
  // État d'un article : libellé du bouton, désactivé ou non, déjà possédé
  function itemState(it) {
    var now = Date.now() + offset, pts = st.me ? st.me.pts : 0;
    var parts2 = it.id.split(':'), typ = parts2[0], key = parts2[1], cat = typ === 'unacc' ? 'acc' : typ;
    if (st.dead) return { label: 'IL EST MORT', dis: true };
    if (typ === 'place' && (key === 'maison' ? !st.place : st.place && st.place.key === key)) return { label: key === 'maison' ? 'DÉJÀ CHEZ LUI' : 'EN COURS', dis: true, own: key !== 'maison' };
    if (typ === 'color' && st.color === key) return { label: 'ACTUELLE', dis: true, own: true };
    if (typ === 'acc' && st.acc[it.slot] === key) return { label: 'PORTÉ', dis: true, own: true };
    if (typ === 'morph' && st.species === key) return { label: 'ACTUELLE', dis: true, own: true };
    if (typ === 'unacc' && !st.acc[key]) return { label: 'RIEN À RETIRER', dis: true };
    var cd = (st.buyCooldown[cat] || 0) - now;
    if (cd > 0) return { label: 'ATTENDS ' + (cd >= 3600e3 ? fmt(cd) : fmtShort(cd)), dis: true };
    return { label: it.price + ' PTS', dis: pts < it.price };
  }
  function renderShop(full) {
    if (!shopOpen || !st) return;
    $('shopPts').textContent = (st.me ? st.me.pts : 0) + ' PTS';
    var tabs = $('shopTabs').querySelectorAll('button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-cat') === shopCat);
    var now = Date.now() + offset, info;
    if (shopCat === 'lieux') info = st.place ? 'EN SÉJOUR : ' + PLACE_NAMES[st.place.key] + ', ENCORE ' + fmt(Math.max(0, st.place.until - now)) + '. ENSUITE IL RENTRE CHEZ LUI.' : 'IL EST CHEZ LUI. UN SÉJOUR CHANGE LE DÉCOR ET LA VITESSE À LAQUELLE SES JAUGES BAISSENT.';
    else if (shopCat === 'couleurs') info = 'COULEUR ACTUELLE : ' + st.color.toUpperCase() + '.';
    else if (shopCat === 'metamorphose') info = 'ESPÈCE ACTUELLE : ' + SPECIES[speciesOf(st)].name + ', NIV. ' + (stageOf(st) + 1) + '. L’ŒUF MYSTÈRE DONNE UNE AUTRE ESPÈCE AU HASARD, AU NIVEAU 1 : SA VIE ACTUELLE ENTRE AU PANTHÉON. UN SEUL TOUTES LES 6 H.';
    else {
      var worn = Object.keys(st.acc).map(function (k) { return st.acc[k].toUpperCase(); });
      info = worn.length ? 'IL PORTE : ' + worn.join(', ') + '.' : 'IL NE PORTE RIEN.';
    }
    $('shopInfo').textContent = info;
    var list = $('shopList'), items = st.shop.filter(function (it) { return it.cat === shopCat; });
    if (full || list.children.length !== items.length) {
      list.textContent = '';
      items.forEach(function (it) {
        var li = document.createElement('li'), b = document.createElement('b'), p = document.createElement('p'), btn = document.createElement('button');
        if (it.cat === 'couleurs') { var sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = SWATCH[it.id.split(':')[1]]; b.appendChild(sw); }
        b.appendChild(document.createTextNode(it.name.toUpperCase()));
        p.textContent = it.desc;
        btn.className = 'buy'; btn.setAttribute('data-id', it.id);
        btn.onclick = function () { buy(it.id); };
        li.appendChild(b); li.appendChild(btn); li.appendChild(p); list.appendChild(li);
      });
    }
    items.forEach(function (it) {
      var btn = list.querySelector('[data-id="' + it.id + '"]'), s2 = itemState(it);
      btn.textContent = s2.label; btn.disabled = s2.dis; btn.classList.toggle('own', !!s2.own);
    });
  }
  var BUY_ERR = {
    points: 'Pas assez de points ! Reste un peu, occupe-toi de lui, et reviens.',
    cooldown: 'Quelqu’un vient de changer ça. Laisse-lui un peu de temps.',
    already: 'C’est déjà le cas !',
    dead: 'Il est mort… fais d’abord éclore un nouvel œuf.'
  };
  function buy(id) {
    call('POST', '/api/buy', { item: id }).then(function (r) {
      if (r.code === 200) {
        Audio8.fx('buy'); flash(); spawnSparks(cre.x, groundY - 20 * C, 30);
        gaEvent('shop_buy', { item: id });
        if (r.body.events && r.body.events[0]) setDialog('INFO', r.body.events[0].text, 6000, true);
      } else {
        Audio8.fx('deny');
        setDialog('SYSTÈME', BUY_ERR[r.body.error] || 'Achat impossible.', 3500, true);
      }
      apply(r.body, true); renderShop(true);
    }).catch(function () { setDialog('SYSTÈME', 'Erreur réseau.', 3000, true); });
  }

  /* =====================================================================
     MESURE D'AUDIENCE — Google Analytics, seulement si le serveur a un GA_ID
     ET que le visiteur a accepté (choix mémorisé, modifiable via le bouton COOKIES)
     ===================================================================== */
  var gaId = null, gaLoaded = false;
  function gaChoice() { try { return localStorage.getItem('gaConsent'); } catch (e) { return null; } }
  function gaSetup(id) {
    if (!id || gaId) return;
    gaId = id;
    $('cookiesBtn').hidden = false;
    var c = gaChoice();
    if (c === 'yes') gaLoad(); else if (c !== 'no') $('consent').hidden = false;
  }
  function gaLoad() {
    if (gaLoaded || !gaId) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', gaId);
    var sc = document.createElement('script');
    sc.async = true; sc.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
    document.head.appendChild(sc);
  }
  function gaConsent(yes) {
    try { localStorage.setItem('gaConsent', yes ? 'yes' : 'no'); } catch (e) {}
    $('consent').hidden = true;
    if (yes) gaLoad();
    else if (gaLoaded) location.reload(); // retrait du consentement : on recharge la page, sans Google cette fois
  }
  // Événement de jeu (ignoré sans consentement)
  function gaEvent(name, params) { if (gaLoaded && window.gtag) window.gtag('event', name, params || {}); }
  $('consentYes').onclick = function (e) { e.stopPropagation(); gaConsent(true); };
  $('consentNo').onclick = function (e) { e.stopPropagation(); gaConsent(false); };
  $('cookiesBtn').onclick = function (e) { e.currentTarget.blur(); $('consent').hidden = false; };

  /* =====================================================================
     RÉSEAU
     ===================================================================== */
  // Identifiant anonyme du visiteur, pour ses points
  var VID = (function () {
    var v = null;
    try { v = localStorage.getItem('vid'); } catch (e) {}
    if (!v || !/^[a-z0-9]{16,40}$/i.test(v)) {
      var a = new Uint8Array(12);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
      else for (var i = 0; i < a.length; i++) a[i] = Math.random() * 256 | 0;
      v = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem('vid', v); } catch (e) {}
    }
    return v;
  })();

  // Effets visibles quand un autre visiteur agit (déduits des jauges qui remontent)
  function otherAction(data, prev) {
    if (data.food > prev.food + 5) { spawnPizza(1); react('did_feed'); }
    else if (data.clean > prev.clean + 5) { spawnBubbles(6); react('did_wash'); }
    else if (data.fit > prev.fit + 5) { jump(120); react('did_play'); }
    else if (data.sleep > prev.sleep + 5) { spawnZ(2); react('did_rock'); }
    else if (data.joy > prev.joy + 5) { spawnHearts(3, 1); react('did_pet'); }
    else spawnHearts(3, 1);
    Audio8.fx('other');
  }
  function apply(data, mine) {
    if (!data || data.food === undefined) return;
    var prev = st;
    st = data; offset = data.now - Date.now(); if (data.cooldownMs) COOLDOWN = data.cooldownMs;
    if (data.ga) gaSetup(data.ga);
    if (data.me && data.me.achNew && data.me.achNew.length) { queueAch(data.me.achNew); data.me.achNew.forEach(function (a) { gaEvent('unlock_achievement', { achievement_id: a.id }); }); }
    var placeOf = function (d) { return d && d.place && !d.dead ? d.place.key : null; };
    if (prev && prev.events && !mine) {
      var before = {}, gained = 0, forMe = false;
      prev.events.forEach(function (e) { before[e.id] = e.likes; });
      data.events.forEach(function (e) {
        if (before[e.id] !== undefined && e.likes > before[e.id]) { gained += e.likes - before[e.id]; if (e.mine) forMe = true; }
      });
      if (gained > 0) {
        likeShow(gained, forMe);
        setDialog('INFO', forMe ? 'Quelqu’un a aimé une de tes actions !' : 'Un like vient de tomber dans le journal !', 4000, true);
      }
    }
    if (prev && !data.dead && prev.name === data.name && placeOf(prev) !== placeOf(data)) startTravel(placeOf(data));
    if (prev && !data.dead && data.born > prev.born && !data.actions) startEgg(data, !prev.dead); // naissance : éclosion ou œuf mystère
    if (prev && !prev.dead && data.dead) {
      Audio8.fx('die'); shake = 1; flash('red');
      setDialog('SYSTÈME', data.name + ' est mort de faim. GAME OVER.', 6000, true);
    } else if (!mine && prev && !data.dead && prev.name === data.name) {
      if (data.actions > prev.actions) otherAction(data, prev);
      if (!(cre.egg > 0) && data.events[0] && (!prev.events[0] || data.events[0].ts !== prev.events[0].ts || data.events[0].text !== prev.events[0].text)) setDialog('INFO', data.events[0].text, 5000, true);
    }
    pickMusic(); renderHud();
  }
  function call(method, url, body) {
    var o = { method: method, headers: { 'X-Visitor': VID } };
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) { return r.json().then(function (j) { return { code: r.status, body: j }; }); });
  }
  function refresh() {
    call('GET', '/api/state').then(function (r) { apply(r.body, false); })
      .catch(function () { setDialog('SYSTÈME', 'Connexion perdue… on réessaie.', 5000, true); });
  }
  // Présence : le serveur crédite 1 point par minute tant que la page est ouverte et visible
  function ping() {
    if (!started || document.hidden) return;
    call('POST', '/api/ping').then(function (r) { apply(r.body, false); }).catch(function () {});
  }

  function press(id) { var b = $(id); b.classList.add('press'); setTimeout(function () { b.classList.remove('press'); }, 120); }
  function deny(ms) {
    Audio8.fx('deny'); shake = 0.25;
    setDialog('SYSTÈME', 'Doucement ! Encore ' + Math.ceil(ms / 1000) + ' s avant ta prochaine action.', 2500, true);
  }
  function flash(kind) {
    var f = $('flash'); f.className = ''; void f.offsetWidth; f.className = 'on' + (kind ? ' ' + kind : '');
  }

  // Effets immédiats de chaque action (avant même la réponse du serveur)
  var ACT_FX = {
    feed: function () { Audio8.fx('feed'); spawnPizza(C); },
    pet: function () { Audio8.fx('pet'); Audio8.fx('jump'); jump(150); spawnHearts(8, C); floatText('LOVE!', '#ff5ec8'); },
    wash: function () { Audio8.fx('wash'); spawnBubbles(16); floatText('SPLASH!', '#5ef2ff'); },
    play: function () { Audio8.fx('play'); jump(190); cre.dash = 2.2; spawnBall(); floatText('YOUPI!', '#7dff7a'); },
    rock: function () { Audio8.fx('rock'); spawnZ(3); floatText('DODO…', '#aab4ff'); },
    heal: function () {
      Audio8.fx('heal'); floatText('SOIN!', '#7dff7a');
      for (var i = 0; i < 14; i++) parts.push({ k: 'txt', text: '+', col: i % 2 ? '#7dff7a' : '#ffffff', x: cre.x + (Math.random() - 0.5) * 28 * C, y: groundY - Math.random() * 20 * C, vx: 0, vy: -20 - Math.random() * 25, gr: 0, life: 1 + Math.random() * 0.6 });
    }
  };

  function act(kind) {
    if (!started || !st || shopOpen || nickOpen || achOpen || hallOpen || (game && game.live)) return;
    if (kind === 'hatch' ? !st.dead : st.dead) return;
    press(kind);
    var left = lastAct + COOLDOWN - Date.now();
    if (kind !== 'hatch' && left > 0) return deny(left);
    if (kind === 'hatch' && st.canHatchAt - (Date.now() + offset) > 0) return Audio8.fx('deny');
    if (ACT_FX[kind]) ACT_FX[kind]();

    call('POST', '/api/' + kind).then(function (r) {
      if (kind !== 'hatch') {
        if (r.code === 200) lastAct = Date.now();
        else if (r.code === 429 && r.body.error === 'cooldown') { lastAct = Date.now() - (COOLDOWN - (r.body.retryMs || 0)); deny(r.body.retryMs || 0); }
        try { localStorage.setItem('lastAct', String(lastAct)); } catch (e) {}
      }
      if (r.code === 200) gaEvent(kind === 'hatch' ? 'hatch' : 'care_action', kind === 'hatch' ? { species: r.body.species } : { action: kind });
      if (r.code === 200 && kind === 'hatch') {
        showReady(); // l'œuf et l'éclosion sont joués par apply() (naissance détectée)
      }
      if (r.code === 200 && r.body.gained) parts.push({ k: 'txt', text: '+' + r.body.gained + ' PTS', col: '#ffe25e', x: cre.x + 20 * C, y: mouth.top, vx: 0, vy: -18, gr: 0, life: 1.6 });
      if (r.code === 200 && r.body.events && r.body.events[0]) setDialog('INFO', r.body.events[0].text, 6000, true);
      // Aucun événement signé de moi à cet instant = la créature a refusé (jauge déjà pleine)
      if (r.code === 200 && kind !== 'hatch' && r.body.events && r.body.events[0]) {
        var ts0 = r.body.events[0].ts;
        react(r.body.events.some(function (e) { return e.mine && e.ts === ts0; }) ? 'did_' + kind : 'refused');
      }
      apply(r.body, true);
    }).catch(function () { setDialog('SYSTÈME', 'Erreur réseau.', 3000, true); });
  }

  /* =====================================================================
     OUTILS DE DEV — le serveur n'accepte /api/dev qu'en mode dev
     ===================================================================== */
  function devOp(op) {
    // Un réglage d'âge depuis le menu prend le pas sur ?stage= dans l'adresse (sinon le niveau affiché resterait figé)
    if ((op.op === 'age' || op.op === 'evolve') && forceStage >= 0) {
      forceStage = -1;
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    }
    if (op.op === 'points' && op.add) op = { op: 'points', pts: (st.me ? st.me.pts : 0) + op.add };
    // Âge réglé juste avant le prochain stade : l'évolution se joue en direct 3 s plus tard
    if (op.op === 'evolve') {
      var nxt = LEVELS[Math.min(LEVELS.length - 1, stageOf(st) + 1)];
      op = { op: 'age', hours: (nxt - 3000) / 3600e3 };
    }
    if (op.op === 'bonus') { devOp({ op: 'cooldowns' }); setTimeout(spawnBonus, 300); return; }
    if (op.op === 'emote') { cre.emote = null; startEmote(op.k); return; }
    if (op.op === 'game') { gameOffer = null; gameNext = 0; if (op.kind) { var ks0 = op.kind; setTimeout(function () { if (gameOffer) gameOffer.kind = ks0; }, 50); } toggleDev(); return; }
    if (op.op === 'tease') { spawnTease(); tease.x = tease.dir > 0 ? W * 0.1 : W * 0.9; return; }
    if (op.op === 'cooldowns') { lastAct = 0; try { localStorage.removeItem('lastAct'); } catch (e) {} }
    call('POST', '/api/dev', op).then(function (r) {
      if (r.code !== 200) return setDialog('SYSTÈME', 'Outil de dev refusé (' + r.code + ').', 3000, true);
      Audio8.fx('blip'); apply(r.body, true); renderShop(true);
    });
  }
  function toggleDev() { if (st && st.dev) $('devpanel').hidden = !$('devpanel').hidden; }
  $('devpanel').addEventListener('click', function (e) {
    var d = e.target.getAttribute && e.target.getAttribute('data-dev');
    if (d) { e.target.blur(); devOp(JSON.parse(d)); }
  });
  $('devBtn').onclick = function (e) { e.currentTarget.blur(); toggleDev(); };

  /* =====================================================================
     CONTRÔLES
     ===================================================================== */
  function showReady() {
    var r = $('ready'); r.classList.add('on');
    setTimeout(function () { r.classList.remove('on'); }, 1600);
  }
  function toggleFs() {
    var d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
  function renderMute() { $('mute').textContent = Audio8.isMuted() ? 'SON OFF' : 'SON ON'; }
  function toggleMute() { Audio8.setMuted(!Audio8.isMuted()); renderMute(); }

  function start() {
    if (started) return;
    started = true;
    Audio8.init(); Audio8.resume();
    $('title').classList.add('gone');
    setTimeout(function () { Audio8.fx('start'); pickMusic(); }, 50);
    var seen = null; try { seen = localStorage.getItem('nickSeen'); } catch (e) {}
    if (!seen && st && st.me) {
      setTimeout(function () { setDialog('SYSTÈME', 'Bienvenue ' + st.me.nick + ' ! C’est ton pseudo : clique dessus en haut à droite pour le changer.', 8000, true); }, 1700);
      try { localStorage.setItem('nickSeen', '1'); } catch (e) {}
    }
    showReady();
  }

  // Logo animé, lettre par lettre
  (function () {
    var logo = $('logo'), i = 0;
    'LA CRÉATURE'.split(' ').forEach(function (word) {
      var w = document.createElement('span'); w.className = 'w';
      word.split('').forEach(function (ch) {
        var c = document.createElement('span'); c.className = 'c'; c.textContent = ch;
        c.style.color = 'hsl(' + (i * 36) % 360 + ',100%,65%)'; c.style.animationDelay = (i * 0.08) + 's';
        w.appendChild(c); i++;
      });
      logo.appendChild(w);
    });
  })();

  $('title').addEventListener('click', start);
  cv.addEventListener('pointerdown', function (e) {
    if (!started || shopOpen) return;
    if (game && game.live) { var gr = cv.getBoundingClientRect(); gameTap((e.clientX - gr.left) / S, (e.clientY - gr.top) / S); return; }
    if (bonusHit(e.clientX, e.clientY)) claimBonus(); else tapAt(e.clientX, e.clientY);
  });
  cv.addEventListener('pointermove', function (e) {
    if (game && game.live && game.kind === 'catch') { game.keys = 0; game.px = (e.clientX - cv.getBoundingClientRect().left) / S; }
  });
  window.addEventListener('keyup', function (e) { if (game && game.kind === 'catch' && /arrow|^[qad]$/.test(e.key.toLowerCase())) game.keys = 0; });
  $('gameBtn').onclick = function (e) { e.currentTarget.blur(); acceptGame(); };
  cv.addEventListener('pointermove', function (e) { cv.style.cursor = bonusHit(e.clientX, e.clientY) ? 'pointer' : ''; });
  ACTS.forEach(function (a) { $(a[0]).onclick = function () { act(a[0]); }; });
  $('hatch').onclick = function () { act('hatch'); };
  $('mute').onclick = function (e) { e.currentTarget.blur(); toggleMute(); };
  $('fs').onclick = function (e) { e.currentTarget.blur(); toggleFs(); };
  $('shopBtn').onclick = function (e) { e.currentTarget.blur(); if (started) openShop(); };
  $('shopClose').onclick = closeShop;
  $('achBtn').onclick = function (e) { e.currentTarget.blur(); if (started) openAch(); };
  $('achClose').onclick = closeAch;
  $('hallBtn').onclick = function (e) { e.currentTarget.blur(); if (started) openHall(); };
  $('hallClose').onclick = closeHall;
  $('hallm').addEventListener('click', function (e) { if (e.target === $('hallm')) closeHall(); });
  $('hallTabs').addEventListener('click', function (e) {
    var b = e.target.getAttribute && e.target.getAttribute('data-board');
    if (b) { e.target.blur(); hallBoard = b; Audio8.fx('blip'); renderHall(); }
  });
  $('achm').addEventListener('click', function (e) { if (e.target === $('achm')) closeAch(); });
  $('nickBtn').onclick = function (e) { e.currentTarget.blur(); if (started) openNick(); };
  $('nickClose').onclick = closeNick;
  $('nickOk').onclick = saveNick;
  $('nickRand').onclick = function () {
    var n = st.nickParts.nouns, a = st.nickParts.adjs;
    $('nickNoun').value = n[Math.floor(Math.random() * n.length)]; $('nickAdj').value = a[Math.floor(Math.random() * a.length)];
    nickPreview(); Audio8.fx('blip'); $('nickRand').blur();
  };
  $('nickNoun').onchange = $('nickAdj').onchange = nickPreview;
  $('nickm').addEventListener('click', function (e) { if (e.target === $('nickm')) closeNick(); });
  $('logBtn').onclick = function (e) {
    e.currentTarget.blur();
    var lb = $('logbox');
    lb.style.top = Math.ceil($('hud').getBoundingClientRect().bottom + 12) + 'px'; // juste sous le HUD, bouton JOURNAL toujours accessible
    lb.classList.toggle('open');
  };
  $('shop').addEventListener('click', function (e) { if (e.target === $('shop')) closeShop(); });
  $('shopTabs').addEventListener('click', function (e) {
    var c = e.target.getAttribute && e.target.getAttribute('data-cat');
    if (c) { shopCat = c; Audio8.fx('blip'); renderShop(true); }
  });
  renderMute();

  window.addEventListener('keydown', function (e) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (!started) { if (k === 'enter' || k === ' ' || k.length === 1) { e.preventDefault(); start(); } return; }
    if (shopOpen) { if (k === 'escape' || k === 's') closeShop(); return; }
    if (achOpen) { if (k === 'escape' || k === 'h') closeAch(); return; }
    if (hallOpen) { if (k === 'escape' || k === 't') closeHall(); return; }
    if (nickOpen) { if (k === 'escape') closeNick(); else if (k === 'enter') { e.preventDefault(); saveNick(); } return; }
    if (game && game.live) { gameKey(k, e); return; }
    if (gameOffer && k === 'j') { acceptGame(); return; }
    var n = '123456'.indexOf(k);
    if (n >= 0) act(ACTS[n][0]);
    else if (k === 'arrowleft' || k === 'a') act('feed');
    else if (k === 'arrowright' || k === 'b') act('pet');
    else if (k === 'enter' || k === ' ') { e.preventDefault(); if (st && st.dead) act('hatch'); }
    else if (k === 's') openShop();
    else if (k === 'p') openNick();
    else if (k === 'h') openAch();
    else if (k === 't') openHall();
    else if (k === '²' || k === '`') toggleDev();
    else if (k === 'm') toggleMute();
    else if (k === 'f') toggleFs();
  });

  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', function () { setTimeout(resize, 50); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Audio8.suspend();
    else { if (started) Audio8.resume(); refresh(); }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  resize();
  requestAnimationFrame(frame);
  refresh();
  setInterval(refresh, 5000);
  setInterval(ping, 60000);
  setInterval(flushTaps, 4000);
  setInterval(renderHud, 1000);
})();
