# OneProof — Klick-Dummy

Vorführbare Oberfläche für die SPRIND-Einreichung **„OneProof — Einreichen statt
Nachreichen"**. Gezeigt wird die letzte Seite eines Elterngeldantrags: was über eine
NOOTS-Abfrage bereits belegt ist, was noch einzureichen ist, und dass eingereicht
werden kann, solange etwas offen ist.

Elterngeld ist mit Absicht gewählt. Das Paper behauptet, OneProof sei leistungsneutral
und nicht das Wohngeldprodukt in neu — das zeigt man an einer Leistung, die
LeistungsLotse nicht baut.

Neben dem Dummy gibt es eine zweite Seite, die nichts vorspielt: die **Nachweisprüfung**.
Sie liest echte Antragsdaten und echte Nachweise und prüft sie mit der Nachweis- und
Gruppierungsengine von LeistungsLotse (siehe [Nachweisprüfung](#nachweisprüfung-pruefenhtml)).
Eine dritte Seite gehört der Fachabteilung: Dort wird festgelegt, welche Unterlagen als
Nachweis genügen (siehe [Nachweisprofile verwalten](#nachweisprofile-verwalten-sachbearbeitunghtml)).

## Die Seiten

| Adresse | Inhalt |
|---|---|
| `/` | Klick-Dummy: die letzte Seite eines Elterngeldantrags, mit Registerabruf über den NOOTS-Mock und hinterlegten Prüfergebnissen |
| `/pruefen.html` | Nachweisprüfung für Wohngeld: Antragsdaten und Nachweise hochladen, prüfen lassen |
| `/sachbearbeitung.html` | Nachweisprofile verwalten: für die Fachabteilung, welche Unterlagen je Angabe genügen |
| `/api.html` | Referenz der OneProof-Schnittstelle (`public/openapi.yaml`) |
| `/format/oneproof/` | die JSON Schemas des [OneProof Formats](docs/oneproof-format.md) mit einem Beispielantrag |

## Was der Dummy zeigt

| Zustand | Bedeutung |
|---|---|
| `belegt` | Die Angabe ist nachgewiesen — über NOOTS oder über ein geprüftes Dokument |
| `offen` | Für die Angabe fehlt noch ein Nachweis |
| `unklar` | Ein Nachweis liegt vor, deckt die Angabe aber nicht vollständig ab |
| `nicht erforderlich` | Die Angabe ist in diesem Fall nicht zu belegen |

Im Mittelpunkt steht nicht die Datei, sondern die zu belegende **Tatsache** mit Person
und Zeitraum. Genau das unterscheidet den Ansatz von einer statischen Nachweisliste.

**Der Weg durch die Vorführung:** Beim Einkommensnachweis eine beliebige Datei
hochladen. Die Prüfung kommt als `unklar` zurück — elf von zwölf Monaten erkannt, März
2026 fehlt. Nachreichen macht daraus `belegt`. Das ist der Teilnachweis, an dem der
Unterschied zur Checkliste sichtbar wird. Der Knopf „Antrag einreichen" bleibt immer
aktiv: fristwahrende Einreichung ist auch mit offenen Punkten möglich.

## Nachweisprüfung (`/pruefen.html`)

Der Dummy zeigt, wie ein Ergebnis aussieht. Die Nachweisprüfung erzeugt eines. Sie nimmt
die Antragsdaten eines Wohngeldantrags und die Nachweise dazu und sagt, welche Angabe im
Antrag belegt ist, was noch fehlt und was in diesem Fall nicht erforderlich ist. Das
Ergebnis steht auf einer Seite, die dem Dummy folgt. Wohngeld ist das erste **Profil**,
nicht der Zweck der Seite: Die Engine kennt keine Leistung, sondern liest ein Profil
([Prüfprofile](docs/pruefprofile.md)).

### Ablauf

1. **Antragsdaten hochladen.** XML-Datei zum FIM-Schema der Wohngeldanträge (XDF 1.7.0) oder
   JSON-Datei im [OneProof Format](docs/oneproof-format.md). Sie wird sofort gelesen. Die Seite
   zeigt Antragsart, Format, Schema, Version und die Personen im Antrag. Anträge in Version
   1.6.1 werden mit der Abbildung des Herausgebers auf 1.7.0 umgesetzt. Eine Datei im OneProof
   Format wird nur gelesen, wenn sie gegen ihr Schema gültig ist; sonst nennt die Seite die
   Fehler mit ihrer Stelle.
2. **Nachweise hochladen** (optional). PDF, JPEG oder PNG, auch mehrere auf einmal. Ohne
   Nachweise zeigt die Prüfung, was einzureichen ist, und braucht keine KI.
3. **Prüfen.** Ein Ladebalken zeigt die Schritte *Antragsdaten lesen*, *Nachweise öffnen*,
   *Seiten lesen*, *Seiten zu Dokumenten ordnen* und *Dokumente den Angaben im Antrag
   zuordnen*. Die Prüfung lässt sich abbrechen.
4. **Ergebnis.** Die Seite sieht aus wie der Dummy und zeigt, was noch zu tun ist, was
   belegt ist und was nicht erforderlich ist. Ganz oben steht, dass der Abgleich KI-basiert
   erfolgte (oder ohne KI, wenn keine Nachweise vorlagen), daneben „Neue Prüfung“. Zu jeder
   offenen Angabe steht, welche Unterlagen genügen. Dazu kommen die erkannten Unterlagen, die
   Angaben zur Prüfung und das **Manifest** nach der OneProof-Schnittstelle zum Speichern
   (JSON).
5. **Ergänzen und Einreichen.** Dateien, die an einer Angabe nachgereicht werden, lösen eine
   neue Prüfung aus. Seiten, die schon gelesen sind, werden nicht noch einmal gelesen. Das
   Manifest hält fest, wie sich der Status jeder Angabe über die Prüfungen geändert hat.
   „Antrag einreichen" bleibt immer möglich, auch mit offenen Punkten. Das Einreichen ist in
   dieser Vorführung **simuliert**: Es entsteht ein Aktenzeichen, aber nichts wird
   übermittelt. Was übermittelt würde, lädt der Browser herunter: das **Antragspaket**
   (unten).

Scheitert das Ordnen der Seiten (Zeitlimit, Fehler des Dienstes, unbrauchbare Antwort), endet
die Prüfung trotzdem mit einem Ergebnis: Die gelesenen Seiten stehen unter „Nicht zugeordnete
Unterlagen“, eine Warnung sagt, was passiert ist, und „Erneut prüfen“ wiederholt nur das
Ordnen. Fällt dagegen das Lesen der Seiten aus (kein Zugang, kein Modell, drei Seiten in Folge
nicht lesbar), bricht die Prüfung ab und bietet die Wiederholung auf der Fehlerseite an.

Mit **„Beispiel laden"** stehen fünf erfundene Fälle mit Antrag und Nachweisen bereit
(`public/beispiele/wohngeld/`, beschrieben in `index.json`). Jede Seite ist als MUSTER
gekennzeichnet. Die Nachweise liegen so vor, wie sie in der Praxis kommen:

| Fall | Was er zeigt |
|---|---|
| Familie Berger, Mietzuschuss | ein Scan mit 13 Seiten durcheinander: der Mietvertrag auf drei verstreuten Seiten, drei Gehaltsabrechnungen, ein Bescheid über zwei Seiten, eine leere Rückseite, Unterlagen, nach denen der Antrag nicht fragt; dazu ein Foto |
| Herr Yilmaz, Weiterleistung | ein Foto, eine zu alte Abrechnung, eine gemischte PDF mit der Lohnabrechnung des Sohnes, der im Antrag nicht vorkommt, und einer Ausweiskopie |
| Frau Schmidt, Lastenzuschuss | eine Eigentümerin: drei PDFs mit vermischten Seiten (Rente und Sterbeurkunde, Darlehen und Grundsteuer, Grundbuch und Hausgeld) und einer Vereinsbescheinigung, die nicht zum Antrag gehört |
| Familie Einstein, Mietzuschuss | der einfache Fall mit je einer Datei pro Nachweis, in dem alle vier Zustände vorkommen: ein Kontoauszug, der die Miete belegen kann, was sich aber nicht automatisch feststellen lässt (`unklar`); eine Verdienstbescheinigung auf eine Person, die im Antrag nicht steht (`unklar`); fehlende Belege für Werbungskosten (`offen`); Fragen, die der Antrag mit „Nein“ beantwortet (`nicht erforderlich`); und belegte Angaben |
| Familie Einstein, OneProof Format | derselbe Antrag als JSON-Datei im OneProof Format, mit denselben Nachweisen. Ablauf und Art der Prüfung sind gleich, die Angaben können sich in Zahl und Wortlaut unterscheiden ([Unterschiede zu FIM](docs/oneproof-format.md#unterschiede-zu-fim-im-wohngeld-profil)); das Antragspaket enthält `antrag.json` |

### Das Antragspaket

„Antrag einreichen“ lädt `<Aktenzeichen>-antragspaket.zip` herunter, das, was an das
Fachverfahren ginge:

| Datei | Inhalt |
|---|---|
| `antrag.json` | statt `antrag.xml`, wenn der Antrag im OneProof Format kam: die hochgeladenen Angaben mit neu geschriebenen `anlagen`. Die Datei wird dazu gelesen und neu ausgegeben: Die Angaben bleiben inhaltlich, was sie waren, Einrückung und Zahlenschreibweise können sich ändern (`110.0` wird `110`), und Zahlen mit mehr als 15 gültigen Stellen werden gerundet. Jede Datei des Pakets ist eine Anlage mit Dokumentart, Person, SHA-512 und den Angaben, die sie belegt (`bezuege`, als JSON-Pointer). Siehe [docs/oneproof-format.md](docs/oneproof-format.md#im-antragspaket). |
| `antrag.xml` | die hochgeladenen Antragsdaten als FIM-Instanz. In den Feldern vom Datentyp „Datei“ (Nachweis) steht an jeder Stelle, zu der die Prüfung ein Dokument abgelegt hat, sein Dateiname im Paket. Verweise, die der hochgeladene Antrag schon mitbrachte, werden entfernt: Sie nennen Dateien, die nicht im Paket liegen. |
| `oneproof-manifest.json` | das Ergebnis je zu belegender Angabe: Status, Beleg mit Datei im Paket, Fundstelle und SHA-512, Prüfhistorie; bei einem Antrag im OneProof Format auch die Stelle der Angabe im Antrag (`stelle`) |
| `inhalt.txt` | dasselbe zum Lesen: jede Datei, woher ihre Seiten stammen, wo der Antrag auf sie verweist, und warum nicht, wo er es nicht tut |
| `<dokument>.pdf` | ein PDF je erkanntem Dokument, die Seiten in der Reihenfolge des Dokuments, gleich ob sie aus einem Sammelscan oder aus mehreren Dateien kamen. Fotos werden zu PDF-Seiten. |

Keine Seite geht verloren: Jede hochgeladene Seite steht in genau einer Datei des Pakets.
Was keinem Dokument zugeordnet werden konnte, liegt in `nicht-zugeordnete-seiten.pdf`, eine
Datei, die sich nicht öffnen ließ, liegt unverändert bei. Ohne Verweis im Antrag bleiben
Dokumente, nach denen der Antrag nicht fragt (ein Kindergeldbescheid im Wohngeldantrag),
Dokumente auf eine Person, die im Antrag nicht oder nicht zu dieser Angabe vorkommt, und
Dokumente, deren Stelle der Antrag nicht enthält und die nur mit erfundenen Pflichtangaben
anzulegen wäre. Ein gegen die XSD gültiger Antrag bleibt so auch mit den Verweisen gültig.
Der Grund steht in `inhalt.txt` und auf der Seite nach dem Einreichen.

### Einrichten: der Zugang zur KI

Die Prüfung liest die Seiten der Nachweise und ordnet sie mit zwei Modellen von IONOS (AI
Model Hub):

| Aufgabe | Modell |
|---|---|
| Seiten lesen (Texterkennung) | LightOnOCR 2 |
| Seiten zu Dokumenten gruppieren | Qwen3.8 27B, Reasoning auf dem Standard |

Der Zugang braucht ein **API-Token**. Es gehört auf den Server und nie in die Seite:

```bash
cp .env.example .env     # dann IONOS_API_TOKEN in .env eintragen
npm run dev              # oder: npm run build && npm run preview
```

Die Seite spricht nur mit ihrem eigenen Server unter `/ionos/v1/…`. Der Server hängt das
Token an und reicht den Aufruf an IONOS weiter (`vite/ionos-proxy.ts`). Weitergegeben werden
nur `POST /v1/chat/completions` und `GET /v1/models`, und eine Chat-Anfrage nur, wenn sie
eines der Modelle aus `public/konfiguration.json` nennt, `max_tokens` von höchstens 32768
setzt und weder streamt noch mehrere Antworten verlangt. Auf einem Server übernimmt ein Reverse
Proxy wie nginx diese Aufgabe, ohne in die Anfragen zu sehen.

Fehlt das Token oder ist es ungültig, sagt die Seite es klar („Der Zugang zur KI wurde
abgelehnt“) und nennt, was zu tun ist. Ohne Nachweise läuft die Prüfung auch ohne Token.

**Modelle.** Die genaue Modell-ID steht nicht im Code. `public/konfiguration.json` legt fest,
wie sie gefunden wird:

```json
{
  "ionos": {
    "ocr":  { "modell": null, "suche": ["lightonocr2"] },
    "text": { "modell": null, "suche": ["qwen38", "27b"] }
  },
  "ocr": { "parallel": 3 }
}
```

Ist `modell` leer, fragt die Seite `GET /v1/models` ab und nimmt das Modell mit dem kürzesten
Namen, der alle Wörter aus `suche` enthält (Groß- und Kleinschreibung und Satzzeichen
zählen nicht). Wer die ID kennt, trägt sie bei `modell` ein, genau so, wie IONOS sie nennt.
`ocr.parallel` ist die Zahl der Seiten, die gleichzeitig gelesen werden. Die Datei wird beim
Öffnen der Seite geladen und ist nicht in den Code eingebaut: Ein Modellwechsel ändert nur
diese Datei. Findet sich kein passendes Modell, nennt die Meldung die vorhandenen und
verweist auf diese Datei.

**Kontextfenster.** Alle gelesenen Seiten gehen in einer Anfrage an das Gruppierungsmodell,
je Seite höchstens 1500 Zeichen. Wie viel Platz die Antwort bekommt (`max_tokens`, zwischen
4096 und 32768), richtet sich nach dem Kontextfenster des Modells. Nennt `/v1/models` es
nicht, lässt es sich angeben (die Zahl ist ein Beispiel, nicht die Größe bei IONOS):

```json
"text": { "modell": null, "suche": ["qwen38", "27b"], "kontextfenster": 131072 }
```

Ohne Angabe gilt die Obergrenze von 32768. Passt die Anfrage nicht ins Fenster, sagt die
Prüfung das, statt eine abgeschnittene Antwort zu verwerten. Die tatsächliche Größe bei
IONOS ist vor der ersten Vorführung nachzusehen.

### Was sich nicht prüfen ließ

Beim Bauen lag **kein IONOS-Token** vor, nur die Form der Konfiguration. Deshalb gilt:

- Die echten Modelle wurden **nicht** aufgerufen. Weder die Modell-IDs noch die Qualität der
  Texterkennung und der Gruppierung sind an echten Unterlagen geprüft. Sie sind vor einer
  Vorführung zu prüfen: Token eintragen, „Beispiel laden“, „Prüfen“.
- Alles andere wurde im echten Browser gegen einen Ersatz für IONOS getestet (Tesseract als
  Texterkennung, Stichwortgruppierung): Laden, Fortschritt, Ergebnis, Ergänzen, Fehlerfälle,
  ein Ausfall der Gruppierung mit „Erneut prüfen“, Einreichen, Manifest. Der Beispielfall ergibt damit 19 Angaben: 2 belegt, 2 offen, 2
  unklar, 13 nicht erforderlich. Mit den echten Modellen kann das Ergebnis abweichen.
- Für alle vier Beispielfälle ist auch das Antragspaket so geprüft: entpackt, `antrag.xml`
  gegen die XSD des Schemas, jeder Verweis gegen die Dateien im Paket, jede PDF mit `qpdf`,
  die Seitenzahl gegen die hochgeladenen Seiten. Der Antrag Einstein ist schon so, wie er
  hochgeladen wird, nicht gültig gegen die XSD (im Kopfteil fehlt `dienstname`); die anderen
  drei sind es, mit den Verweisen.
- Der fünfte Fall, Einstein im OneProof Format, ist in den Tests mit der Ersatz-KI bis zum
  Antragspaket durchgespielt: `antrag.json` ist gegen sein Schema gültig, jeder Bezug trifft
  eine Angabe, die Prüfsummen stimmen. Im Browser (Chrome) läuft er mit einem Ersatz für
  IONOS (feste Texte als Texterkennung, die Regeln der Testhilfe als Gruppierung) von der
  Prüfung bis zum Einreichen: Das Paket enthält `antrag.json`, es ist gegen das Schema
  gültig, und die SHA-512 der Anlagen stimmen.
- Der Kern, der Antrag, Profil und erkannte Dokumente zu Angaben und Status verrechnet,
  läuft ohne Netz und ist durch Tests abgedeckt.

### Grenzen

- Höchstens **30 Dateien**, je Datei **50 MB**, der Antrag **5 MB**, zusammen **120 Seiten**
  je Prüfung. Das Seitenlimit greift, bevor die KI aufgerufen wird.
- Gelesen werden PDF, JPEG und PNG. Die Seite wird für Chrome und Edge ab 111, Firefox ab 114 und
  Safari ab 16.4 gebaut (das Standardziel von Vite). PDF.js läuft in seiner Legacy-Fassung: Die
  moderne ruft `Map.prototype.getOrInsertComputed` und `Math.sumPrecise` ohne Ersatz auf, und beides
  gibt es erst in Chrome und Edge ab 147, Firefox ab 144 und Safari ab 26.2. Im Browser getestet
  ist ein aktuelles Chrome.
- Die Prüfung stellt fest, **was belegt ist, nicht ob ein Anspruch besteht**.
- Beträge im Antrag werden nicht mit denen auf den Unterlagen verglichen.
- Das Monatsfenster beim Einkommen (drei Monatsabrechnungen, keine älter als sechs Monate,
  gerechnet ab dem Datum des Antrags) ist ein Beispielwert. Welche Unterlagen und wie viele
  Monate die Behörde verlangt, ist mit ihr abzustimmen und im Profil anzupassen.
- Ob eine Unterlage zur Angabe passt, entscheidet die Engine nach Typ und Person. Ein
  Kontoauszug „kann“ Miete oder Unterhalt belegen, ob er es tut, steht im Inhalt. Solche
  Fälle bleiben `unklar` und gehen an die Sachbearbeitung.
- Die Verweise im Antrag sind Dateinamen im Antragspaket, so wie FIM Felder vom Datentyp
  „Datei“ füllt. Wie ein Fachverfahren Anlagen annimmt, ist mit ihm abzustimmen; das Manifest
  nennt dafür je Beleg Datei, Fundstelle und Hash.
- Im XSD der Wohngeld-Schemata 1.7.0 endet das Muster für die E-Mail-Adresse
  (`F60000000242`) auf `$`. In XSD-Mustern ist das kein Zeilenende, sondern ein Zeichen:
  Gültig ist nur eine Adresse, die auf „$“ endet. Ein Antrag mit E-Mail-Adresse besteht die
  Prüfung gegen die XSD deshalb nie. Die Beispielanträge Berger, Yilmaz und Schmidt lassen
  die E-Mail-Adresse weg.

### Datenschutz

Die Engine läuft im Browser. Die Antragsdatei verlässt ihn nicht. An den KI-Dienst von IONOS
gehen die **Seiten der Nachweise als Bild**, der daraus gelesene **Text**, die **Namen der
Personen** aus dem Antrag (mit Geburtsnamen und Rolle, auch Personen außerhalb des Haushalts
wie Mitbewohner, Unterhaltsempfänger oder eine Vertretung) und die **Wohnsituation** aus dem
Antrag (Mietverhältnis, Eigentumsform, ob weitere Personen in der Wohnung leben). Die
Eingabeseite sagt das, bevor geprüft wird. Für die Vorführung sind erfundene Daten zu nehmen. Wechselt der Endpunkt (`IONOS_ENDPOINT`), ist der Hinweis auf der
Seite (`src/pruefen/Eingabe.tsx`) anzupassen.

## Nachweisprofile verwalten (`/sachbearbeitung.html`)

Welche Unterlagen für eine Angabe genügen, entscheidet die Fachabteilung, nicht der Code. Auf
dieser Seite stellt sie es ein: Zu jeder Angabe eines Profils (Miete, Einkommen, …) stehen alle
bekannten Dokumenttypen zur Wahl, jeweils als „Genügt“, „Kann genügen“, „Ergänzt nur“ oder
„Nicht zugelassen“. Dazu kommen der Hinweis an die Antragstellenden und, wo ein Zeitraum
verlangt wird, die Zahl der Monate. Die Seite kennt keine Leistung, sie zeigt, was das geladene
Profil enthält. Eine weitere Antragsart erscheint dort, sobald ihr Profil in
`public/profile/index.json` steht. Anlegen lässt sie sich aus der XDF-Datei eines FIM-Schemas
oder aus dem JSON Schema einer Leistung im [OneProof Format](docs/oneproof-format.md).

Die Seite ist statisch und kann nicht auf den Server schreiben. Der Weg einer Änderung:

1. Sie liegt als **Entwurf im Browser** und überlebt das Neuladen.
2. **„Entwurf ausprobieren“** öffnet die Nachweisprüfung mit dem Entwurf
   (`/pruefen.html?profil=wohngeld&entwurf`). Ein Hinweis oben sagt, dass es nur ein Entwurf ist.
3. **„Neue Version veröffentlichen“** erzeugt ein Paket (ZIP) mit dem Ordner der neuen Version
   und der fortgeschriebenen `index.json`. Es wird nach `public/` kopiert und wie jeder Stand
   gebaut und ausgeliefert. Frühere Versionen bleiben, ein
   Ergebnis bleibt also nachvollziehbar.

Das ist **keine Freigabe und keine Zugangsbeschränkung**: Der Entwurf bleibt in einem Browser,
und was veröffentlicht wird, spielt jemand ein. Wer die Seite nur der Fachabteilung zeigen will,
schützt sie am Webserver. Alles Weitere steht unter
[Profile pflegen](docs/pruefprofile.md#profile-pflegen-die-seite-der-fachabteilung).

## Die Engine

Die Engine ist reine Logik ohne Oberfläche (`src/engine/`). Alles, was nach außen greift (die
KI, das Öffnen der Dateien), wird ihr übergeben. Deshalb läuft sie im Browser und in den
Tests gleich.

```
Antrag (XML/JSON) ─► lesen ────────► Ziele: wo im Antrag Nachweise hingehören   (ohne Netz)
Nachweise ────► öffnen ► lesen ────► Text je Seite                              (LightOnOCR 2)
                         ► gruppieren ► Dokumente: Typ, Person, Seiten           (Qwen3.8 27B)
                                       ► zuordnen ► Angaben mit Status          (ohne Netz)
```

Nur die beiden mittleren Schritte brauchen die KI. Das Zuordnen ist deterministisch:
dieselben Dokumente und derselbe Antrag ergeben immer dasselbe Ergebnis.

| Ort | Aufgabe |
|---|---|
| `src/engine/pipeline.ts` | der Ablauf mit Fortschritt, Abbruch und Seitenlimit |
| `src/engine/antrag.ts` | erkennt am Inhalt, ob ein Antrag FIM oder OneProof Format ist |
| `src/engine/fim/` | FIM-Antragsdatei lesen, ältere Schema-Versionen abbilden, Verweise auf Nachweise schreiben; der Zugang der Ziele zu FIM-Anträgen (`zugang.ts`) |
| `src/engine/oneproof/` | das [OneProof Format](docs/oneproof-format.md): Schemas laden und kompakt machen, Antrag prüfen und lesen, JSON-Pointer, der Zugang der Ziele, Anlagen im Antragspaket, Antragsart aus dem JSON Schema ableiten |
| `src/engine/profil/` | Profile laden und auf Stimmigkeit prüfen; ihre Regeln ändern und Entwürfe führen (für die Fachabteilung) |
| `src/engine/ocr/` | Seiten lesen und den Text bereinigen |
| `src/engine/gruppierung/` | Seiten zu Dokumenten ordnen; danach feste Regeln: Typ korrigieren, Sammel-PDF mit Lohnabrechnungen nach Monaten schneiden, Einzelstücke zu Reihen verbinden |
| `src/engine/zuordnung/` | Ziele aus Schema und Profil (für beide Formate, über deren Zugang), Personenabgleich, Platzierung, Anforderungen und Status |
| `src/engine/ionos/` | Client für IONOS: Wiederholung, Zeitlimit, Modellsuche |
| `src/engine/manifest.ts` | das Ergebnis als OneProof-Manifest |
| `src/engine/paket/` | das Antragspaket: Dateinamen, Verweise im Antrag, Übersicht, ZIP |
| `src/pdf/` | PDF und Bilder öffnen, Seiten rendern, Hash; Seiten zu einem PDF je Dokument zusammenstellen, Fotos als PDF-Seite |

Monatsschnitt, Reihenbildung, Typkorrektur und Platzierung sind Portierungen der
Laravel-Engine. Wo sie abweichen, steht es im Kopfkommentar der Datei.

**Wie ein Status entsteht.** Eine Anforderung ist eine Aussage im Antrag, kein Dokument. Ihr
Status folgt aus den Dokumenten, die an ihrer Stelle liegen, und aus der Rolle, die das
Profil jedem Dokumenttyp gibt:

| Status | Wann |
|---|---|
| `belegt` | ein Dokument liegt vor, das allein genügt; die Person kommt im Antrag vor; ein geforderter Zeitraum ist gedeckt |
| `unklar` | ein Dokument liegt vor, das genügen kann, aber nicht automatisch geprüft werden kann; oder es fehlen Monate oder sie sind zu alt; oder es lautet auf eine Person, die im Antrag nicht oder nur an anderer Stelle steht; oder es passt zu mehreren Angaben gleich gut; oder die Frage im Antrag ist noch offen |
| `offen` | nichts genügt bisher, auch wenn ergänzende Unterlagen vorliegen |
| `entfaellt` | der Antrag selbst sagt, dass die Aussage nicht zutrifft (Frage mit „Nein“ beantwortet) |

Ein Dokument auf eine andere Person zählt bei einer Angabe nie mit. Hat die Person dort ein
eigenes Dokument, das genügt, steht das fremde unter den nicht zugeordneten Unterlagen, mit
dem Namen, auf den es lautet. Ist es das einzige, bleibt es dort, und die Angabe ist
`unklar`: Der Name kann falsch gelesen sein. Der Antrag im Antragspaket verweist in beiden
Fällen nicht darauf.

### Weitere Antragsarten und Nachweisregeln

Welcher Nachweis wofür genügt, steht nicht im Code, sondern im Profil: Bei der Miete etwa
genügen Mietvertrag und Mietbescheinigung, ein Mietzahlungsnachweis oder Kontoauszug kann
genügen und führt zu `unklar`, eine Nebenkostenabrechnung ergänzt nur. Wer das anders
will, stellt es auf der Seite der Fachabteilung ein (oben) oder ändert eine Zeile. Eine
weitere Leistung ist ein weiterer Ordner unter `public/profile/`, kein weiterer Code. Das
beschreibt [docs/pruefprofile.md](docs/pruefprofile.md).

## Design

[KERN UX](https://www.kern-ux.de/) im Original, Paket `@kern-ux/native`. Keine
LeistungsLotse-Marke auf der Seite — OneProof erscheint als benannte Schicht in der
Fußzeile, nicht als Absender des Dienstes. Das ist die Aussage des Papers: OneProof ist
weder Portal noch Registerabruf, sondern die Schicht dazwischen. Die Nachweisprüfung nutzt
dieselben Bausteine und dieselbe Kopf- und Fußzeile wie der Dummy
(`src/components/`).

Zwei Dinge, die hier bewusst **nicht** passieren:

- Die KERN-Kopfzeile wird ohne Bundesflagge verwendet. Der Dienst ist erfunden.
- `mein-elterngeldantrag.de` wurde nicht nachgebaut. Das ist ein echter Dienst des
  Bundes mit eigener Marke und lizenzpflichtigen Schriften (Relevant, Walbaum) — und
  nutzt übrigens kein KERN UX, sondern das Behörden-Serviceportal-System.

Ein Stolperstein beim Stylen: Tailwind-Klassen liegen in einer CSS-Ebene, die KERN-Regeln
nicht. Ein `mt-4` an einem KERN-Element greift deshalb nicht. Dort hilft der Zusatz `!`
(`mt-4!`), so wie im Dummy.

## Daten

Alle Namen und Aktenzeichen sind erfunden. Landkreis Auenthal existiert nicht.

Der Dummy fragt Geburt, Wohnung und Identifikationsnummer beim Öffnen über den NOOTS-Mock in
[`backend/`](backend) ab (`src/noots.ts`, `POST /noots/dca/v1/evidence-requests`). Was der Mock
liefert, gilt als belegt und nennt Register, Stelle und Zeitpunkt des Abrufs. Was er nicht
liefert, oder wenn er nicht läuft, fällt an die antragstellende Person: Die Angabe steht dann
mit dem Grund unter den einzureichenden Nachweisen. Ein Register wird dabei nicht abgefragt,
die Daten des Mocks liegen als JSON in `backend/data/`.

Die Prüfung eines hochgeladenen Nachweises bleibt im Dummy eine Zeitverzögerung von
1,2 Sekunden mit einem je Anforderung fest hinterlegten Ergebnis, damit eine Vorführung
wiederholbar bleibt.

In der Nachweisprüfung ist die Prüfung echt, das Einreichen nicht. Es findet keine Abfrage
bei Behörden statt, und es wird kein Antrag gestellt. Die Beispieldaten (Haushalte Berger,
Yilmaz, Schmidt und Einstein) sind frei erfunden, mit allen Namen, Anschriften, Beträgen,
Kontodaten und Behörden darin.

## Entwickeln

```bash
npm install
npm --prefix backend install
cp .env.example .env   # IONOS_API_TOKEN eintragen, nur für die Nachweisprüfung mit Nachweisen
npm run backend        # der NOOTS-Mock auf http://localhost:8787, in einem zweiten Terminal
npm run dev            # http://localhost:5173, die Prüfseite unter /pruefen.html, die Profilverwaltung unter /sachbearbeitung.html
npm run build
npm run preview        # den Build ansehen, mit dem KI-Zugang
npm test               # Tests, ohne Netz und ohne Browser
npm run typecheck      # TypeScript prüfen (tsc, ohne Ausgabe)
npm run lint
npm run check          # Typen, Lint und Tests zusammen
```

Node.js 22.12 oder neuer für Frontend, Tests und Build (`engines` in `package.json`). Der NOOTS-Mock
(`npm run backend`) braucht Node.js 24 (`backend/package.json`). `pdfjs-dist@6.4.299` deklariert
`>=22.13.0 || >=24`: Unter 22.12 kann npm dazu eine Engine-Warnung ausgeben; Tests und Build laufen
auf 22.12.0 trotzdem.

Der Code ist TypeScript im strengen Modus (`tsconfig.json`: `strict`, dazu `noUncheckedIndexedAccess` und
`verbatimModuleSyntax`). `npm run build` prüft die Typen, bevor Vite baut; `npm run typecheck` prüft allein. Vite
bündelt die Quellen selbst, und Node führt die `.ts`-Tests direkt aus, ohne Übersetzungsschritt (Type Stripping). Darum
gilt, was Node versteht: Importe mit Endung `.ts`, Typen über `import type`, und kein `enum`, kein `namespace` und keine
Parameter-Properties (`erasableSyntaxOnly`). Der Linter verbietet `any`, `@ts-ignore` und die Non-Null-Zusicherung `!`.

`.env` gehört nicht ins Repository (`.gitignore`). Der Dev-Server und `vite preview` stellen
den KI-Zugang unter `/ionos` bereit. Eine Datei, die nur mit `serve` oder einem anderen
statischen Server ausgeliefert wird, hat ihn nicht. Dafür muss ein Reverse Proxy die Aufrufe
unter `/ionos/v1/` an IONOS weiterreichen und das Zugangstoken ergänzen.

Genauso reichen beide den Registerabruf unter `/noots` an den NOOTS-Mock weiter (`NOOTS_URL`,
sonst `http://127.0.0.1:8787`). Der Mock ist ein eigenes Node-Projekt in [`backend/`](backend)
mit eigener Beschreibung, eigenen Tests und seiner Schnittstelle als Scalar-Referenz auf der
Startseite. Für den ausgelieferten Stand (`dist/` hinter nginx) gibt es diese Weiterleitung
noch nicht: Dort fallen die drei Registerangaben an die antragstellende Person.

Der Dev-Server lauscht auf allen Netzwerkschnittstellen und nimmt jeden Hostnamen an
(`server.host` und `server.allowedHosts` in `vite.config.ts`), weil er hinter einem
TLS-Proxy läuft. Mit einem Token in `.env` kann damit jeder, der den Rechner im Netz
erreicht, über `/ionos` die freigegebenen Modelle auf Kosten des Kontos aufrufen. Ein Token
gehört deshalb nur in einen Dev-Server in einem vertrauenswürdigen Netz oder hinter einem
Zugangsschutz.

## Tests

`npm test` führt die TypeScript-Tests mit dem Test-Runner von Node aus (`node --test`). Sie brauchen
weder Netz noch Browser. Die KI wird durch einen Ersatz ersetzt, der Antworten vorgibt.

| Ordner | Gegenstand |
|---|---|
| `test/zuordnung/` | Ziele, Personenabgleich, Platzierung, Status |
| `test/gruppierung/` | Monatsschnitt, Reihen, Typkorrektur, Gruppierung mit Ersatz-KI |
| `test/ocr/`, `test/pdf/` | Seiten lesen und bereinigen, Dateiart und Maße |
| `test/ionos/` | Client: Fehler, Wiederholung, Zeitlimit, Modellsuche |
| `test/profil/` | das Wohngeld-Profil gegen seine Schemata und den Katalog; Regeln ändern, Entwürfe |
| `test/engine/` | Ablauf von Anfang bis Ende, Manifest |
| `test/fim/`, `test/paket/` | Verweise im Antrag; das Antragspaket: Dateien je Dokument, keine Seite verloren, Manifest mit Dateien |
| `test/oneproof/` | OneProof Format: Schemas, Prüfung beim Einlesen, Pointer, Ziele, Einstein in beiden Formaten, `antrag.json` im Paket, Profil 2026-11-15, Anlegen und Veröffentlichen auf der Seite der Fachabteilung |
| `test/pruefen/` | Steuerung und Anzeigetexte der Seite; die Beispielfälle lassen sich laden und lesen |
| `test/sachbearbeitung/` | Profilverwaltung: Anzeige und Auswahl, Entwurf und Basisversion, Versionsnamen, Paket (ZIP) |
| `test/vite/` | der KI-Zugang des Servers |

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/scenario.ts` | Der Fall des Dummys: Anforderungen, die Register, die dafür gefragt werden, hinterlegte Prüfergebnisse |
| `src/noots.ts` | Der Registerabruf des Dummys über den NOOTS-Mock |
| `backend/` | Der NOOTS-Mock: SAK-DC Consumer-API v3 und JSON-Fassade, Express und TypeScript, Daten als JSON |
| `src/App.tsx` | Die Seite des Dummys |
| `src/status.ts`, `src/components/`, `src/browser.ts` | Zustände, Bausteine und Zugriffe auf den Browser (JSON laden, Datei speichern, Speicher), die die Seiten teilen |
| `src/pruefen/` | Die Nachweisprüfung: Eingabe, Fortschritt, Ergebnis, Fehler |
| `src/sachbearbeitung/` | Die Profilverwaltung: Angaben und Auswahl, Entwurf, Prüfmeldungen, Veröffentlichen als Paket |
| `src/engine/`, `src/pdf/` | Die Engine, siehe oben |
| `src/index.css` | Tailwind für Layout, KERN für alles andere — in dieser Reihenfolge |
| `pruefen.html`, `sachbearbeitung.html` | Einstieg der Nachweisprüfung und der Profilverwaltung |
| `public/profile/` | Prüfprofile (Antragsarten, Schemata, Nachweisregeln) |
| `public/beispiele/` | Beispielfälle je Profil, mit `index.json` als Verzeichnis |
| `public/konfiguration.json` | Modelle und Parallelität |
| `vite/` | KI-Zugang des Servers und PDF.js-Ressourcen |
| `tsconfig.json` | Strenge Typprüfung für `src/`, `test/` und `vite/` (`npm run typecheck`) |
| `docs/pruefprofile.md` | Wie Profile aufgebaut sind und wie eine neue Leistung dazukommt |
