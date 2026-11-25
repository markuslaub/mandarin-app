/* Tonkurven-Analyse: Tonhöhe (YIN), MFCC, DTW-Ausrichtung, Silbenbewertung.
   Läuft im Browser und in Node (für Vorberechnung und Tests). */
(function (root) {
  'use strict';
  var SR = 16000, HOP = 160; // 10 ms

  function resample(x, sr) {
    if (sr === SR) return Float32Array.from(x);
    var ratio = sr / SR, n = Math.floor(x.length / ratio), y = new Float32Array(n);
    var w = Math.max(1, Math.round(ratio));
    for (var i = 0; i < n; i++) {
      var c = i * ratio, a = Math.max(0, Math.floor(c - w / 2)), b = Math.min(x.length, a + w), s = 0;
      for (var j = a; j < b; j++) s += x[j];
      y[i] = s / (b - a);
    }
    return y;
  }

  // Energie je Frame (dB)
  function energy(x) {
    var n = Math.floor((x.length - 400) / HOP) + 1, e = new Float32Array(Math.max(n, 0));
    for (var i = 0; i < n; i++) {
      var s = 0, o = i * HOP;
      for (var j = 0; j < 400; j++) s += x[o + j] * x[o + j];
      e[i] = 10 * Math.log10(s / 400 + 1e-10);
    }
    return e;
  }

  // Stille am Anfang und Ende finden (Frame-Indizes)
  function speechRange(e) {
    var mx = -200;
    for (var i = 0; i < e.length; i++) if (e[i] > mx) mx = e[i];
    var th = mx - 35, a = 0, b = e.length - 1;
    while (a < e.length && e[a] < th) a++;
    while (b > a && e[b] < th) b--;
    return [Math.max(0, a - 3), Math.min(e.length, b + 4), mx];
  }

  // YIN-Tonhöhe, 10-ms-Raster. Liefert Hz oder 0 (stimmlos)
  function pitch(x) {
    var W = 480, tmin = Math.floor(SR / 450), tmax = Math.ceil(SR / 65);
    var n = Math.floor((x.length - W - tmax) / HOP) + 1;
    if (n < 1) return new Float32Array(0);
    var f = new Float32Array(n), d = new Float32Array(tmax + 1), e = energy(x), mx = -200;
    for (var q = 0; q < e.length; q++) if (e[q] > mx) mx = e[q];
    for (var i = 0; i < n; i++) {
      var o = i * HOP;
      if ((e[i + 1] || -200) < mx - 35) { f[i] = 0; continue; }
      for (var t = 1; t <= tmax; t++) {
        var s = 0;
        for (var j = 0; j < W; j++) { var v = x[o + j] - x[o + j + t]; s += v * v; }
        d[t] = s;
      }
      var run = 0, best = -1, gmin = 1e9, gt = -1;
      d[0] = 1;
      for (t = 1; t <= tmax; t++) { run += d[t]; d[t] = run > 0 ? d[t] * t / run : 1; }
      for (t = tmin; t < tmax; t++) {
        if (d[t] < 0.25) { while (t + 1 < tmax && d[t + 1] < d[t]) t++; best = t; break; }
        if (d[t] < gmin) { gmin = d[t]; gt = t; }
      }
      if (best < 0 && gmin < 0.45) best = gt;
      if (best < 0) { f[i] = 0; continue; }
      var a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
      var tt = best + (den !== 0 ? 0.5 * (a - c) / den : 0);
      f[i] = SR / tt;
    }
    return cleanPitch(f);
  }

  // Ausreisser und Oktavsprünge glätten
  function cleanPitch(f) {
    var n = f.length, g = Float32Array.from(f), v = [];
    for (var i = 0; i < n; i++) if (f[i] > 0) v.push(f[i]);
    if (!v.length) return g;
    v.sort(function (a, b) { return a - b; });
    var med = v[Math.floor(v.length / 2)];
    for (i = 0; i < n; i++) {
      if (!g[i]) continue;
      var r = g[i] / med;
      if (r > 1.8) g[i] /= 2; else if (r < 0.55) g[i] *= 2;
      if (g[i] / med > 2.2 || g[i] / med < 0.45) g[i] = 0;
    }
    // Oktavsprünge zwischen Nachbarframes korrigieren
    var last = 0, lastI = -99;
    for (i = 0; i < n; i++) {
      if (!g[i]) continue;
      if (last && i - lastI <= 8) {
        var jump = 12 * Math.log2(g[i] / last);
        if (jump > 9) g[i] /= 2; else if (jump < -9) g[i] *= 2;
      }
      last = g[i]; lastI = i;
    }
    // kurze stimmhafte Inseln (< 3 Frames) entfernen
    for (i = 0; i < n;) {
      if (!g[i]) { i++; continue; }
      var j = i; while (j < n && g[j]) j++;
      if (j - i < 3) for (var k = i; k < j; k++) g[k] = 0;
      i = j;
    }
    // Median über 5
    var h = Float32Array.from(g);
    for (i = 2; i < n - 2; i++) {
      if (!g[i]) continue;
      var w = [g[i - 2], g[i - 1], g[i], g[i + 1], g[i + 2]].filter(function (z) { return z > 0; }).sort(function (a, b) { return a - b; });
      h[i] = w[Math.floor(w.length / 2)];
    }
    return h;
  }

  // Halbtöne relativ zum Median des Sprechers
  function semitones(f) {
    var v = [];
    for (var i = 0; i < f.length; i++) if (f[i] > 0) v.push(f[i]);
    v.sort(function (a, b) { return a - b; });
    var med = v.length ? v[Math.floor(v.length / 2)] : 150, s = new Float32Array(f.length);
    for (i = 0; i < f.length; i++) s[i] = f[i] > 0 ? 12 * Math.log2(f[i] / med) : NaN;
    return { st: s, median: med };
  }

  // MFCC
  var FFTN = 512, NMEL = 26, NCEP = 13, melBank = null, dctM = null, hann = null;
  function initMel() {
    var mel = function (h) { return 2595 * Math.log10(1 + h / 700); };
    var imel = function (m) { return 700 * (Math.pow(10, m / 2595) - 1); };
    var lo = mel(80), hi = mel(7600), pts = [];
    for (var i = 0; i < NMEL + 2; i++) pts.push(Math.floor((FFTN + 1) * imel(lo + (hi - lo) * i / (NMEL + 1)) / SR));
    melBank = [];
    for (var m = 1; m <= NMEL; m++) {
      var row = new Float32Array(FFTN / 2 + 1);
      for (var k = pts[m - 1]; k < pts[m]; k++) row[k] = (k - pts[m - 1]) / Math.max(1, pts[m] - pts[m - 1]);
      for (k = pts[m]; k < pts[m + 1]; k++) row[k] = (pts[m + 1] - k) / Math.max(1, pts[m + 1] - pts[m]);
      melBank.push(row);
    }
    dctM = [];
    for (var c = 0; c < NCEP; c++) {
      var r = new Float32Array(NMEL);
      for (m = 0; m < NMEL; m++) r[m] = Math.cos(Math.PI * c * (m + 0.5) / NMEL);
      dctM.push(r);
    }
    hann = new Float32Array(400);
    for (i = 0; i < 400; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 399);
  }
  function fft(re, im) {
    var n = re.length, i, j = 0, k, t;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var a = i + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  function mfcc(x, raw) {
    if (!melBank) initMel();
    var n = Math.floor((x.length - 400) / HOP) + 1, out = [];
    var re = new Float32Array(FFTN), im = new Float32Array(FFTN);
    for (var i = 0; i < n; i++) {
      re.fill(0); im.fill(0);
      var o = i * HOP;
      for (var j = 0; j < 400; j++) re[j] = (x[o + j] - 0.97 * (o + j > 0 ? x[o + j - 1] : 0)) * hann[j];
      fft(re, im);
      var pw = new Float32Array(FFTN / 2 + 1);
      for (j = 0; j <= FFTN / 2; j++) pw[j] = re[j] * re[j] + im[j] * im[j];
      var lm = new Float32Array(NMEL);
      for (var m = 0; m < NMEL; m++) {
        var s = 0, row = melBank[m];
        for (j = 0; j <= FFTN / 2; j++) if (row[j]) s += row[j] * pw[j];
        lm[m] = Math.log(s + 1e-8);
      }
      var c = new Float32Array(NCEP);
      for (var q = 0; q < NCEP; q++) { var z = 0; for (m = 0; m < NMEL; m++) z += dctM[q][m] * lm[m]; c[q] = z; }
      out.push(c);
    }
    if (raw) return out.map(function (c) { return c.slice(1); });
    // Mittelwert- und Varianz-Normierung, c0 weglassen, Deltas anhängen
    var mu = new Float32Array(NCEP), sd = new Float32Array(NCEP);
    out.forEach(function (c) { for (var q = 0; q < NCEP; q++) mu[q] += c[q] / out.length; });
    out.forEach(function (c) { for (var q = 0; q < NCEP; q++) sd[q] += (c[q] - mu[q]) * (c[q] - mu[q]) / out.length; });
    for (var q = 0; q < NCEP; q++) sd[q] = Math.sqrt(sd[q]) + 1e-6;
    var norm = out.map(function (c) { var r = new Float32Array(NCEP - 1); for (var q = 1; q < NCEP; q++) r[q - 1] = (c[q] - mu[q]) / sd[q]; return r; });
    return norm.map(function (c, t) {
      var a = norm[Math.max(0, t - 2)], b = norm[Math.min(norm.length - 1, t + 2)], r = new Float32Array(2 * (NCEP - 1));
      for (var q = 0; q < NCEP - 1; q++) { r[q] = c[q]; r[NCEP - 1 + q] = 0.5 * (b[q] - a[q]); }
      return r;
    });
  }
  function dist(a, b) { var s = 0; for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

  // DTW. openEnd: B darf am Ende länger sein (Teilfolge ab Anfang)
  function dtw(A, B, openEnd) {
    var n = A.length, m = B.length, INF = 1e18, D = new Float64Array((n + 1) * (m + 1)).fill(INF);
    var W = m + 1; D[0] = 0;
    var band = openEnd ? m : Math.max(Math.abs(n - m) + 10, Math.round(0.35 * Math.max(n, m)));
    for (var i = 1; i <= n; i++) {
      var c0 = openEnd ? 1 : Math.max(1, Math.round(i * m / n) - band), c1 = openEnd ? m : Math.min(m, Math.round(i * m / n) + band);
      for (var j = c0; j <= c1; j++) {
        var c = dist(A[i - 1], B[j - 1]);
        var best = Math.min(D[(i - 1) * W + j - 1] + 2 * c, D[(i - 1) * W + j] + c, D[i * W + j - 1] + c);
        D[i * W + j] = best;
      }
    }
    var endJ = m;
    if (openEnd) {
      var bv = INF;
      for (j = Math.floor(m * 0.2); j <= m; j++) { var v = D[n * W + j] / (n + j); if (v < bv) { bv = v; endJ = j; } }
    }
    // Pfad zurückverfolgen
    var path = [], i2 = n, j2 = endJ;
    while (i2 > 0 && j2 > 0) {
      path.push([i2 - 1, j2 - 1]);
      var dg = D[(i2 - 1) * W + j2 - 1], up = D[(i2 - 1) * W + j2], lf = D[i2 * W + j2 - 1];
      if (dg <= up && dg <= lf) { i2--; j2--; } else if (up < lf) i2--; else j2--;
    }
    path.reverse();
    return { path: path, end: endJ, cost: D[n * W + endJ] / (n + endJ) };
  }

  // Analyse einer Aufnahme: Stille abschneiden, Tonhöhe, MFCC
  function analyse(samples, sr, raw) {
    var x = resample(samples, sr), e = energy(x), r = speechRange(e);
    var a = r[0] * HOP, b = Math.min(x.length, r[1] * HOP + 400);
    var y = x.subarray(a, b);
    var mf = mfcc(y), f0 = pitch(y), f = new Float32Array(mf.length);
    f.set(f0.subarray(0, Math.min(f0.length, mf.length)));
    var st = semitones(f);
    return { off: r[0], n: mf.length, f0: f, st: st.st, median: st.median, mfcc: mf, e: Array.from(e.subarray(r[0], r[0] + mf.length)), raw: raw ? mfcc(y, true) : null, peak: r[2] };
  }

  // Silbengrenzen der Vorlage aus Präfix-Aufnahmen (Vorberechnung)
  function boundariesFromPrefixes(full, prefixes) {
    var bounds = [0];
    prefixes.forEach(function (p) { bounds.push(dtw(p.raw, full.raw, true).end); });
    bounds.push(full.n);
    for (var i = 1; i < bounds.length; i++) if (bounds[i] <= bounds[i - 1]) bounds[i] = bounds[i - 1] + 1;
    return bounds;
  }

  function contour(st, a, b, pts, full) {
    var len = b - a, lo = full ? a : a + Math.floor(len * 0.15), hi = full ? b : b - Math.floor(len * 0.1), xs = [], ys = [];
    for (var i = lo; i < hi; i++) if (st[i] === st[i]) { xs.push(i); ys.push(st[i]); }
    if (ys.length < 4) return null;
    var out = [];
    for (var k = 0; k < pts; k++) {
      var t = xs[0] + (xs[xs.length - 1] - xs[0]) * k / (pts - 1), j = 0;
      while (j < xs.length - 1 && xs[j + 1] < t) j++;
      var x0 = xs[j], x1 = xs[Math.min(j + 1, xs.length - 1)], y0 = ys[j], y1 = ys[Math.min(j + 1, ys.length - 1)];
      out.push(x1 === x0 ? y0 : y0 + (y1 - y0) * (t - x0) / (x1 - x0));
    }
    return { c: out, voiced: ys.length / Math.max(1, hi - lo) };
  }
  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function slope(c) { return mean(c.slice(-3)) - mean(c.slice(0, 3)); }

  function lin(a, b) { var r = []; for (var i = 0; i < 10; i++) r.push(a + (b - a) * i / 9); return r; }
  // Lehrbuch-Tonkurven in Halbtönen relativ zur mittleren Stimmlage
  var TEMPL = {
    1: [lin(3, 3), lin(1, 1)],
    2: [lin(-2, 4), [-1, -1.5, -1.5, -1, 0, 0.8, 1.6, 2.4, 3.2, 4]],
    3: [lin(-2, -6), [-2, -4, -5.5, -6, -6, -5.5, -4.5, -3, -1.5, 0]],
    4: [lin(5, -4), lin(3, -5)]
  };
  function curv(c) { return mean(c.slice(3, 7)) - (mean(c.slice(0, 2)) + mean(c.slice(-2))) / 2; }
  // Vergleich zweier Silbenkurven: Richtung (Steigung), Lage, Krümmung (Tal beim 3. Ton)
  function compare(u, r, tol) {
    var ds = Math.abs(slope(u) - slope(r)), dm = Math.abs(mean(u) - mean(r)), dc = Math.abs(curv(u) - curv(r));
    var p = 8 * Math.max(0, ds - 1.5 - tol) + 6 * Math.max(0, dm - 2.5 - tol) + 4 * Math.max(0, dc - 2.5 - tol);
    return Math.max(0, Math.min(100, Math.round(100 - p)));
  }
  // Klare Tonfehler deckeln die Punktzahl, sofern die Vorlage den Ton selbst deutlich zeigt
  function rules(t, u, r) {
    var su = slope(u), sr = slope(r), mu = mean(u), mr = mean(r);
    if (t === 4) {
      if (su > 1 && sr < 0) return [35, '4. Ton steigt, klingt wie 2. Ton. Kräftig von oben fallen'];
      if (su > -2 && sr <= -2) return [60, '4. Ton fällt zu wenig. Höher beginnen, kräftig fallen'];
    }
    if (t === 2) {
      if (su < -1.5 && sr > 0) return [35, '2. Ton fällt, klingt wie 4. Ton. Von unten nach oben'];
      if (su < 1.5 && sr >= 1.5) return [60, '2. Ton steigt zu wenig. Deutlicher hochziehen'];
    }
    if (t === 1) {
      if (Math.abs(su) > 4 && Math.abs(sr) < 2.5) return [45, su < 0 ? '1. Ton fällt. Hoch und gerade halten' : '1. Ton steigt. Hoch und gerade halten'];
      if (mu < mr - 5) return [55, '1. Ton zu tief. Höher ansetzen'];
    }
    if (t === 3) {
      if (su > 4 && sr < 1 && mu > mr + 3) return [40, '3. Ton steigt, klingt wie 2. Ton. Tief bleiben'];
      if (mu > -1 && mr < -2.5) return [60, '3. Ton nicht tief genug. Ganz unten sprechen'];
    }
    return null;
  }
  var TONNAME = { 1: '1. Ton', 2: '2. Ton', 3: '3. Ton', 4: '4. Ton' };
  function diagnose(t, u, r) {
    var su = slope(u), sr = slope(r), mu = mean(u), mr = mean(r), lowU = Math.min.apply(null, u), lowR = Math.min.apply(null, r);
    var n = TONNAME[t];
    if (t === 1) {
      if (su < -2.5) return n + ' fällt. Hoch und gerade halten';
      if (su > 2.5) return n + ' steigt. Hoch und gerade halten';
      if (mu < mr - 2.5) return n + ' zu tief. Höher ansetzen';
      return n + ': höher und gerader';
    }
    if (t === 2) {
      if (su < -1.5) return n + ' fällt, klingt wie 4. Ton. Von unten nach oben';
      if (su < sr - 2) return n + ' steigt zu wenig. Deutlicher hochziehen';
      return n + ': gleichmässiger steigen';
    }
    if (t === 3) {
      if (lowU > lowR + 2.5 || mu > mr + 2.5) return n + ' nicht tief genug. Ganz unten sprechen';
      if (su > sr + 3) return n + ' steigt zu stark, klingt wie 2. Ton';
      return n + ': tiefer und ruhiger';
    }
    if (t === 4) {
      if (su > 1.5) return n + ' steigt, klingt wie 2. Ton. Kräftig von oben fallen';
      if (su > sr + 2.5) return n + ' fällt zu wenig. Höher beginnen, kräftig fallen';
      return n + ': steiler fallen';
    }
    return 'Tonkurve weicht ab';
  }

  // Bewertung einer Aufnahme gegen die Vorlage
  // ref: {n, st (Array), bounds, tones}, user: analyse()-Ergebnis
  function score(ref, user) {
    var al = dtw(ref.mfcc, user.mfcc, false), map = new Array(ref.n);
    al.path.forEach(function (p) { if (map[p[0]] === undefined) map[p[0]] = p[1]; });
    for (var i = 0; i < ref.n; i++) if (map[i] === undefined) map[i] = i > 0 ? map[i - 1] : 0;
    var syl = [], tot = 0, cnt = 0;
    for (var k = 0; k < ref.tones.length; k++) {
      var ra = ref.bounds[k], rb = ref.bounds[k + 1], ua = map[Math.min(ra, ref.n - 1)], ub = rb >= ref.n ? user.n : map[rb];
      var t = ref.tones[k], res = { k: k, tone: t, ua: ua, ub: ub };
      if (t === 5) { res.score = null; res.note = 'neutraler Ton, nicht bewertet'; syl.push(res); continue; }
      var rc = contour(ref.st, ra, rb, 10), uc = contour(user.st, ua, Math.max(ub, ua + 1), 10) || contour(user.st, Math.max(0, ua - 4), Math.min(user.n, ub + 4), 10, true);
      if (!rc) { res.score = null; res.note = 'nicht bewertet'; syl.push(res); continue; }
      if (!uc) { res.score = 0; res.note = 'nicht deutlich hörbar'; syl.push(res); tot += 0; cnt++; continue; }
      // 1) Vergleich mit der Vorlage, 2) Vergleich mit Lehrbuch-Tonkurve(n); das Bessere zählt
      var sc = compare(uc.c, rc.c, 0), best = rc.c, alts = (ref.alt && ref.alt[k]) || [t];
      alts.forEach(function (a) {
        (TEMPL[a] || []).forEach(function (tp) { var z = compare(uc.c, tp, 0.5); if (z > sc) { sc = z; best = tp; } });
      });
      res.score = sc; res.u = uc.c; res.r = rc.c;
      var rule = null, any = false;
      alts.forEach(function (a) { var r0 = rules(a, uc.c, rc.c); if (!r0) any = true; else if (!rule || r0[0] > rule[0]) rule = r0; });
      if (any) rule = null;
      if (rule && rule[0] < sc) { sc = rule[0]; res.score = sc; }
      res.note = sc >= 75 ? 'getroffen' : rule ? rule[1] : diagnose(t, uc.c, TEMPL[t] ? TEMPL[t][0] : rc.c);
      syl.push(res); tot += sc; cnt++;
    }
    return { total: cnt ? Math.round(tot / cnt) : 0, syl: syl, map: map, cost: al.cost };
  }

  var api = { SR: SR, HOP: HOP, analyse: analyse, boundariesFromPrefixes: boundariesFromPrefixes, score: score, dtw: dtw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TonDSP = api;
})(this);
