# Auftrag: neue Sprachinsel für Markus' Mandarin-App

Markus lernt Mandarin für den Alltag mit Freunden, Familie und auf Reisen. Er schickt deutsche Sätze aus der App. Du machst daraus ein Paket mit Chinesisch, Pinyin, Wort-Erklärungen und Audio. Der Auftrag steht in `/tmp/auftrag.txt`. Er enthält Name, Thema, eventuell einen Hinweis und die nummerierten Sätze.

## 1. Auftrag schreiben

Lege `werkzeug/auftraege/<id>.json` an:

```json
{
 "id": "insel-im-buero",
 "titel": "Im Büro",
 "thema": "Arbeit",
 "beschreibung": "Ein kurzer Satz, worum es geht.",
 "saetze": [["我 想 喝 一 杯 茶 。", "Ich möchte eine Tasse Tee trinken."]],
 "pinyin": {},
 "woerter": [],
 "zeichen": []
}
```

Regeln:
- `id`: `insel-` plus Titel in Kleinbuchstaben, nur a–z, 0–9 und Bindestrich (ä → ae, ö → oe, ü → ue). Prüfe mit `ls pakete/`, dass die id noch frei ist. Sonst hänge `-2` an.
- `titel` und `thema` wie im Auftrag. `beschreibung`: ein kurzer deutscher Satz.
- Übersetze jeden Satz in natürliches, gesprochenes Hochchinesisch in Kurzzeichen. Wähle einfache, häufige Wörter (möglichst HSK 1–4). Wenn ein deutscher Satz zu lang ist, darfst du ihn vereinfachen.
- Chinesisch: Trenne die Wörter durch Leerzeichen, auch vor Satzzeichen, zum Beispiel `你好 ， 我 叫 马库斯 。`. Erlaubte Satzzeichen sind ，。？！：“”、；. Schreibe Zahlen als chinesische Zeichen, nicht als Ziffern.
- Deutsch: Markus' Satz, Rechtschreibung korrigiert. Nie ß, immer ss.
- Der Hinweis im Auftrag (falls vorhanden) gilt für Ton und Stil.

## 2. Prüfen

```
python3 werkzeug/neue_insel.py werkzeug/auftraege/<id>.json --pruefen
```

Das Skript zeigt Pinyin und Töne je Wort.
- Kontrolliere Mehrfachlesungen wie 长, 了, 得, 地, 行, 还, 都, 觉, 着, 重, 好 und neutrale Töne. Korrigiere falsche Lesungen in `"pinyin"`, zum Beispiel `{"银行": "yín háng"}`. Jede Silbe bekommt Tonzeichen, Silben sind durch Leerzeichen getrennt.
- Bei «FEHLEND» ergänzt du die Einträge und prüfst erneut:
  - `"woerter"`: `["词", "Wortart", "deutsche Bedeutung", "Herleitung"]`. Die Wortart ist N, V, Adj, Adv, Präp, Part, ZW (Zählwort), Pron, Konj, Ausdruck oder Name.
  - `"zeichen"`: `["字", "Bedeutung", "Herleitung"]`.
- Die Herleitung ist kurz, auf Deutsch und richtig. Sie zerlegt das Zeichen in seine Bestandteile mit Bedeutung oder erklärt bei Wörtern, wie sich die Bedeutung aus den Zeichen ergibt. Beispiele stehen in `werkzeug/woerterbuch.txt` und `werkzeug/zeichen.txt`.

## 3. Bauen

```
python3 werkzeug/neue_insel.py werkzeug/auftraege/<id>.json
```

Es dauert etwa eine Minute. Bei «PROBLEM Satz N» hat die Sprachausgabe den Satz falsch gelesen. Formuliere diesen Satz leicht um, zum Beispiel mit einem anderen Wort oder anderer Wortstellung, und baue erneut. Am Ende steht «FERTIG …».

## 4. Ergebnis

Schreibe `/tmp/ergebnis.md` auf Deutsch (nie ß). Es wird als Kommentar im Issue gezeigt:

```
**«<Titel>» ist fertig.** In der App unter «Inseln» erscheint sie in ein paar Minuten. Dort «⬇︎ Laden» antippen.

| # | Chinesisch | Pinyin | Deutsch |
|---|---|---|---|
| 1 | 我想喝一杯茶。 | wǒ xiǎng hē yì bēi chá | Ich möchte eine Tasse Tee trinken. |

Neue Wörter: 词 (cí) Bedeutung: Herleitung; …
```

Ergänze einen Hinweis, wenn du einen Satz vereinfacht oder umformuliert hast.

Mach keinen Commit. Das Hochladen erledigt der nächste Schritt.
