/* Mandarin Sprachinseln – Beispiel-App (PWA) */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var VIEW = $('#view'), PLAYER = $('#player'), LISTPLAYER = $('#listplayer');
  var CACHE = 'mandarin-pakete-v1', LSKEY = 'mandarin-lernstand';
  var PUNCT = '，。？！：“”、';

  // ---------- Hilfen ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function cls(score) { return score == null ? 'n' : score >= 75 ? 'g' : score >= 50 ? 'm' : 'b'; }

  // ---------- Lernstand ----------
  var LS;
  function loadLS() {
    try { LS = JSON.parse(localStorage.getItem(LSKEY) || 'null'); } catch (e) { LS = null; }
    if (!LS || LS.format !== 'mandarin-lernstand') LS = { format: 'mandarin-lernstand', version: 1, saetze: {}, tage: {}, einst: { neuProTag: 5, pinyin: true, abrufPause: 5, mischen: false, modus: 'zh' }, insel: 'insel-verabredung', text: 'text-feuertopf' };
  }
  function saveLS() { try { localStorage.setItem(LSKEY, JSON.stringify(LS)); } catch (e) { } }
  function sKey(pid, nr) { return pid + ':' + nr; }
  function sState(pid, nr) { return LS.saetze[sKey(pid, nr)]; }
  var INTERVALLE = [1, 2, 4, 8, 16, 35, 70];
  function rate(pid, nr, r) {
    var st = LS.saetze[sKey(pid, nr)] || (LS.saetze[sKey(pid, nr)] = { stufe: 0, neu: today(), verlauf: [], ton: [] });
    if (r === 'sass') st.stufe = Math.min(st.stufe + 1, INTERVALLE.length - 1);
    else if (r === 'knapp') st.stufe = Math.max(0, st.stufe - 1);
    else st.stufe = 0;
    var best = bestTon(st), step = INTERVALLE[st.stufe];
    if (best != null && best < 70 && st.stufe > 0) step = Math.max(1, Math.round(step / 2)); // schwache Aussprache: früher wiederholen
    st.faellig = addDays(today(), r === 'nicht' ? 1 : step);
    st.verlauf.push({ d: today(), r: r });
    markDay(); saveLS();
  }
  function bestTon(st) { if (!st || !st.ton || !st.ton.length) return null; return Math.max.apply(null, st.ton.slice(-5).map(function (t) { return t.s; })); }
  function lastTon(st) { return st && st.ton && st.ton.length ? st.ton[st.ton.length - 1].s : null; }
  function markDay(min) { var t = LS.tage[today()] || (LS.tage[today()] = { schritte: [] }); if (min) t.schritte.indexOf(min) < 0 && t.schritte.push(min); saveLS(); }
  function introduce(pid, nr) {
    if (!LS.saetze[sKey(pid, nr)]) { LS.saetze[sKey(pid, nr)] = { stufe: 0, neu: today(), faellig: addDays(today(), 1), verlauf: [], ton: [] }; saveLS(); }
  }

  // ---------- Pakete (Cache Storage, offline) ----------
  var KATALOG = null, PKG = {}, URLS = {};
  var hasCache = typeof caches !== 'undefined';
  function pkgUrl(id, f) { return 'pakete/' + id + '/' + f; }
  async function getKatalog() {
    if (KATALOG) return KATALOG;
    try {
      var r = await fetch('pakete/katalog.json', { cache: 'no-cache' });
      if (!r.ok) throw 0;
      KATALOG = await r.json();
      try { localStorage.setItem('mandarin-katalog', JSON.stringify(KATALOG)); } catch (e) { }
      var K0 = KATALOG; setTimeout(function () { syncLoaded(K0); }, 1500);
    } catch (e) {
      try { KATALOG = JSON.parse(localStorage.getItem('mandarin-katalog')); } catch (e2) { }
      if (!KATALOG) KATALOG = { pakete: [] };
    }
    var eigene = [];
    try { eigene = JSON.parse(localStorage.getItem('mandarin-eigene') || '[]'); } catch (e) { }
    eigene.forEach(function (m) { if (!KATALOG.pakete.some(function (p) { return p.id === m.id; })) KATALOG.pakete.push(m); });
    return KATALOG;
  }
  async function isLoaded(id) {
    if (!hasCache) return false;
    try { var c = await caches.open(CACHE); return !!(await c.match(pkgUrl(id, 'paket.json'))); } catch (e) { return false; }
  }
  async function loadPackage(meta, onProgress) {
    var c = await caches.open(CACHE), done = 0, files = meta.dateien;
    var queue = files.slice(), errors = 0;
    async function worker() {
      while (queue.length) {
        var f = queue.shift();
        try { var r = await fetch(pkgUrl(meta.id, f), { cache: 'no-cache' }); if (!r.ok) throw 0; await c.put(pkgUrl(meta.id, f), r); }
        catch (e) { errors++; }
        done++; onProgress && onProgress(done / files.length);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (errors) { await c.delete(pkgUrl(meta.id, 'paket.json')); throw new Error('Laden unvollständig'); }
  }
  async function removePackage(meta) {
    var c = await caches.open(CACHE);
    await Promise.all(meta.dateien.map(function (f) { return c.delete(pkgUrl(meta.id, f)); }));
    delete PKG[meta.id];
  }
  async function getPackage(id) {
    if (PKG[id]) return PKG[id];
    var r = hasCache ? await (await caches.open(CACHE)).match(pkgUrl(id, 'paket.json')) : null;
    if (!r) return null;
    PKG[id] = await r.json();
    return PKG[id];
  }
  async function fileResponse(id, f) {
    if (hasCache) { var r = await (await caches.open(CACHE)).match(pkgUrl(id, f)); if (r) return r; }
    return fetch(pkgUrl(id, f));
  }
  async function audioURL(id, f) {
    var k = id + '/' + f;
    if (URLS[k]) return URLS[k];
    var r = await fileResponse(id, f);
    URLS[k] = URL.createObjectURL(await r.blob());
    return URLS[k];
  }
  var DECODED = {};
  async function decoded(id, f) {
    var k = id + '/' + f;
    if (DECODED[k]) return DECODED[k];
    var r = await fileResponse(id, f), buf = await r.arrayBuffer();
    DECODED[k] = await ctx().decodeAudioData(buf);
    return DECODED[k];
  }

  // ---------- Audio ----------
  var _ctx = null;
  function ctx() { if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)(); if (_ctx.state === 'suspended') _ctx.resume(); return _ctx; }
  var playToken = 0;
  function stopAudio() { playToken++; try { PLAYER.pause(); } catch (e) { } }
  async function play(id, f, rate) {
    var my = ++playToken, url = await audioURL(id, f);
    if (my !== playToken) return false;
    PLAYER.src = url; PLAYER.playbackRate = rate || 1;
    try { PLAYER.preservesPitch = true; PLAYER.webkitPreservesPitch = true; } catch (e) { }
    return new Promise(function (res) {
      PLAYER.onended = function () { res(my === playToken); };
      PLAYER.onerror = function () { res(false); };
      PLAYER.play().catch(function () { res(false); });
    }).then(function (ok) { return ok && my === playToken; });
  }
  function playBlob(url) { stopAudio(); PLAYER.src = url; PLAYER.playbackRate = 1; PLAYER.play().catch(function () { }); }

  // ---------- Aufnahme und Tonkurve ----------
  var micStream = null;
  async function record(maxMs, onLevel) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Mikrofon wird von diesem Browser nicht unterstützt.');
    if (!micStream || !micStream.active) micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    var chunks = [], mr = new MediaRecorder(micStream), stopFn;
    var an = ctx().createAnalyser(), src = ctx().createMediaStreamSource(micStream); src.connect(an); an.fftSize = 512;
    var arr = new Float32Array(512), raf;
    (function loop() { an.getFloatTimeDomainData(arr); var m = 0; for (var i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i])); onLevel && onLevel(m); raf = requestAnimationFrame(loop); })();
    var done = new Promise(function (res) {
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () { cancelAnimationFrame(raf); src.disconnect(); res(new Blob(chunks, { type: mr.mimeType || 'audio/mp4' })); };
    });
    mr.start();
    var timer = setTimeout(function () { if (mr.state === 'recording') mr.stop(); }, maxMs);
    stopFn = function () { clearTimeout(timer); if (mr.state === 'recording') mr.stop(); };
    return { stop: stopFn, done: done };
  }
  var REFAN = {};
  async function refAnalysis(pkg, s) {
    var k = pkg.id + ':' + s.nr;
    if (REFAN[k]) return REFAN[k];
    var b = await decoded(pkg.id, s.audio), a = TonDSP.analyse(b.getChannelData(0), b.sampleRate);
    var g = s.ton.grenzen.map(function (x) { return Math.min(x, a.n); }); g[g.length - 1] = a.n;
    REFAN[k] = { n: a.n, st: a.st, mfcc: a.mfcc, bounds: g, tones: s.ton.toene, alt: s.ton.alt, syl: s.ton.silben };
    return REFAN[k];
  }
  async function scoreBlob(pkg, s, blob) {
    var buf = await blob.arrayBuffer(), ab;
    try { ab = await ctx().decodeAudioData(buf); } catch (e) { return { error: 'Nichts aufgenommen. Mikrofon prüfen und nochmal versuchen.' }; }
    var u = TonDSP.analyse(ab.getChannelData(0), ab.sampleRate);
    if (u.n < 20 || u.peak < -55) return { error: 'Nichts gehört. Näher ans Mikrofon und deutlich sprechen.' };
    var ref = await refAnalysis(pkg, s), res = TonDSP.score(ref, u);
    if (u.n > ref.n * 3) return { error: 'Aufnahme viel länger als die Vorlage. Nur den Satz sprechen.' };
    res.ref = ref; res.user = u;
    var st = LS.saetze[sKey(pkg.id, s.nr)] || (LS.saetze[sKey(pkg.id, s.nr)] = { stufe: 0, neu: today(), faellig: addDays(today(), 1), verlauf: [], ton: [] });
    st.ton.push({ d: today(), s: res.total }); if (st.ton.length > 30) st.ton.shift();
    markDay(); saveLS();
    return res;
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawCurve(canvas, res) {
    var ref = res.ref, u = res.user, dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth, H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr;
    var g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    var top = 8, bot = 26, X = function (i) { return 6 + (W - 12) * i / Math.max(1, ref.n - 1); }, Y = function (v) { return top + (H - top - bot) * (1 - (Math.max(-13, Math.min(13, v)) + 13) / 26); };
    var col = { g: cssVar('--good'), m: cssVar('--mid'), b: cssVar('--bad'), n: cssVar('--muted') };
    var soft = { g: cssVar('--good-soft'), m: cssVar('--mid-soft'), b: cssVar('--bad-soft'), n: 'transparent' };
    res.syl.forEach(function (sy) {
      var a = ref.bounds[sy.k], b = ref.bounds[sy.k + 1];
      g.fillStyle = soft[cls(sy.score)]; g.fillRect(X(a), top, X(b) - X(a), H - top - bot);
      g.strokeStyle = cssVar('--line'); g.beginPath(); g.moveTo(X(a), top); g.lineTo(X(a), H - bot); g.stroke();
      g.fillStyle = col[cls(sy.score)]; g.font = '13px system-ui,sans-serif'; g.textAlign = 'center';
      g.fillText(ref.syl[sy.k], (X(a) + X(b)) / 2, H - 8);
    });
    g.strokeStyle = cssVar('--line'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke(); g.setLineDash([]);
    // Vorlage
    g.lineWidth = 3; g.strokeStyle = cssVar('--refline'); g.beginPath(); var pen = false;
    for (var i = 0; i < ref.n; i++) { var v = ref.st[i]; if (v === v) { pen ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); pen = true; } else pen = false; }
    g.stroke();
    // Eigene Kurve, auf die Zeit der Vorlage abgebildet
    var sylOf = function (i) { for (var k = 0; k < res.syl.length; k++) if (i < ref.bounds[k + 1]) return res.syl[k]; return res.syl[res.syl.length - 1]; };
    g.lineWidth = 3; var prev = null;
    for (i = 0; i < ref.n; i++) {
      var w = u.st[res.map[i]];
      if (w === w && prev) { g.strokeStyle = col[cls(sylOf(i).score)] || col.n; g.beginPath(); g.moveTo(X(prev[0]), Y(prev[1])); g.lineTo(X(i), Y(w)); g.stroke(); }
      prev = w === w ? [i, w] : null;
    }
  }

  // ---------- Wort-Klick ----------
  function sentenceHTML(pkg, s, opts) {
    opts = opts || {};
    var out = '<div class="zh' + (LS.einst.pinyin ? '' : ' nopy') + '">';
    var parts = [];
    s.w.forEach(function (t) {
      if (t.length === 1) {
        var pu = '<span class="pu">' + esc(t[0]) + '</span>';
        if (parts.length && !/[“]/.test(t[0])) parts[parts.length - 1] += pu; else parts.push(pu);
      } else {
        var wb = '<button class="w" data-w="' + esc(t[0]) + '"><span class="p">' + esc(t[1]) + '</span><span class="h">' + esc(t[0]) + '</span></button>';
        if (parts.length && /“<\/span>$/.test(parts[parts.length - 1])) parts[parts.length - 1] += wb; else parts.push(wb);
      }
    });
    return out + parts.map(function (p) { return '<span class="grp">' + p + '</span>'; }).join('') + '</div>';
  }
  function bindWords(el, pkg) {
    el.querySelectorAll('.w').forEach(function (b) {
      b.onclick = function () { el.querySelectorAll('.w.sel').forEach(function (x) { x.classList.remove('sel'); }); b.classList.add('sel'); showWord(pkg, b.dataset.w); };
    });
  }
  function showWord(pkg, w) {
    var e = pkg.woerter[w] || {}, sh = $('#sheet'), pys = (e.py || '').split(' ');
    var html = '<div class="row"><span class="hz">' + esc(w) + '</span><span class="spacer"></span><button class="btn small" id="wplay">▶︎ Anhören</button><button class="btn small" id="wclose">Schliessen</button></div>' +
      '<div><span class="py">' + esc(e.py) + '</span>' + (e.art ? '<span class="art">' + esc(e.art) + '</span>' : '') + '</div>' +
      '<p class="de" style="font-weight:600">' + esc(e.de) + '</p>' + (e.herl ? '<p>' + esc(e.herl) + '</p>' : '');
    var chars = Array.from(w);
    if (chars.length > 1) {
      html += '<h3>Die einzelnen Zeichen</h3><div class="chars">';
      chars.forEach(function (c, i) {
        var z = pkg.zeichen[c] || {};
        html += '<div><span class="c">' + esc(c) + '</span><span><b>' + esc(pys[i] || '') + '</b> · ' + esc(z.de || '') + '<br><span class="muted small">' + esc(z.herl || '') + '</span></span></div>';
      });
      html += '</div>';
    }
    sh.innerHTML = html; sh.classList.remove('hidden'); $('#veil').classList.remove('hidden');
    $('#wplay').onclick = function () { if (e.audio) play(pkg.id, e.audio); };
    $('#wclose').onclick = closeSheet;
    if (e.audio) play(pkg.id, e.audio);
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); $('#veil').classList.add('hidden'); document.querySelectorAll('.w.sel').forEach(function (x) { x.classList.remove('sel'); }); }
  $('#veil').onclick = closeSheet;

  // ---------- Satzkarte (Hören, Shadowing, Aufnahme) ----------
  function satzKarte(pkg, s, opts) {
    opts = opts || {};
    var el = h('<div class="card"></div>');
    el.innerHTML =
      (opts.hideZh ? '' : sentenceHTML(pkg, s)) +
      (opts.hideZh ? '' : '<p class="de">' + esc(s.de) + '</p>') +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn small" data-a="normal">▶︎ Normal</button>' +
      '<button class="btn small" data-a="slow">▶︎ Langsam</button>' +
      (opts.shadow ? '<button class="btn small" data-a="loop">🔁 Shadowing</button>' : '') +
      '<span class="spacer"></span><button class="btn small" data-a="py" aria-pressed="' + !!LS.einst.pinyin + '">Pinyin</button>' +
      '</div>' +
      '<div class="shadow-ind" data-r="ind"></div>' +
      (s.ton ? '<div class="row"><button class="btn rec" data-a="rec">● Aufnehmen und bewerten</button><button class="btn small hidden" data-a="mine">▶︎ Meine Aufnahme</button></div><div class="tonebox" data-r="tone"></div>' : '');
    bindWords(el, pkg);
    var ind = el.querySelector('[data-r=ind]'), myBlobURL = null;
    el.querySelector('[data-a=normal]').onclick = function () { play(pkg.id, s.audio); };
    el.querySelector('[data-a=slow]').onclick = function () { play(pkg.id, s.langsam); };
    el.querySelector('[data-a=py]').onclick = function () { setPinyin(!LS.einst.pinyin); };
    var lp = el.querySelector('[data-a=loop]');
    if (lp) lp.onclick = async function () {
      if (lp.dataset.on) { stopAudio(); lp.dataset.on = ''; lp.textContent = '🔁 Shadowing'; ind.textContent = ''; return; }
      lp.dataset.on = '1'; lp.textContent = '■ Stopp';
      var plan = [[s.langsam, 'Langsam, zeitgleich mitsprechen (1/4)'], [s.langsam, 'Langsam, zeitgleich mitsprechen (2/4)'], [s.audio, 'Normal, zeitgleich mitsprechen (3/4)'], [s.audio, 'Normal, zeitgleich mitsprechen (4/4)']];
      for (var i = 0; i < plan.length; i++) {
        ind.textContent = '🗣 ' + plan[i][1];
        var ok = await play(pkg.id, plan[i][0]); if (!ok || !lp.dataset.on) break;
        await sleep(700);
      }
      if (lp.dataset.on) ind.textContent = 'Jetzt allein sprechen und aufnehmen.';
      lp.dataset.on = ''; lp.textContent = '🔁 Shadowing';
      opts.onShadowDone && opts.onShadowDone();
    };
    var rb = el.querySelector('[data-a=rec]'), mine = el.querySelector('[data-a=mine]'), tone = el.querySelector('[data-r=tone]');
    if (rb) {
      var rec = null;
      rb.onclick = async function () {
        if (rec) { rec.stop(); return; }
        stopAudio();
        try { rec = await record(Math.max(4000, 2.5 * 1000 * (s.ton.grenzen[s.ton.grenzen.length - 1] / 100) + 1500), function (lvl) { rb.style.boxShadow = '0 0 0 ' + Math.round(Math.min(1, lvl * 3) * 10) + 'px var(--bad-soft)'; }); }
        catch (e) { tone.innerHTML = '<div class="msg">Mikrofon nicht verfügbar: ' + esc(e.message || e.name) + '. In Safari: Einstellungen › Safari › Mikrofon › Erlauben.</div>'; return; }
        rb.textContent = '■ Fertig'; tone.innerHTML = '<p class="muted small">Sprich jetzt den Satz …</p>';
        var blob = await rec.done; rec = null; rb.textContent = '● Nochmal aufnehmen'; rb.style.boxShadow = '';
        if (myBlobURL) URL.revokeObjectURL(myBlobURL); myBlobURL = URL.createObjectURL(blob); mine.classList.remove('hidden');
        tone.innerHTML = '<p class="muted small">Tonkurve wird verglichen …</p>';
        await sleep(30);
        try { showResult(tone, await scoreBlob(pkg, s, blob)); opts.onScored && opts.onScored(); }
        catch (e) { tone.innerHTML = '<div class="msg">Auswertung fehlgeschlagen: ' + esc(e.message || e) + '</div>'; }
      };
      mine.onclick = function () { if (myBlobURL) playBlob(myBlobURL); };
    }
    return el;
  }
  function showResult(box, res) {
    if (res.error) { box.innerHTML = '<div class="msg">' + esc(res.error) + '</div>'; return; }
    var notes = res.syl.filter(function (y) { return y.score != null && y.score < 75; }), red = notes.filter(function (y) { return y.score < 50; }).length;
    var c = res.total >= 85 && !red ? 'g' : res.total >= 60 ? 'm' : 'b';
    var word = c === 'g' ? 'Töne getroffen' : c === 'm' ? (notes.length === 1 ? 'Fast: 1 Silbe üben' : 'Teilweise: ' + notes.length + ' Silben üben') : 'Noch üben';
    box.innerHTML = '<div class="row"><span class="score" style="color:var(--' + (c === 'g' ? 'good' : c === 'm' ? 'mid' : 'bad') + ')">' + res.total + ' %</span><span>' + word + '</span></div>' +
      '<canvas></canvas>' +
      '<div class="legend"><i style="background:var(--refline)"></i>Vorlage<i style="background:var(--good)"></i>deine Kurve (Farbe = Bewertung der Silbe)</div>' +
      '<div class="syl">' + res.syl.map(function (y) { return '<span class="' + cls(y.score) + '">' + esc(res.ref.syl[y.k]) + (y.score == null ? '' : ' ' + y.score) + '</span>'; }).join('') + '</div>' +
      (notes.length ? '<ul class="notes">' + notes.map(function (y) { return '<li><b>' + esc(res.ref.syl[y.k]) + '</b>: ' + esc(y.note) + '</li>'; }).join('') + '</ul>' : '<p class="small muted">Alle bewerteten Silben getroffen. Neutrale Töne (grau) zählen nicht.</p>');
    drawCurve(box.querySelector('canvas'), res);
  }

  // ---------- Tabs ----------
  var TAB = 'heute';
  function go(tab) {
    TAB = tab; stopAudio(); closeSheet();
    document.querySelectorAll('#tabs button').forEach(function (b) { b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
    VIEW.innerHTML = ''; window.scrollTo(0, 0);
    ({ heute: viewHeute, inseln: viewInseln, hoeren: viewHoeren, texte: viewTexte, stand: viewStand })[tab]();
  }
  document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); }; });

  async function needPackage(id, el) {
    var kat = await getKatalog(), meta = kat.pakete.filter(function (p) { return p.id === id; })[0];
    var pkg = await getPackage(id);
    if (pkg) return pkg;
    if (!meta) { el.appendChild(h('<div class="msg">Paket nicht gefunden.</div>')); return null; }
    var box = h('<div class="card"><b>' + esc(meta.titel) + '</b><p class="muted small">Noch nicht geladen (' + Math.round(meta.groesse / 1024) + ' KB). Einmal laden, danach offline verfügbar.</p><button class="btn primary">Jetzt laden</button><div class="progress hidden"><div></div></div></div>');
    el.appendChild(box);
    return new Promise(function (res) {
      box.querySelector('button').onclick = async function () {
        var pr = box.querySelector('.progress'); pr.classList.remove('hidden');
        try { await loadPackage(meta, function (p) { pr.firstChild.style.width = Math.round(p * 100) + '%'; }); box.remove(); res(await getPackage(id)); }
        catch (e) { box.appendChild(h('<div class="msg">Laden nicht möglich. Zum Laden ist Internet nötig.</div>')); }
      };
    });
  }

  // ---------- Heute (geführte Routine) ----------
  var SCHRITTE = [
    { id: 'abruf', titel: 'Aktive Erinnerung', min: 12, text: 'Deutsch sehen, Chinesisch sprechen, dann aufdecken.' },
    { id: 'neu', titel: 'Neue Sätze', min: 5, text: 'Neue Sätze der Insel, mit Wort-Erklärung.' },
    { id: 'shadow', titel: 'Shadowing', min: 8, text: 'Zeitgleich mitsprechen, dann Aufnahme mit Tonkurve.' },
    { id: 'text', titel: 'Pre-Input-Text', min: 5, text: 'Erst lesen, dann nur hören.' }
  ];
  function dayDone(id) { var t = LS.tage[today()]; return !!(t && t.schritte.indexOf(id) >= 0); }
  async function loadedInseln() {
    var kat = await getKatalog(), out = [];
    for (var i = 0; i < kat.pakete.length; i++) { var m = kat.pakete[i]; if (m.typ === 'insel' && !m.bald && await isLoaded(m.id)) out.push(await getPackage(m.id)); }
    return out;
  }
  var ALLP = [];
  async function viewHeute() {
    var pkg = await needPackage(LS.insel, VIEW);
    if (!pkg) return;
    ALLP = await loadedInseln();
    var due = dueAll(), fresh = newList(pkg);
    var el = h('<div></div>');
    var nextIsl = null;
    if (!fresh.length) {
      var kat = await getKatalog(), ins = kat.pakete.filter(function (m) { return m.typ === 'insel' && !m.bald && m.id !== pkg.id; });
      nextIsl = ins.filter(function (m) { var p = ALLP.filter(function (x) { return x.id === m.id; })[0]; return !p || p.saetze.some(function (s) { return !sState(m.id, s.nr); }); })[0] || null;
    }
    el.innerHTML = '<div class="card"><h2 style="margin-top:0">Heute lernen</h2><p class="muted small">Insel «' + esc(pkg.titel) + '» · ' + due.length + ' fällig · ' + fresh.length + ' neu · ca. 30 Minuten</p>' +
      (nextIsl ? '<div class="msg">Alle Sätze dieser Insel sind eingeführt. <button class="btn small primary" id="nextisl">Weiter mit «' + esc(nextIsl.titel) + '»</button></div>' : '') +
      '<ol class="steps">' + SCHRITTE.map(function (s, i) { return '<li class="' + (dayDone(s.id) ? 'done' : '') + '"><span class="n">' + (dayDone(s.id) ? '✓' : i + 1) + '</span><span class="t"><b>' + s.titel + ' <span class="muted small">· ' + s.min + ' Min.</span></b><span class="muted small">' + s.text + '</span></span><button class="btn small" data-s="' + i + '">' + (dayDone(s.id) ? 'Nochmal' : 'Start') + '</button></li>'; }).join('') + '</ol>' +
      '<button class="btn primary big" id="startall" style="margin-top:12px">▶︎ ' + (SCHRITTE.some(function (s) { return dayDone(s.id); }) ? 'Weiter mit dem nächsten Schritt' : 'Heute lernen starten') + '</button></div>' +
      '<p class="muted small">Unterwegs: Tab «Hören» spielt alle Sätze als Playlist, auch bei gesperrtem Bildschirm.</p>';
    VIEW.appendChild(el);
    el.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { runStep(pkg, +b.dataset.s, false); }; });
    if (nextIsl) $('#nextisl').onclick = function () { LS.insel = nextIsl.id; saveLS(); go('heute'); };
    $('#startall').onclick = function () { var i = SCHRITTE.findIndex(function (s) { return !dayDone(s.id); }); runStep(pkg, i < 0 ? 0 : i, true); };
  }
  function dueAll() {
    var out = [];
    ALLP.forEach(function (p) { dueList(p).forEach(function (s) { out.push({ pkg: p, s: s }); }); });
    return out;
  }
  function dueList(pkg) {
    return pkg.saetze.filter(function (s) { var st = sState(pkg.id, s.nr); return st && st.neu < today() && st.faellig <= today(); });
  }
  function newList(pkg) {
    var introducedToday = pkg.saetze.filter(function (s) { var st = sState(pkg.id, s.nr); return st && st.neu === today(); });
    var rest = pkg.saetze.filter(function (s) { return !sState(pkg.id, s.nr); });
    var n = Math.max(0, LS.einst.neuProTag - introducedToday.length);
    return introducedToday.concat(rest.slice(0, n));
  }
  function stepHead(i, chain) {
    var s = SCHRITTE[i];
    return h('<div><button class="link" id="back">‹ Übersicht</button><div class="stephead"><span class="lbl">Schritt ' + (i + 1) + ' von 4 · ca. ' + s.min + ' Min.</span></div><h2 style="margin-top:0">' + s.titel + '</h2></div>');
  }
  function finishStep(pkg, i, chain) {
    markDay(SCHRITTE[i].id);
    if (chain && i < 3) runStep(pkg, i + 1, true);
    else if (chain) { VIEW.innerHTML = ''; VIEW.appendChild(h('<div class="card"><h2 style="margin-top:0">Geschafft für heute 🎉</h2><p>Alle vier Schritte erledigt. Der Lerntag ist im Kalender eingetragen.</p><p class="muted small">Zum Vertiefen: Playlist im Tab «Hören» beim Pendeln oder Spazieren.</p><button class="btn primary" id="ov">Zur Übersicht</button></div>')); $('#ov').onclick = function () { go('heute'); }; }
    else go('heute');
  }
  async function runStep(pkg, i, chain) {
    stopAudio(); VIEW.innerHTML = ''; window.scrollTo(0, 0);
    var head = stepHead(i, chain); VIEW.appendChild(head); $('#back').onclick = function () { go('heute'); };
    var body = h('<div></div>'); VIEW.appendChild(body);
    var next = function () { finishStep(pkg, i, chain); };
    if (SCHRITTE[i].id === 'abruf') stepAbruf(pkg, body, next);
    if (SCHRITTE[i].id === 'neu') stepNeu(pkg, body, next);
    if (SCHRITTE[i].id === 'shadow') stepShadow(pkg, body, next);
    if (SCHRITTE[i].id === 'text') stepText(body, next);
  }

  // Schritt 1: aktive Erinnerung
  function stepAbruf(cur, body, next) {
    var queue = dueAll();
    if (!queue.length) {
      var tomorrow = 0; ALLP.forEach(function (p) { tomorrow += p.saetze.filter(function (s) { var st = sState(p.id, s.nr); return st && st.neu === today(); }).length; });
      body.appendChild(h('<div class="card"><p>Heute ist nichts fällig.</p><p class="muted small">' + (tomorrow ? 'Die ' + tomorrow + ' Sätze von heute kommen morgen zum ersten Mal dran.' : 'Sobald du neue Sätze gelernt hast, kommen sie hier in Abständen wieder.') + '</p><button class="btn primary" id="nx">Weiter</button></div>'));
      $('#nx').onclick = next; return;
    }
    var total = queue.length, doneN = 0;
    var prog = h('<div class="progress"><div></div></div>'); body.appendChild(prog);
    var area = h('<div></div>'); body.appendChild(area);
    function show() {
      prog.firstChild.style.width = Math.round(100 * doneN / total) + '%';
      if (!queue.length) { area.innerHTML = '<div class="card"><p>Alle fälligen Sätze abgefragt.</p><button class="btn primary" id="nx">Weiter</button></div>'; $('#nx').onclick = next; return; }
      var it = queue[0], pkg = it.pkg, s = it.s, hintLvl = 0, chars = s.w.filter(function (t) { return t.length > 1; });
      area.innerHTML = '';
      var c = h('<div class="card"><p class="muted small">Sag auf Chinesisch:</p><p class="big-de">' + esc(s.de) + '</p><div class="hint" data-r="hint"></div><div class="row"><button class="btn small" data-a="hint">Hinweis</button><span class="spacer"></span><button class="btn primary" data-a="show" disabled>Aufdecken (3)</button></div><div data-r="sol"></div></div>');
      area.appendChild(c);
      var sb = c.querySelector('[data-a=show]'), n = 3;
      var t = setInterval(function () { n--; if (n <= 0) { clearInterval(t); sb.disabled = false; sb.textContent = 'Aufdecken'; } else sb.textContent = 'Aufdecken (' + n + ')'; }, 1000);
      c.querySelector('[data-a=hint]').onclick = function () {
        hintLvl++;
        var hz = c.querySelector('[data-r=hint]');
        if (hintLvl === 1) hz.textContent = 'Beginnt mit: ' + chars[0][0] + ' …';
        else { hz.textContent = chars.map(function (w) { return w[1]; }).join(' '); }
      };
      sb.onclick = function () {
        clearInterval(t); sb.remove(); c.querySelector('[data-a=hint]').remove(); c.querySelector('[data-r=hint]').remove();
        var sol = c.querySelector('[data-r=sol]');
        sol.appendChild(satzKarte(pkg, s, { hideDe: true }));
        sol.appendChild(h('<div><p class="muted small" style="margin-bottom:0">Wie gut sass der Satz?</p><div class="rate"><button class="btn g" data-r="sass">Sass</button><button class="btn m" data-r="knapp">Knapp</button><button class="btn b" data-r="nicht">Nicht gewusst</button></div></div>'));
        play(pkg.id, s.audio);
        sol.querySelectorAll('.rate button').forEach(function (b) {
          b.onclick = function () {
            rate(pkg.id, s.nr, b.dataset.r); queue.shift();
            if (b.dataset.r === 'nicht' && (it.rep = (it.rep || 0) + 1) <= 2) queue.push(it); else doneN++;
            stopAudio(); show(); window.scrollTo(0, 0);
          };
        });
      };
    }
    show();
  }

  // Schritt 2: neue Sätze
  function stepNeu(pkg, body, next) {
    var list = newList(pkg);
    if (!list.length) { body.appendChild(h('<div class="card"><p>Alle Sätze dieser Insel sind eingeführt. 👏</p><p class="muted small">Neue Inseln erscheinen im Tab «Inseln».</p><button class="btn primary" id="nx">Weiter</button></div>')); $('#nx').onclick = next; return; }
    body.appendChild(h('<p class="muted small">' + list.length + ' Sätze. Wörter antippen für Bedeutung und Herleitung der Zeichen. Jeden Satz zwei-, dreimal anhören.</p>'));
    var i = 0, area = h('<div></div>'), prog = h('<div class="progress"><div></div></div>');
    body.appendChild(prog); body.appendChild(area);
    function show() {
      prog.firstChild.style.width = Math.round(100 * i / list.length) + '%';
      area.innerHTML = '';
      var s = list[i];
      area.appendChild(h('<p class="muted small">Satz ' + (i + 1) + ' von ' + list.length + '</p>'));
      area.appendChild(satzKarte(pkg, s, {}));
      var nb = h('<div class="row"><button class="btn" id="pv"' + (i ? '' : ' disabled') + '>‹ Zurück</button><span class="spacer"></span><button class="btn primary" id="nv">' + (i < list.length - 1 ? 'Nächster Satz ›' : 'Fertig ›') + '</button></div>');
      area.appendChild(nb);
      introduce(pkg.id, s.nr);
      play(pkg.id, s.audio);
      $('#pv').onclick = function () { i--; stopAudio(); show(); };
      $('#nv').onclick = function () { stopAudio(); if (i < list.length - 1) { i++; show(); window.scrollTo(0, 0); } else next(); };
    }
    show();
  }

  // Schritt 3: Shadowing mit Aufnahme
  function stepShadow(pkg, body, next) {
    var set = pkg.saetze.filter(function (s) { var st = sState(pkg.id, s.nr); return st && (st.neu === today() || (st.verlauf.length && st.verlauf[st.verlauf.length - 1].d === today())); });
    var weak = pkg.saetze.filter(function (s) { var st = sState(pkg.id, s.nr), b = bestTon(st); return st && b != null && b < 70 && set.indexOf(s) < 0; });
    set = set.concat(weak).slice(0, 8);
    if (!set.length) set = pkg.saetze.slice(0, 3);
    body.appendChild(h('<p class="muted small">Pro Satz: «Shadowing» drücken und zeitgleich laut mitsprechen (2× langsam, 2× normal). Danach allein sprechen und aufnehmen. Ziel: grüne Silben.</p>'));
    var i = 0, area = h('<div></div>'), prog = h('<div class="progress"><div></div></div>');
    body.appendChild(prog); body.appendChild(area);
    function show() {
      prog.firstChild.style.width = Math.round(100 * i / set.length) + '%';
      area.innerHTML = '';
      var s = set[i];
      area.appendChild(h('<p class="muted small">Satz ' + (i + 1) + ' von ' + set.length + '</p>'));
      area.appendChild(satzKarte(pkg, s, { shadow: true }));
      area.appendChild(h('<div class="row"><button class="btn" id="pv"' + (i ? '' : ' disabled') + '>‹ Zurück</button><span class="spacer"></span><button class="btn primary" id="nv">' + (i < set.length - 1 ? 'Nächster Satz ›' : 'Fertig ›') + '</button></div>'));
      $('#pv').onclick = function () { i--; stopAudio(); show(); };
      $('#nv').onclick = function () { stopAudio(); if (i < set.length - 1) { i++; show(); window.scrollTo(0, 0); } else next(); };
    }
    show();
  }

  // Schritt 4: Pre-Input-Text
  async function stepText(body, next) {
    var pkg = await needPackage(LS.text, body);
    if (!pkg) return;
    textReader(pkg, body, next);
  }
  function textReader(pkg, body, next) {
    var phase = 'lesen';
    var bar = h('<div class="row" style="margin-bottom:8px"><div class="seg"><button data-p="lesen" aria-pressed="true">1. Lesen</button><button data-p="hoeren" aria-pressed="false">2. Hören</button></div><span class="spacer"></span><button class="btn small" data-a="py" aria-pressed="' + !!LS.einst.pinyin + '">Pinyin</button></div>');
    var area = h('<div></div>');
    body.appendChild(h('<h3 style="margin-top:0">' + esc(pkg.titel) + '</h3>'));
    body.appendChild(bar); body.appendChild(area);
    bar.querySelector('[data-a=py]').onclick = function () { setPinyin(!LS.einst.pinyin); };
    bar.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { phase = b.dataset.p; bar.querySelectorAll('[data-p]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); render(); }; });
    function render() {
      stopAudio(); area.innerHTML = '';
      if (phase === 'lesen') {
        area.appendChild(h('<p class="muted small">Zuerst den ganzen Text verstehen: unbekannte Wörter antippen, Übersetzung pro Satz mit «Deutsch» aufdecken. Erst dann zu «2. Hören».</p>'));
        var tv = h('<div class="card textview"></div>');
        pkg.saetze.forEach(function (s) {
          var p = h('<p></p>');
          p.innerHTML = sentenceHTML(pkg, s) + '<div class="row"><button class="btn small" data-a="pl">▶︎</button><button class="btn small" data-a="de">Deutsch</button></div><div class="de hidden">' + esc(s.de) + '</div>';
          p.querySelector('[data-a=pl]').onclick = function () { play(pkg.id, s.audio); };
          p.querySelector('[data-a=de]').onclick = function () { p.querySelector('.de').classList.toggle('hidden'); };
          tv.appendChild(p);
        });
        bindWords(tv, pkg);
        area.appendChild(tv);
        var nb = h('<button class="btn primary big">Verstanden, jetzt hören ›</button>');
        nb.onclick = function () { bar.querySelector('[data-p=hoeren]').click(); window.scrollTo(0, 0); };
        area.appendChild(nb);
      } else {
        var c = h('<div class="card"><p class="muted small">Jetzt ohne Text hören. Du solltest fast alles verstehen.</p><div class="now" data-r="now"></div><div class="row"><button class="btn primary" data-a="go">▶︎ Ganzen Text abspielen</button><label class="chk"><input type="checkbox" data-a="show"> Text mitlesen</label></div><div class="row" style="margin-top:6px"><span class="small muted">Tempo</span><div class="seg"><button data-t="slow" aria-pressed="false">Langsam</button><button data-t="norm" aria-pressed="true">Normal</button></div></div></div>');
        area.appendChild(c);
        var tempo = 'norm', running = false;
        c.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { tempo = b.dataset.t; c.querySelectorAll('[data-t]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }; });
        c.querySelector('[data-a=go]').onclick = async function () {
          var btn = this;
          if (running) { running = false; stopAudio(); btn.textContent = '▶︎ Ganzen Text abspielen'; return; }
          running = true; btn.textContent = '■ Stopp';
          for (var i = 0; i < pkg.saetze.length && running; i++) {
            var s = pkg.saetze[i], now = c.querySelector('[data-r=now]');
            now.innerHTML = c.querySelector('[data-a=show]').checked ? sentenceHTML(pkg, s) : '<span class="muted">Satz ' + (i + 1) + ' von ' + pkg.saetze.length + '</span>';
            bindWords(now, pkg);
            var ok = await play(pkg.id, tempo === 'slow' ? s.langsam : s.audio);
            if (!ok) break;
            await sleep(600);
          }
          running = false; btn.textContent = '▶︎ Nochmal abspielen';
        };
        if (next) { var nb2 = h('<button class="btn primary big">Fertig ›</button>'); nb2.onclick = function () { stopAudio(); next(); }; area.appendChild(nb2); }
      }
    }
    render();
  }

  // ---------- Inseln ----------
  async function viewInseln() {
    var kat = await getKatalog();
    VIEW.appendChild(h('<h2 style="margin-top:0">Sprachinseln</h2>'));
    var top = h('<div class="row" style="margin-bottom:10px"><button class="btn primary" data-a="neu">＋ Neue Insel</button><label class="btn">Paket-Datei laden<input type="file" accept=".json,application/json" hidden></label></div>');
    VIEW.appendChild(top);
    top.querySelector('[data-a=neu]').onclick = function () { editInsel(null); };
    top.querySelector('input').onchange = async function () {
      var f = this.files[0]; if (!f) return;
      try { var meta = await importBundle(JSON.parse(await f.text())); KATALOG = null; go('inseln'); }
      catch (e) { VIEW.insertBefore(h('<div class="msg">Das ist keine gültige Paket-Datei.</div>'), VIEW.children[1]); }
    };
    var entw = entwuerfe();
    if (entw.length) {
      VIEW.appendChild(h('<h3>Deine Entwürfe</h3>'));
      var el = h('<div class="list"></div>'); VIEW.appendChild(el);
      entw.forEach(function (d) {
        var it = h('<button class="item"><div class="main"><b>' + esc(d.titel || 'Ohne Titel') + '</b><div class="meta">' + d.saetze.filter(Boolean).length + ' Sätze · ' + (d.gesendet ? 'gesendet am ' + esc(d.gesendet) + ', Paket folgt' : 'noch nicht gesendet') + '</div></div><span class="badge ' + (d.gesendet ? 'g' : 'm') + '">' + (d.gesendet ? 'gesendet' : 'Entwurf') + '</span></button>');
        it.onclick = function () { editInsel(d.id); };
        el.appendChild(it);
      });
      VIEW.appendChild(h('<h3>Inseln</h3>'));
    }
    var list = h('<div class="list"></div>'); VIEW.appendChild(list);
    var inseln = kat.pakete.filter(function (p) { return p.typ === 'insel'; });
    var themen = [];
    inseln.forEach(function (p) { if (themen.indexOf(p.thema) < 0) themen.push(p.thema); });
    for (var t = 0; t < themen.length; t++) {
      if (themen.length > 1) list.appendChild(h('<div class="muted small" style="margin-top:8px;font-weight:600">' + esc(themen[t]) + '</div>'));
      var grp = inseln.filter(function (p) { return p.thema === themen[t]; });
      for (var i = 0; i < grp.length; i++) list.appendChild(await pkgItem(grp[i], function (meta) { openInsel(meta.id); }));
    }
    VIEW.appendChild(h('<p class="muted small">Eigene Inseln: «Neue Insel» antippen, Sätze auf Deutsch tippen oder diktieren, an Claude senden. Das fertige Paket erscheint nach etwa 10 Minuten hier. Geladene Pakete bleiben offline verfügbar.</p>'));
  }

  // ---------- Eigene Inseln: Sätze erfassen ----------
  function entwuerfe() { try { return JSON.parse(localStorage.getItem('mandarin-entwuerfe') || '[]'); } catch (e) { return []; } }
  function saveEntwuerfe(a) { try { localStorage.setItem('mandarin-entwuerfe', JSON.stringify(a)); } catch (e) { } }
  function repoName() {
    var hn = location.hostname, seg = location.pathname.split('/').filter(Boolean)[0];
    if (/\.github\.io$/.test(hn) && seg) return hn.split('.')[0] + '/' + seg;
    return 'markuslaub/mandarin-app';
  }
  function editInsel(id) {
    var all = entwuerfe(), d = all.filter(function (x) { return x.id === id; })[0];
    if (!d) { d = { id: 'e' + Date.now(), titel: '', thema: 'Freunde und Familie', saetze: [''], notiz: '' }; }
    VIEW.innerHTML = ''; window.scrollTo(0, 0);
    var back = h('<button class="link">‹ Inseln</button>'); back.onclick = function () { persist(); go('inseln'); }; VIEW.appendChild(back);
    VIEW.appendChild(h('<h2 style="margin-top:0">Neue Insel</h2>'));
    VIEW.appendChild(h('<p class="muted small">Schreib Sätze, die du im echten Leben sagen willst, so wie du sie sagen würdest. Diktieren: auf der iPhone-Tastatur das Mikrofon antippen. Das Erfassen geht auch ohne Internet.</p>'));
    var c = h('<div class="card"><label class="small muted">Name der Insel</label><input data-a="titel" placeholder="z. B. Im Hotel" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg);margin:4px 0 10px">' +
      '<div class="row"><span class="small muted">Thema</span><select data-a="thema"><option>Freunde und Familie</option><option>Reisen</option><option>Arbeit</option><option>Alltag</option></select></div>' +
      '<h3>Sätze auf Deutsch</h3><div data-r="list"></div><button class="btn small" data-a="add">＋ Satz</button>' +
      '<h3>Hinweis an Claude <span class="muted small">(freiwillig)</span></h3><textarea data-a="notiz" rows="2" placeholder="z. B. eher förmlich, für Gespräche mit Kunden" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg)"></textarea></div>');
    VIEW.appendChild(c);
    c.querySelector('[data-a=titel]').value = d.titel; c.querySelector('[data-a=thema]').value = d.thema; c.querySelector('[data-a=notiz]').value = d.notiz || '';
    var lst = c.querySelector('[data-r=list]');
    function renderList() {
      lst.innerHTML = '';
      d.saetze.forEach(function (t, i) {
        var r = h('<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><span class="muted small" style="width:22px">' + (i + 1) + '.</span><input style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg)"><button class="btn small" title="Löschen">✕</button></div>');
        var inp = r.querySelector('input'); inp.value = t;
        inp.oninput = function () { d.saetze[i] = inp.value; persist(); };
        inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); d.saetze.splice(i + 1, 0, ''); renderList(); lst.querySelectorAll('input')[i + 1].focus(); } };
        r.querySelector('button').onclick = function () { d.saetze.splice(i, 1); if (!d.saetze.length) d.saetze.push(''); renderList(); persist(); };
        lst.appendChild(r);
      });
    }
    renderList();
    c.querySelector('[data-a=add]').onclick = function () { d.saetze.push(''); renderList(); var ins = lst.querySelectorAll('input'); ins[ins.length - 1].focus(); };
    ['titel', 'thema', 'notiz'].forEach(function (k) { c.querySelector('[data-a=' + k + ']').oninput = c.querySelector('[data-a=' + k + ']').onchange = function () { d[k] = this.value; persist(); }; });
    function persist() {
      var a = entwuerfe().filter(function (x) { return x.id !== d.id; });
      if (d.titel || d.saetze.some(Boolean)) a.unshift(d);
      saveEntwuerfe(a);
    }
    function auftrag() {
      var s = d.saetze.map(function (x) { return x.trim(); }).filter(Boolean);
      return 'Neue Sprachinsel für meine Mandarin-App\nName: ' + (d.titel || 'Ohne Titel') + '\nThema: ' + d.thema + '\n' + (d.notiz ? 'Hinweis: ' + d.notiz + '\n' : '') + '\nSätze:\n' + s.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n') + '';
    }
    var send = h('<div class="card"><h3 style="margin-top:0">An Claude senden</h3><p class="muted small">GitHub öffnet sich mit dem fertigen Auftrag. Dort unten auf «Create» tippen. Claude übersetzt dann, erstellt Audio und Tonkurven, und nach etwa 10 Minuten erscheint die Insel unter «Inseln». Zum Senden ist Internet nötig.</p><div class="row"><button class="btn primary" data-a="share">An Claude senden</button><button class="btn" data-a="copy">Text kopieren</button><span class="spacer"></span><button class="btn small" data-a="del">Entwurf löschen</button></div><div data-r="msg"></div></div>');
    VIEW.appendChild(send);
    var msg = send.querySelector('[data-r=msg]');
    function markSent() { d.gesendet = today(); persist(); }
    send.querySelector('[data-a=share]').onclick = function () {
      if (!d.saetze.some(function (x) { return x.trim(); })) { msg.innerHTML = '<div class="msg">Erst mindestens einen Satz eingeben.</div>'; return; }
      var url = 'https://github.com/' + repoName() + '/issues/new?title=' + encodeURIComponent('Neue Insel: ' + (d.titel || 'Ohne Titel')) + '&body=' + encodeURIComponent(auftrag());
      window.open(url, '_blank');
      markSent();
      msg.innerHTML = '<div class="msg">Auf GitHub «Create» tippen. Die Insel erscheint nach etwa 10 Minuten unter «Inseln». Den Stand siehst du auf GitHub unter «Issues».</div>';
    };
    send.querySelector('[data-a=copy]').onclick = async function () {
      try { await navigator.clipboard.writeText(auftrag()); markSent(); msg.innerHTML = '<div class="msg">Kopiert. Jetzt in den Chat mit Claude einfügen.</div>'; }
      catch (e) { msg.innerHTML = '<pre style="white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:8px">' + esc(auftrag()) + '</pre>'; }
    };
    send.querySelector('[data-a=del]').onclick = function () { saveEntwuerfe(entwuerfe().filter(function (x) { return x.id !== d.id; })); go('inseln'); };
  }

  // Paket-Datei (alles in einer JSON-Datei, Audio als base64) in den Offline-Speicher übernehmen
  async function importBundle(b) {
    if (!b || b.format !== 'mandarin-paketdatei' || !b.meta || !b.dateien) throw new Error('Format');
    var c = await caches.open(CACHE), meta = b.meta;
    for (var f in b.dateien) {
      var v = b.dateien[f], body, type;
      if (f === 'paket.json') { body = JSON.stringify(v); type = 'application/json'; }
      else { var bin = atob(v), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); body = new Blob([arr], { type: 'audio/mpeg' }); type = 'audio/mpeg'; }
      await c.put(pkgUrl(meta.id, f), new Response(body, { headers: { 'Content-Type': type } }));
    }
    delete PKG[meta.id];
    var eigene = []; try { eigene = JSON.parse(localStorage.getItem('mandarin-eigene') || '[]'); } catch (e) { }
    eigene = eigene.filter(function (m) { return m.id !== meta.id; }); eigene.push(meta);
    try { localStorage.setItem('mandarin-eigene', JSON.stringify(eigene)); } catch (e) { }
    return meta;
  }
  async function pkgItem(meta, onOpen) {
    var loaded = await isLoaded(meta.id);
    var el = h('<div class="item pkg' + (meta.bald ? ' locked' : '') + '"><div class="main"><b>' + esc(meta.titel) + '</b><div class="meta">' + esc(meta.beschreibung) + '</div><div class="meta" data-r="st"></div><div class="progress hidden"><div></div></div></div><div data-r="act"></div></div>');
    var st = el.querySelector('[data-r=st]'), act = el.querySelector('[data-r=act]');
    if (meta.bald) { st.textContent = 'Noch nicht erstellt · ' + meta.saetze + ' Sätze geplant'; act.innerHTML = '<span class="badge n">🔒 gesperrt</span>'; }
    else if (loaded) {
      var pkg = await getPackage(meta.id), n = pkg.saetze.filter(function (s) { var x = sState(meta.id, s.nr); return x && x.stufe >= 2; }).length;
      st.textContent = '✓ Offline verfügbar · ' + meta.saetze + ' Sätze' + (meta.typ === 'insel' ? ' · ' + n + ' sitzen' : '');
      act.innerHTML = '<button class="btn small primary">Öffnen</button>';
      act.firstChild.onclick = function () { onOpen(meta); };
    } else {
      st.textContent = 'Nicht geladen · ' + Math.round(meta.groesse / 1024) + ' KB · zum Laden Internet nötig';
      act.innerHTML = '<button class="btn small">⬇︎ Laden</button>';
      act.firstChild.onclick = async function () {
        var pr = el.querySelector('.progress'); pr.classList.remove('hidden'); act.firstChild.disabled = true;
        try { await loadPackage(meta, function (p) { pr.firstChild.style.width = Math.round(p * 100) + '%'; }); el.replaceWith(await pkgItem(meta, onOpen)); }
        catch (e) { st.textContent = 'Laden nicht möglich. Zum Laden ist Internet nötig.'; act.firstChild.disabled = false; }
      };
    }
    return el;
  }
  async function openInsel(id) {
    var pkg = await getPackage(id); VIEW.innerHTML = '';
    var back = h('<button class="link">‹ Inseln</button>'); back.onclick = function () { go('inseln'); }; VIEW.appendChild(back);
    VIEW.appendChild(h('<h2 style="margin-top:0">' + esc(pkg.titel) + '</h2>'));
    var cur = h('<div class="row" style="margin-bottom:8px">' + (LS.insel === pkg.id ? '<span class="badge g">Aktuelle Insel in «Heute lernen»</span>' : '<button class="btn small primary">In «Heute lernen» mit dieser Insel weiter</button>') + '</div>');
    VIEW.appendChild(cur);
    if (LS.insel !== pkg.id) cur.querySelector('button').onclick = function () { LS.insel = pkg.id; saveLS(); go('heute'); };
    VIEW.appendChild(h('<p class="muted small">Alle Sätze. Antippen zum Üben (Hören, Shadowing, Aufnahme).</p>'));
    var list = h('<div class="list"></div>'); VIEW.appendChild(list);
    pkg.saetze.forEach(function (s) {
      var st = sState(pkg.id, s.nr), lt = lastTon(st), status = !st ? '<span class="badge n">neu</span>' : st.stufe >= 2 ? '<span class="badge g">sitzt</span>' : '<span class="badge m">am Lernen</span>';
      var zh = s.w.map(function (t) { return t[0]; }).join('');
      var it = h('<button class="item"><div class="main"><div class="zhs">' + esc(zh) + '</div><div class="meta">' + esc(s.de) + '</div></div><div style="text-align:right">' + status + (lt != null ? '<div class="small" style="margin-top:4px"><span class="badge ' + cls(lt) + '">Ton ' + lt + ' %</span></div>' : '') + '</div></button>');
      it.onclick = function () { openSatz(pkg, s); };
      list.appendChild(it);
    });
  }
  function openSatz(pkg, s) {
    VIEW.innerHTML = ''; window.scrollTo(0, 0);
    var back = h('<button class="link">‹ ' + esc(pkg.titel) + '</button>'); back.onclick = function () { stopAudio(); openInsel(pkg.id); }; VIEW.appendChild(back);
    VIEW.appendChild(satzKarte(pkg, s, { shadow: true }));
    var idx = pkg.saetze.indexOf(s);
    var nav = h('<div class="row"><button class="btn" id="pv"' + (idx ? '' : ' disabled') + '>‹ Vorheriger</button><span class="spacer"></span><button class="btn" id="nv"' + (idx < pkg.saetze.length - 1 ? '' : ' disabled') + '>Nächster ›</button></div>');
    VIEW.appendChild(nav);
    $('#pv').onclick = function () { stopAudio(); openSatz(pkg, pkg.saetze[idx - 1]); };
    $('#nv').onclick = function () { stopAudio(); openSatz(pkg, pkg.saetze[idx + 1]); };
  }

  // ---------- Hören (Playlist) ----------
  var PL = null;
  async function viewHoeren() {
    var kat = await getKatalog(), inseln = [];
    for (var i = 0; i < kat.pakete.length; i++) { var m = kat.pakete[i]; if (m.typ === 'insel' && !m.bald && await isLoaded(m.id)) inseln.push(m); }
    VIEW.appendChild(h('<h2 style="margin-top:0">Ohren fluten</h2>'));
    if (!inseln.length) { VIEW.appendChild(h('<div class="msg">Noch keine Insel geladen. Im Tab «Inseln» laden.</div>')); return; }
    var E = LS.einst;
    var c = h('<div class="card">' +
      '<div class="row"><div class="seg"><button data-m="zh">Nur Chinesisch</button><button data-m="abruf">Abruf-Modus</button></div></div>' +
      '<p class="muted small" data-r="mdesc"></p>' +
      '<div data-r="ins">' + inseln.map(function (m) { return '<label class="chk"><input type="checkbox" value="' + esc(m.id) + '" checked> ' + esc(m.titel) + ' (' + m.saetze + ' Sätze)</label>'; }).join('') + '</div>' +
      '<div class="row"><label class="chk"><input type="checkbox" data-a="mix"' + (E.mischen ? ' checked' : '') + '> Reihenfolge mischen</label><span class="spacer"></span><span class="small muted" data-r="pl">Pause zum Sprechen</span><select data-a="pause"><option value="3">3 s</option><option value="5">5 s</option><option value="8">8 s</option></select></div>' +
      '<button class="btn primary big" data-a="build" style="margin-top:8px">▶︎ Playlist starten</button>' +
      '<div class="progress hidden"><div></div></div>' +
      '</div>');
    VIEW.appendChild(c);
    var nowBox = h('<div class="card hidden"><div class="muted small" data-r="pos"></div><div class="now" data-r="now"></div><div class="de" data-r="de"></div><div class="row"><button class="btn" data-a="prev">⏮</button><button class="btn primary" data-a="pp">⏸ Pause</button><button class="btn" data-a="nextb">⏭</button></div><p class="muted small">Läuft weiter bei gesperrtem Bildschirm. Steuerung auch auf dem Sperrbildschirm.</p></div>');
    VIEW.appendChild(nowBox);
    c.querySelector('[data-a=pause]').value = String(E.abrufPause);
    function setMode(m) {
      E.modus = m; saveLS();
      c.querySelectorAll('[data-m]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.m === m); });
      c.querySelector('[data-r=mdesc]').textContent = m === 'zh' ? 'Jeder Satz 2× langsam, 1× normal. Zum Mitsprechen oder einfach Hören.' : 'Erst Deutsch, dann Pause zum selbst Sagen, dann Chinesisch. Aktive Erinnerung ohne Bildschirm.';
      c.querySelector('[data-a=pause]').disabled = m === 'zh'; c.querySelector('[data-r=pl]').style.opacity = m === 'zh' ? .4 : 1;
    }
    c.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { setMode(b.dataset.m); }; });
    setMode(E.modus || 'zh');
    c.querySelector('[data-a=build]').onclick = async function () {
      E.mischen = c.querySelector('[data-a=mix]').checked; E.abrufPause = +c.querySelector('[data-a=pause]').value; saveLS();
      var ids = Array.from(c.querySelectorAll('[data-r=ins] input:checked')).map(function (x) { return x.value; });
      if (!ids.length) return;
      var pr = c.querySelector('.progress'); pr.classList.remove('hidden');
      var btn = this; btn.disabled = true; btn.textContent = 'Playlist wird vorbereitet …';
      try { PL = await buildPlaylist(ids, E, function (p) { pr.firstChild.style.width = Math.round(p * 100) + '%'; }); }
      catch (e) { btn.disabled = false; btn.textContent = '▶︎ Playlist starten'; VIEW.appendChild(h('<div class="msg">Fehler: ' + esc(e.message || e) + '</div>')); return; }
      pr.classList.add('hidden'); btn.disabled = false; btn.textContent = '↻ Neu zusammenstellen';
      startPlaylist(nowBox);
    };
    if (PL && PL.url) startPlaylist(nowBox, true);
  }
  async function buildPlaylist(ids, E, onp) {
    var items = [];
    for (var i = 0; i < ids.length; i++) { var p = await getPackage(ids[i]); p.saetze.forEach(function (s) { items.push({ pkg: p, s: s }); }); }
    if (E.mischen) for (i = items.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = items[i]; items[i] = items[j]; items[j] = t; }
    var SR = 22050, parts = [], marks = [], pos = 0;
    function sil(sec) { var n = Math.round(sec * SR); parts.push(new Float32Array(n)); pos += n; }
    async function add(pid, f) {
      var b = await decoded(pid, f), d = b.getChannelData(0), r = b.sampleRate;
      var y = r === SR ? d : (function () { var n = Math.floor(d.length * SR / r), o = new Float32Array(n); for (var k = 0; k < n; k++) o[k] = d[Math.min(d.length - 1, Math.floor(k * r / SR))]; return o; })();
      parts.push(y); pos += y.length;
    }
    sil(0.5);
    for (i = 0; i < items.length; i++) {
      var it = items[i]; marks.push({ t: pos / SR, i: i });
      if (E.modus === 'abruf') { await add(it.pkg.id, it.s.audioDe); sil(E.abrufPause); await add(it.pkg.id, it.s.audio); sil(1.2); await add(it.pkg.id, it.s.audio); sil(2.0); }
      else { await add(it.pkg.id, it.s.langsam); sil(1.0); await add(it.pkg.id, it.s.langsam); sil(1.0); await add(it.pkg.id, it.s.audio); sil(2.2); }
      onp && onp((i + 1) / items.length);
    }
    var all = new Float32Array(pos), o = 0; parts.forEach(function (p) { all.set(p, o); o += p.length; });
    var blob = wavBlob(all, SR);
    if (PL && PL.url) URL.revokeObjectURL(PL.url);
    return { url: URL.createObjectURL(blob), marks: marks, items: items, modus: E.modus };
  }
  function wavBlob(x, sr) {
    var buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, x.length * 2, true);
    for (var i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  function startPlaylist(box, resume) {
    stopAudio();
    box.classList.remove('hidden');
    var A = LISTPLAYER;
    if (!resume || A.src !== PL.url) { A.src = PL.url; A.currentTime = 0; }
    A.play().catch(function () { });
    var cur = -1;
    function idxAt(t) { var k = 0; for (var i = 0; i < PL.marks.length; i++) if (PL.marks[i].t <= t + 0.05) k = i; return k; }
    function update() {
      var k = idxAt(A.currentTime); if (k === cur) return; cur = k;
      var it = PL.items[k];
      box.querySelector('[data-r=pos]').textContent = 'Satz ' + (k + 1) + ' von ' + PL.items.length + ' · ' + (PL.modus === 'abruf' ? 'Abruf-Modus' : 'Nur Chinesisch');
      box.querySelector('[data-r=now]').innerHTML = sentenceHTML(it.pkg, it.s); bindWords(box.querySelector('[data-r=now]'), it.pkg);
      box.querySelector('[data-r=de]').textContent = it.s.de;
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.metadata = new MediaMetadata({ title: it.s.w.map(function (t) { return t[0]; }).join(''), artist: it.s.de, album: 'Ohren fluten · ' + it.pkg.titel, artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }); } catch (e) { }
      }
    }
    A.ontimeupdate = update; update();
    var pp = box.querySelector('[data-a=pp]');
    A.onplay = function () { pp.textContent = '⏸ Pause'; }; A.onpause = function () { pp.textContent = '▶︎ Weiter'; };
    pp.onclick = function () { A.paused ? A.play() : A.pause(); };
    function seekTo(k) { k = Math.max(0, Math.min(PL.marks.length - 1, k)); A.currentTime = PL.marks[k].t; if (A.paused) A.play(); }
    box.querySelector('[data-a=prev]').onclick = function () { seekTo(idxAt(A.currentTime) - 1); };
    box.querySelector('[data-a=nextb]').onclick = function () { seekTo(idxAt(A.currentTime) + 1); };
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('previoustrack', function () { seekTo(idxAt(A.currentTime) - 1); });
        navigator.mediaSession.setActionHandler('nexttrack', function () { seekTo(idxAt(A.currentTime) + 1); });
        navigator.mediaSession.setActionHandler('play', function () { A.play(); });
        navigator.mediaSession.setActionHandler('pause', function () { A.pause(); });
      } catch (e) { }
    }
  }

  // ---------- Texte ----------
  async function viewTexte() {
    var kat = await getKatalog();
    VIEW.appendChild(h('<h2 style="margin-top:0">Pre-Input-Texte</h2>'));
    VIEW.appendChild(h('<p class="muted small">Methode: erst das Transkript studieren, dann hören. So verstehst du beim Hören 70–90 % statt 10 %.</p>'));
    var list = h('<div class="list"></div>'); VIEW.appendChild(list);
    var texte = kat.pakete.filter(function (p) { return p.typ === 'text'; }), lastT = null;
    var openText = async function (meta) {
      var pkg = await getPackage(meta.id); VIEW.innerHTML = '';
      var back = h('<button class="link">‹ Texte</button>'); back.onclick = function () { go('texte'); }; VIEW.appendChild(back);
      var tb = h('<div class="row" style="margin-bottom:8px">' + (LS.text === pkg.id ? '<span class="badge g">Tagestext in «Heute lernen»</span>' : '<button class="btn small">Als Tagestext in «Heute lernen»</button>') + '</div>');
      VIEW.appendChild(tb);
      if (LS.text !== pkg.id) tb.querySelector('button').onclick = function () { LS.text = pkg.id; saveLS(); tb.innerHTML = '<span class="badge g">Tagestext in «Heute lernen»</span>'; };
      textReader(pkg, VIEW, null);
    };
    for (var i = 0; i < texte.length; i++) {
      if (texte[i].thema !== lastT) { lastT = texte[i].thema; list.appendChild(h('<div class="muted small" style="margin-top:8px;font-weight:600">' + esc(lastT) + '</div>')); }
      list.appendChild(await pkgItem(texte[i], openText));
    }
    VIEW.appendChild(h('<p class="muted small">Eigene Transkripte (Video, Podcast) an Claude geben, sie kommen als weiteres Paket dazu.</p>'));
  }

  // ---------- Fortschritt ----------
  async function viewStand() {
    VIEW.appendChild(h('<h2 style="margin-top:0">Fortschritt</h2>'));
    var d = new Date(), y = d.getFullYear(), m = d.getMonth(), first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    var monat = first.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
    var cal = '<div class="cal">' + ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(function (x) { return '<div class="h">' + x + '</div>'; }).join('');
    for (var i = 0; i < (first.getDay() + 6) % 7; i++) cal += '<div></div>';
    for (i = 1; i <= days; i++) {
      var iso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0');
      cal += '<div class="d' + (LS.tage[iso] ? ' on' : '') + (iso === today() ? ' today' : '') + '">' + i + '</div>';
    }
    cal += '</div>';
    var lerntage = Object.keys(LS.tage).length, streak = 0, t = today();
    if (!LS.tage[t]) t = addDays(t, -1);
    while (LS.tage[t]) { streak++; t = addDays(t, -1); }
    var keys = Object.keys(LS.saetze), sitzen = keys.filter(function (k) { return LS.saetze[k].stufe >= 2; }).length;
    var tonAll = []; keys.forEach(function (k) { var b = lastTon(LS.saetze[k]); if (b != null) tonAll.push(b); });
    var tonAvg = tonAll.length ? Math.round(tonAll.reduce(function (a, b) { return a + b; }, 0) / tonAll.length) : null;
    VIEW.appendChild(h('<div class="card"><h3 style="margin-top:0">' + esc(monat) + '</h3>' + cal + '</div>'));
    VIEW.appendChild(h('<div class="card"><div class="stats"><div class="stat"><b>' + lerntage + '</b>Lerntage</div><div class="stat"><b>' + streak + '</b>Tage in Folge</div><div class="stat"><b>' + keys.length + '</b>Sätze gelernt</div><div class="stat"><b>' + sitzen + '</b>Sätze sitzen</div><div class="stat"><b>' + (tonAvg == null ? '–' : tonAvg + ' %') + '</b>Töne (letzte Aufnahmen)</div></div></div>'));
    var e = h('<div class="card"><h3 style="margin-top:0">Einstellungen</h3><div class="row"><span>Neue Sätze pro Tag</span><span class="spacer"></span><select data-a="neu"><option>3</option><option>5</option><option>8</option><option>15</option></select></div></div>');
    VIEW.appendChild(e);
    e.querySelector('[data-a=neu]').value = String(LS.einst.neuProTag);
    e.querySelector('[data-a=neu]').onchange = function () { LS.einst.neuProTag = +this.value; saveLS(); };
    var b = h('<div class="card"><h3 style="margin-top:0">Lernstand sichern</h3><p class="muted small">Der Lernstand liegt nur auf diesem Gerät. Als Datei sichern oder auf ein anderes Gerät übertragen.</p><div class="row"><button class="btn" data-a="save">Als Datei sichern</button><label class="btn">Datei laden<input type="file" accept=".json,application/json" hidden></label></div><div data-r="msg"></div></div>');
    VIEW.appendChild(b);
    b.querySelector('[data-a=save]').onclick = function () {
      var blob = new Blob([JSON.stringify(LS, null, 1)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'mandarin-lernstand-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    };
    b.querySelector('input[type=file]').onchange = async function () {
      try { var j = JSON.parse(await this.files[0].text()); if (j.format !== 'mandarin-lernstand') throw 0; LS = j; saveLS(); b.querySelector('[data-r=msg]').innerHTML = '<div class="msg">Lernstand geladen.</div>'; }
      catch (err) { b.querySelector('[data-r=msg]').innerHTML = '<div class="msg">Das ist keine Lernstand-Datei.</div>'; }
    };
    var kat = await getKatalog(), pk = h('<div class="card"><h3 style="margin-top:0">Geladene Pakete</h3><div class="list" data-r="l"></div></div>');
    VIEW.appendChild(pk);
    for (i = 0; i < kat.pakete.length; i++) {
      var meta = kat.pakete[i];
      if (!(await isLoaded(meta.id))) continue;
      (function (meta) {
        var row = h('<div class="row"><span>' + esc(meta.titel) + ' <span class="muted small">' + Math.round(meta.groesse / 1024) + ' KB</span></span><span class="spacer"></span><button class="btn small">Entfernen</button></div>');
        row.querySelector('button').onclick = async function () { await removePackage(meta); row.remove(); };
        pk.querySelector('[data-r=l]').appendChild(row);
      })(meta);
    }
    VIEW.appendChild(h('<p class="muted small">Tonbewertung: Die App legt deine Tonhöhenkurve über die Vorlage und bewertet jede Silbe (grün getroffen, gelb knapp, rot falsch). Sie prüft Töne und Rhythmus, nicht einzelne Laute. Alles läuft auf dem Gerät, ohne Internet.</p>'));
  }

  // Pinyin ein/aus, gilt überall
  function setPinyin(on) {
    LS.einst.pinyin = !!on; saveLS();
    document.querySelectorAll('.zh').forEach(function (z) { z.classList.toggle('nopy', !on); });
    document.querySelectorAll('[data-a=py],#pytoggle').forEach(function (b) { b.setAttribute('aria-pressed', !!on); });
  }
  // Geladene Pakete aktualisieren, wenn der Katalog einen neueren Stand hat
  var SYNCING = false;
  async function syncLoaded(kat) {
    if (SYNCING || !hasCache || !navigator.onLine) return; SYNCING = true;
    try {
      var c = await caches.open(CACHE);
      for (var i = 0; i < kat.pakete.length; i++) {
        var m = kat.pakete[i];
        if (!m.stand || m.bald || !(await isLoaded(m.id))) continue;
        var pk = await getPackage(m.id);
        if (pk && pk.stand === m.stand) continue;
        await c.delete(pkgUrl(m.id, 'paket.json'));
        try { await loadPackage(m); } catch (e) { continue; }
        var keep = {}; m.dateien.forEach(function (f) { keep[new URL(pkgUrl(m.id, f), location.href).href] = 1; });
        var keys = await c.keys(), pre = new URL(pkgUrl(m.id, ''), location.href).href;
        for (var k = 0; k < keys.length; k++) if (keys[k].url.indexOf(pre) === 0 && !keep[keys[k].url.split('?')[0]]) await c.delete(keys[k]);
        delete PKG[m.id];
        Object.keys(URLS).forEach(function (x) { if (x.indexOf(m.id + '/') === 0) delete URLS[x]; });
        Object.keys(DECODED).forEach(function (x) { if (x.indexOf(m.id + '/') === 0) delete DECODED[x]; });
      }
    } finally { SYNCING = false; }
  }

  // ---------- Start ----------
  loadLS();
  var PYB = document.getElementById('pytoggle');
  if (PYB) { PYB.setAttribute('aria-pressed', !!LS.einst.pinyin); PYB.onclick = function () { setPinyin(!LS.einst.pinyin); }; }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
  if (location.protocol === 'file:') {
    VIEW.innerHTML = '<div class="card"><h2 style="margin-top:0">Bitte über eine Adresse öffnen</h2><p>Als Datei geöffnet (file://) sperrt der Browser das Laden der Pakete und das Mikrofon.</p><p><b>Auf dem Mac zum Testen:</b> Terminal öffnen und eingeben:</p><pre style="white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:8px">cd ' + esc(decodeURIComponent(location.pathname).replace(/\/index\.html$/, '')) + '\npython3 -m http.server 8000</pre><p>Dann im Browser <b>http://localhost:8000</b> öffnen.</p><p class="muted small">Für iPhone und iPad braucht es eine Internet-Adresse (GitHub Pages).</p></div>';
    return;
  }
  if (!hasCache) VIEW.appendChild(h('<div class="msg">Dieser Browser erlaubt hier keinen Offline-Speicher. Bitte die App über ihre Internet-Adresse öffnen.</div>'));
  go('heute');
})();
