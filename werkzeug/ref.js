// Silbengrenzen der Referenz: Zeitstempel der Spracherkennung, auf Energie-/Stimm-Minimum eingerastet.
// Aufruf: node ref.js jobs.json refs.json
const path = require('path'), fs = require('fs');
const D = require(path.join(__dirname, '..', 'dsp.js')), W = require(path.join(__dirname, 'wav.js'));
const jobs = JSON.parse(fs.readFileSync(process.argv[2])), out = {};
for (const j of jobs) {
  const w = W(j.wav), full = D.analyse(w.x, w.sr, true);
  const tok = [], tt = [];
  j.tok.forEach((c, i) => { for (const ch of c) { tok.push(ch); tt.push(j.t[i]); } });
  const tok2 = [], tt2 = [];
  tok.forEach((c, i) => { if (c === '儿' && j.chars[tok2.length] !== '儿') return; tok2.push(c); tt2.push(tt[i]); });
  const ok = tok2.length === j.chars.length;
  const b = [0];
  if (ok) {
    for (let k = 1; k < j.syl.length; k++) {
      const q = Math.round(tt2[k] * 100) - full.off - 3; let best = q, bc = 1e9;
      for (let x = Math.max(b[b.length - 1] + 4, q - 7); x <= Math.min(full.n - 3, q + 5); x++) {
        const c = full.e[x] + (full.st[x] === full.st[x] ? 6 : 0) + 0.6 * Math.abs(x - q);
        if (c < bc) { bc = c; best = x; }
      }
      b.push(best);
    }
  } else for (let k = 1; k < j.syl.length; k++) b.push(Math.round(full.n * k / j.syl.length));
  b.push(full.n);
  for (let k = 1; k < b.length; k++) if (b[k] <= b[k - 1]) b[k] = b[k - 1] + 1;
  out[j.n] = { bounds: b, off: full.off, n: full.n, tones: j.tones, alt: j.alt, syl: j.syl, asrOk: ok };
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
