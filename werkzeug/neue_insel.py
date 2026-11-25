"""Baut aus einem Auftrag (JSON) ein Sprachinsel-Paket für die Mandarin-App.

Aufruf:
  python3 werkzeug/neue_insel.py AUFTRAG.json --pruefen   # nur Pinyin, Töne, fehlende Einträge
  python3 werkzeug/neue_insel.py AUFTRAG.json             # Audio, Tonkurven, Paket, Katalog

Auftrag:
{
 "id": "insel-im-buero", "titel": "Im Büro", "thema": "Arbeit",
 "beschreibung": "Ein Satz, worum es geht.",
 "saetze": [["我 想 喝 茶 。", "Ich möchte Tee trinken."], ...],   # Wörter durch Leerzeichen getrennt
 "pinyin": {"长": "cháng"},                                       # optional: Pinyin je Wort (Silben mit Leerzeichen)
 "woerter": [["茶", "N", "Tee", "Herleitung …"]],                 # neue Wörterbuch-Einträge
 "zeichen": [["茶", "Tee", "Herleitung …"]]                       # neue Zeichen-Einträge
}
Modelle: Ordner in Umgebungsvariable MODELLE (Standard: werkzeug/.modelle).
"""
import sys, os, json, re, wave, subprocess, unicodedata

W = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(W)
PUN = '，。？！：“”、；'
TM = {'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì', 'o': 'ōóǒò', 'u': 'ūúǔù', 'ü': 'ǖǘǚǜ'}


def toneof(s):
    for ch in s:
        for t, v in enumerate(['āēīōūǖ', 'áéíóúǘ', 'ǎěǐǒǔǚ', 'àèìòùǜ'], 1):
            if ch in v:
                return t
    return 5


def load_tab(path, n):
    d = {}
    if os.path.exists(path):
        for l in open(path, encoding='utf-8'):
            p = l.rstrip('\n').split('|')
            if len(p) >= n:
                d.setdefault(p[0], p[:n])
    return d


def append_tab(path, rows, have):
    neu = [r for r in rows if r[0] not in have]
    if neu:
        with open(path, 'a', encoding='utf-8') as f:
            for r in neu:
                f.write('|'.join(x.replace('|', '/').replace('\n', ' ') for x in r) + '\n')
    return len(neu)


def pinyin_saetze(saetze, extra):
    from pypinyin import lazy_pinyin, Style
    FIX = json.load(open(os.path.join(W, 'pinyin_fix.json'), encoding='utf-8'))
    FIX.update(extra or {})
    res = []
    for hz, de in saetze:
        toks = hz.split()
        words = [t for t in toks if t not in PUN]
        auto = lazy_pinyin(''.join(words), style=Style.TONE)
        out = []; k = 0
        for w in words:
            syl = FIX[w].split(' ') if w in FIX else auto[k:k + len(w)]
            k += len(w); out.append(syl)
        for i, w in enumerate(words):  # 一 / 不 Sandhi (geschrieben)
            if w in ('一', '不') and i + 1 < len(words) and w not in (extra or {}):
                nt = 4 if words[i + 1] == '个' else toneof(out[i + 1][0])
                out[i] = [('bú' if nt == 4 else 'bù')] if w == '不' else [('yí' if nt == 4 else 'yì')]
        # Silben, Töne, 3-3-Sandhi
        syl = []; tones = []; alt = []; wid = []; chars = []; brk = set(); k = 0
        for wi, (w, p) in enumerate(zip(words, out)):
            cs = list(w)
            if len(p) < len(cs) and cs[-1] == '儿':
                cs = cs[:-1]
            if len(cs) != len(p):
                raise SystemExit(f'Pinyin passt nicht zu «{w}»: {p}. Bitte im Auftrag unter "pinyin" angeben.')
            for c, s in zip(cs, p):
                syl.append(s); t = toneof(s); tones.append(t); alt.append([t]); wid.append(wi); chars.append(c)
        # Satzzeichen-Grenzen als Silbenindex
        wi = 0
        for t in toks:
            if t in PUN:
                brk.add(k)
            else:
                k += len(out[wi]); wi += 1
        for j in range(len(syl) - 2, -1, -1):
            if tones[j] == 3 and tones[j + 1] == 3 and (j + 1) not in brk:
                tones[j] = 2
                alt[j] = [2] if wid[j] == wid[j + 1] else [2, 3]
        w_out = []; k = 0
        for t in toks:
            if t in PUN:
                w_out.append([t])
            else:
                w_out.append([t, ' '.join(out[k])]); k += 1
        res.append({'hz': hz, 'de': de, 'words': words, 'pys': out, 'w': w_out,
                    'syl': syl, 'tones': tones, 'alt': alt, 'chars': chars})
    return res


def fehlende(sents, D, C):
    miss_w = []; miss_c = []
    for s in sents:
        for w in s['words']:
            if w not in D and w not in miss_w:
                miss_w.append(w)
            if len(w) > 1:
                for ch in w:
                    if ch != '儿' and ch not in C and ch not in D and ch not in miss_c:
                        miss_c.append(ch)
    return miss_w, miss_c


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    pruefen = '--pruefen' in sys.argv
    A = json.load(open(args[0], encoding='utf-8'))
    pid = A['id']
    if not re.fullmatch(r'insel-[a-z0-9-]+', pid):
        raise SystemExit('id muss die Form insel-xyz haben (nur a-z, 0-9, -).')
    for k in ('titel', 'thema', 'beschreibung', 'saetze'):
        if not A.get(k):
            raise SystemExit(f'Feld «{k}» fehlt.')
    fd, fz = os.path.join(W, 'woerterbuch.txt'), os.path.join(W, 'zeichen.txt')
    D = load_tab(fd, 4); C = load_tab(fz, 3)
    nw = append_tab(fd, A.get('woerter', []), D); nz = append_tab(fz, A.get('zeichen', []), C)
    if nw or nz:
        print(f'Wörterbuch ergänzt: {nw} Wörter, {nz} Zeichen')
        D = load_tab(fd, 4); C = load_tab(fz, 3)
    sents = pinyin_saetze(A['saetze'], A.get('pinyin'))
    for i, s in enumerate(sents, 1):
        print(f'{i:2d}. ' + ' '.join(f"{w}[{' '.join(p)}]" for w, p in zip(s['words'], s['pys'])) + '  Töne: ' + ''.join(map(str, s['tones'])))
    mw, mc = fehlende(sents, D, C)
    if mw or mc:
        print('FEHLEND Wörter:', ' '.join(mw)); print('FEHLEND Zeichen:', ' '.join(mc))
        print('Bitte im Auftrag unter "woerter" / "zeichen" ergänzen (mit deutscher Bedeutung und Herleitung).')
        sys.exit(2)
    if pruefen:
        print('Prüfung ok.'); return
    bauen(A, sents, D, C)


def bauen(A, sents, D, C):
    import sherpa_onnx, soundfile as sf
    from piper import PiperVoice
    M = os.environ.get('MODELLE', os.path.join(W, '.modelle')) + '/'
    d = M + 'matcha-icefall-zh-baker/'
    zh = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        matcha=sherpa_onnx.OfflineTtsMatchaModelConfig(acoustic_model=d + 'model-steps-3.onnx', vocoder=M + 'vocos-22khz-univ.onnx',
                                                       lexicon=d + 'lexicon.txt', tokens=d + 'tokens.txt', dict_dir=d + 'dict'),
        num_threads=4), rule_fsts=f'{d}phone.fst,{d}date.fst,{d}number.fst'))
    pv = PiperVoice.load(M + 'vits-piper-de_DE-thorsten-medium/de_DE-thorsten-medium.onnx')
    a = M + 'sherpa-onnx-paraformer-zh-2023-09-14/'
    asr = sherpa_onnx.OfflineRecognizer.from_paraformer(paraformer=a + 'model.int8.onnx', tokens=a + 'tokens.txt', num_threads=4)
    pid = A['id']; tmp = os.path.join('/tmp', 'insel-' + pid) + '/'; os.makedirs(tmp + 'w', exist_ok=True)

    def say(text, out, speed=1.0):
        g = zh.generate(text, sid=0, speed=speed); sf.write(out, g.samples, g.sample_rate)

    def rec(p):
        x, sr = sf.read(p, dtype='float32'); s = asr.create_stream(); s.accept_waveform(sr, x); asr.decode_stream(s); return s.result

    jobs = []; probleme = []
    for i, s in enumerate(sents, 1):
        n = f'{i:02d}'; txt = s['hz'].replace(' ', '')
        want = ''.join(c for c in s['hz'] if c not in PUN + ' ').replace('儿', '')
        best = None; r = None
        for sp in (1.0, 0.92, 0.85, 1.08, 0.8):
            say(txt, tmp + n + '.wav', sp); r = rec(tmp + n + '.wav')
            if r.text.replace('儿', '') == want:
                best = sp; break
        if best is None:
            probleme.append(f'Satz {i} «{txt}»: Stimme liest «{r.text}». Bitte umformulieren.')
            best = 1.0; say(txt, tmp + n + '.wav', 1.0); r = rec(tmp + n + '.wav')
        say(txt, tmp + n + '-slow.wav', 0.75 * best)
        with wave.open(tmp + n + '-de.wav', 'wb') as w:
            pv.synthesize_wav(s['de'], w)
        for w_ in s['words']:
            if not os.path.exists(tmp + 'w/' + w_ + '.wav'):
                say(w_, tmp + 'w/' + w_ + '.wav')
        jobs.append({'n': n, 'wav': tmp + n + '.wav', 'chars': s['chars'], 'syl': s['syl'], 'tones': s['tones'], 'alt': s['alt'],
                     't': list(r.timestamps), 'tok': list(r.tokens)})
        print('Audio', n, 'Tempo', best, flush=True)
    if probleme:
        print('\n'.join('PROBLEM ' + p for p in probleme)); sys.exit(3)
    json.dump(jobs, open(tmp + 'jobs.json', 'w'), ensure_ascii=False)
    subprocess.run(['node', os.path.join(W, 'ref.js'), tmp + 'jobs.json', tmp + 'refs.json'], check=True)
    refs = json.load(open(tmp + 'refs.json'))

    base = os.path.join(ROOT, 'pakete', pid) + '/'
    if os.path.exists(base):
        import shutil; shutil.rmtree(base)
    os.makedirs(base + 'audio/w')

    def mp3(src, dst, br='40k'):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ac', '1', '-ar', '22050', '-b:a', br, dst], check=True)

    words = {}; chars = {}; saetze = []; wi = {}
    for i, s in enumerate(sents, 1):
        n = f'{i:02d}'
        for t in s['w']:
            if len(t) == 1:
                continue
            h, p = t
            if h not in words:
                e = D.get(h); wi[h] = len(wi) + 1
                mp3(tmp + 'w/' + h + '.wav', f'{base}audio/w/{wi[h]}.mp3', '32k')
                words[h] = {'py': p, 'art': e[1], 'de': e[2], 'herl': e[3], 'audio': f'audio/w/{wi[h]}.mp3'}
            if len(h) > 1:
                for ch in h:
                    if ch in chars or ch == '儿':
                        continue
                    chars[ch] = {'de': C[ch][1], 'herl': C[ch][2]} if ch in C else {'de': D[ch][2], 'herl': D[ch][3]}
        mp3(tmp + n + '.wav', f'{base}audio/{n}.mp3'); mp3(tmp + n + '-slow.wav', f'{base}audio/{n}-langsam.mp3'); mp3(tmp + n + '-de.wav', f'{base}audio/{n}-de.mp3')
        r = refs[n]
        saetze.append({'nr': i, 'w': s['w'], 'de': s['de'], 'audio': f'audio/{n}.mp3', 'langsam': f'audio/{n}-langsam.mp3', 'audioDe': f'audio/{n}-de.mp3',
                       'ton': {'grenzen': r['bounds'], 'toene': r['tones'], 'alt': r['alt'], 'silben': r['syl']}})
    pk = {'format': 'mandarin-paket', 'version': 1, 'id': pid, 'typ': 'insel', 'titel': A['titel'], 'thema': A['thema'],
          'beschreibung': A['beschreibung'], 'saetze': saetze, 'woerter': words, 'zeichen': chars}
    json.dump(pk, open(base + 'paket.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    files = ['paket.json'] + sorted(os.path.relpath(os.path.join(dp, f), base) for dp, _, fs in os.walk(base + 'audio') for f in fs)
    meta = {'id': pid, 'typ': 'insel', 'titel': A['titel'], 'thema': A['thema'], 'beschreibung': A['beschreibung'], 'saetze': len(saetze),
            'groesse': sum(os.path.getsize(base + f) for f in files), 'dateien': files}
    kp = os.path.join(ROOT, 'pakete', 'katalog.json')
    kat = json.load(open(kp, encoding='utf-8'))
    pk_list = [p for p in kat['pakete'] if p['id'] != pid]
    # neue Insel nach der letzten Insel desselben Themas, sonst nach der letzten Insel
    pos = max([i for i, p in enumerate(pk_list) if p['typ'] == 'insel' and p['thema'] == A['thema']] or
              [i for i, p in enumerate(pk_list) if p['typ'] == 'insel'] or [-1]) + 1
    pk_list.insert(pos, meta); kat['pakete'] = pk_list
    json.dump(kat, open(kp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    asr_ok = sum(1 for r in refs.values() if r['asrOk'])
    print(f'FERTIG {pid}: {len(saetze)} Sätze, {len(words)} Wörter, {meta["groesse"] // 1024} KB, Silbengrenzen aus Spracherkennung: {asr_ok}/{len(saetze)}')


if __name__ == '__main__':
    main()
