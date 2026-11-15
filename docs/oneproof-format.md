# OneProof Format

Das OneProof Format beschreibt Antragsdaten als JSON. OneProof liest es **neben FIM**, nicht
an seiner Stelle: Eine Antragsart im Profil ist entweder eine FIM-Antragsart (XDF-Schema,
Antrag als XML) oder eine Antragsart im OneProof Format (JSON Schema, Antrag als JSON). Die
Prüfseite erkennt am Inhalt der Datei, welches Format kommt. Ermittlung der Ziele, Zuordnung,
Status, Manifest und Antragspaket arbeiten mit beiden Formaten gleich.

Hervorgegangen ist das Format aus dem LeistungsLotse-Antragsformat Wohngeld 1.0. Was sich
dabei geändert hat, steht [unten](#gegenüber-dem-leistungslotse-antragsformat-10).

## Warum ein zweites Format

- **Ein Nachweis zeigt auf die Angabe, die er belegt.** FIM kennt nur Felder vom Datentyp
  „Datei“ an festen Orten. Im OneProof Format hat jede Angabe eine Adresse, einen JSON-Pointer
  wie `/fachdaten/mietzuschuss/miete`. Eine Anlage nennt unter `bezuege` die Angaben, die sie
  belegt.
- **Ob eine Angabe gemacht ist, steht in den Daten.** Eine Ja/Nein-Frage ist ein Abschnitt mit
  `vorhanden` oder ein einzelnes Feld, jeweils `true`, `false` oder nicht angegeben (noch
  offen). Bei FIM muss OneProof das aus Regeln in Worten herauslesen.
- **Dieselben Dokumentarten wie OneProof.** Die Dokumentarten sind die Codes des Katalogs
  (`dokumenttypen.json`). Die Einkommensarten sind es nicht: Sie stehen als Liste im Schema
  (`$defs/Einkommensart`), und das Profil übersetzt sie in `wertetabellen.einkommensart_oneproof`
  in die Einkommensart, die ein Dokument mitbringt.
- **Neutral gegenüber Leistungen.** Der Rahmen ist für jede Leistung gleich, die Fachdaten
  legt das Schema einer Leistung fest. OneProof setzt nur die Regeln des Rahmens voraus (unten),
  nie eine bestimmte Leistung. Ein weiteres Schema, das diese Regeln einhält, braucht keinen
  neuen Code.

## Dateien

```
public/format/oneproof/
├── rahmen-1.0.schema.json      der Rahmen, für jede Leistung gleich
├── wohngeld-1.0.schema.json    die Fachdaten Wohngeld, bindet den Rahmen ein
└── wohngeld-1.0.beispiel.json  ein gültiger Antrag (erfundene Daten)
```

Die Schemas folgen JSON Schema Draft 2020-12 und nennen sich mit einer URN:
`urn:oneproof:format:<name>:<version>`, etwa `urn:oneproof:format:wohngeld:1.0`. Die Datei zu
einer URN heißt `<name>-<version>.schema.json` und liegt neben dem Schema, das auf sie
verweist. So findet die Engine den Rahmen im Ordner einer Profilversion und die Seite der
Fachabteilung unter `/format/oneproof/`.

## Aufbau eines Antrags

| Angabe | Inhalt |
|---|---|
| `standard` | immer `"oneproof-format"`. Daran erkennt die Engine das Format. |
| `version` | Version des Schemas der Leistung, `"1.0"` |
| `nachricht` | Kennung, Typ und Zeitpunkt der Nachricht, der absendende Dienst |
| `leistung.art` | die Leistung, `"wohngeld"`. Daraus wird die Antragsart `oneproof:wohngeld`. |
| `antragstellung.zeitpunkt` | wann der Antrag gestellt wurde; der Stichtag der Prüfung |
| `personen` | alle Personen des Antrags mit Kennung (`id`), Rolle und Name. Genau eine hat die Rolle `antragsteller`. |
| `fachdaten` | die Angaben der Leistung, festgelegt vom Schema der Leistung |
| `anlagen` | die Dateien zum Antrag: höchstens ein Antragsdokument (`zweck: antragsdokument`) und die Nachweise (`zweck: nachweis`) mit Dokumentart, Person, Bezügen und Prüfsumme |
| `erweiterungen` | Angaben eines Absenders, die das Format nicht kennt; OneProof liest sie nicht |

Eine Anlage:

```json
{
  "dateiname": "lohnabrechnung-september-2026.pdf",
  "zweck": "nachweis",
  "dokumentart": "payslip",
  "person": "p1",
  "bezuege": [{ "stelle": "/fachdaten/personen/0/einkommen/eintraege/0" }],
  "mimeType": "application/pdf",
  "hashwert": { "algorithmus": "sha512", "wert": "…" }
}
```

## Regeln für die Fachdaten einer Leistung

Auf diese Regeln baut OneProof. Ein Schema, das sie einhält, lässt sich ohne neuen Code lesen
und auf der Seite der Fachabteilung als Antragsart anlegen.

1. **Eine Ja/Nein-Frage ist ein Abschnitt mit `vorhanden`** (boolean). Bei `false` stehen im
   Abschnitt keine weiteren Angaben. Mehrere gleichartige Angaben stehen in der Liste
   `eintraege` des Abschnitts. Ein einzelnes Ja/Nein-Feld ohne Abschnitt ist ebenfalls erlaubt
   (`nsVerfolgt`); die Stelle dazu legt dann das Profil fest, die Seite der Fachabteilung leitet
   sie beim Anlegen nicht ab.
2. **Auf Personen wird über ihre Kennung verwiesen**, mit `$ref` auf `Personenverweis` des
   Rahmens. Ein Eintrag, der eine Person des Antrags betrifft, nennt sie unter dem Namen
   `person`. Nur daran erkennt OneProof, wessen Angabe es ist, und prüft, dass ihre Nachweise
   nicht auf eine andere Person zeigen. Andere Verweise wie `kind` beim Kindergeld ordnen den
   Eintrag niemandem zu. Eine Liste, die je Person höchstens einen Eintrag hat, trägt
   `"x-eindeutig": "person"` (bei Wohngeld `fachdaten.personen`) und nennt die Person
   ebenfalls unter `person`.
3. **Ein Code hat immer eine Bezeichnung**: `oneOf` aus `{ "const": …, "title": … }`. Die
   Bezeichnung zeigt OneProof in Sätzen und auf der Seite der Fachabteilung.
4. **Namen weiterer Personen** stehen getrennt in `vorname` und `familienname` (oder
   `organisation`), wie im Rahmen (`PersonOderStelle`). Nur so lassen sie sich mit dem Namen
   auf einem Dokument abgleichen.
5. Jede Angabe hat einen `title`. Daraus entstehen Pfade und Fragen auf den Seiten.

## Prüfung beim Einlesen

Ein Antrag wird nur gelesen, wenn er gültig ist (`src/engine/oneproof/pruefung.ts`). Vor dem
Schema kommen zwei Grenzen, damit eine übergroße Datei die Seite nicht lahmlegt:

- Eine Liste, für die das Schema eine Obergrenze nennt (etwa die Bezüge einer Anlage), wird
  gezählt, bevor das Schema angewandt wird. Ist sie zu lang, meldet die Prüfung nur das („Die
  Liste hat mehr als 200 Einträge.“) und prüft die Datei nicht weiter.
- Die Angaben dürfen höchstens 64 Ebenen tief verschachtelt sein. Wo die erlaubte Tiefe endet,
  steht der Fehler.

Danach folgt die Prüfung gegen das Schema der Leistung mit dem Rahmen (Ajv, Draft 2020-12,
strikt) und zuletzt die Regeln, die ein JSON Schema nicht ausdrücken kann:

- jede Kennung einer Person gibt es nur einmal;
- jeder Verweis auf eine Person trifft eine Person des Antrags;
- eine Liste mit `x-eindeutig: person` hat je Person höchstens einen Eintrag;
- jeder Dateiname einer Anlage kommt nur einmal vor;
- jeder Bezug einer Anlage trifft eine Angabe des Antrags;
- eine Anlage mit `person` bezieht sich nicht auf die Angaben einer anderen Person.

Die Fehler nennen die Stelle als Pointer und den Grund auf Deutsch, etwa
„/personen/0: Die Angabe „name“ fehlt.“ Die ersten fünf stehen in der Meldung der Prüfseite.

## Im Prüfprofil

Eine Antragsart im OneProof Format sieht in `profil.json` (Format 2) so aus:

```json
{
  "schema": "oneproof:wohngeld",
  "format": "oneproof",
  "version": "1.0",
  "name": "Wohngeld – Miet- und Lastenzuschuss, OneProof Format",
  "datei": "schema/wohngeld-1.0.schema.json",
  "stichtag": "/antragstellung/zeitpunkt",
  "antragslage": ["Wohnverhältnis der antragstellenden Person: {/fachdaten/wohnraum/wohnverhaeltnis|code}"],
  "stellen": [ … ]
}
```

- `datei` ist das Schema der Leistung; der Rahmen liegt daneben (`schema/rahmen-1.0.schema.json`).
- Die Personen nennt das Format selbst. Die Antragsart braucht keine Anbindung wie bei FIM.
- **Positionen und Felder sind Pointer-Muster**: `*` steht für jeden Eintrag einer Liste.
  `/fachdaten/personen/*/einkommen/eintraege/*` ist jedes Einkommen jeder Person. Ein Feld in
  `nennt`, `aussage` oder `merkmale` wird an die Stelle gebunden, an der der Nachweis steht:
  Beim Einkommen der zweiten Person liest `{/fachdaten/personen/*/einkommen/eintraege/*/betrag|eur}`
  den Betrag dieses Eintrags.
- `herkunft: { "art": "frage", "feld": "…/vorhanden" }`: Die Stelle kommt aus einer Ja/Nein-Frage
  (Regel 1), `feld` nennt sie: den Abschnitt mit `vorhanden` oder ein einzelnes Ja/Nein-Feld.
  Daneben gibt es `abschnitt` (eine Liste ohne Frage) und `profil` (von Hand gesetzt).
- `"ja": ["*"]` in `nennt` heißt: jede Antwort außer denen unter `nein`. So verlangt das
  Wohngeld-Profil einen Aufenthaltstitel bei jeder Staatsangehörigkeit außerhalb von EU, EWR
  und Schweiz.
- Ein Merkmal mit festem Wert (`{ "name": "aufwendungsart", "wert": "001" }` bei den Erbbauzinsen) unterscheidet
  Stellen, die das Format als eigene Angaben führt, FIM aber als Code einer Liste.

Wo eine Angabe fehlt, gehört ein Nachweis zum nächsten Wert darüber, den es gibt: Werbungskosten
einer Person ohne `werbungskostenJahr` gehören zu `/fachdaten/personen/1/einkommen`, eine
Person ohne Eintrag in `fachdaten.personen` zu `/personen/1`. Personen werden nicht nummeriert
wie Zeilen einer Liste. Die Angabe heißt „Aufenthaltstitel · Jonas Beispiel“, nicht „Zeile 2“.

## Im Antragspaket

Kommt der Antrag im OneProof Format, enthält das Antragspaket `antrag.json` statt
`antrag.xml` (`src/engine/oneproof/anlagen.ts`):

- Die Angaben bleiben inhaltlich, wie sie hochgeladen wurden. Neu geschrieben werden die
  `anlagen`; der Rest wird gelesen und neu ausgegeben (`JSON.parse`, `JSON.stringify(…, null, 2)`).
  Dabei ändern sich Einrückung und Zahlenschreibweise (`110.0` wird `110`), Schlüssel aus lauter
  Ziffern stehen aufsteigend vorn, und Zahlen, die ein JSON-Parser nicht genau darstellt, werden
  auf seine Genauigkeit gerundet: Zahlen mit mehr als 15 gültigen Stellen verlieren Stellen,
  `1e400` wird `null`, `-0` wird `0`. Am ehesten fällt das in `erweiterungen` auf, wo das Schema
  nichts vorgibt.
  Die Anlagen des hochgeladenen Antrags werden ersetzt, auch das Antragsdokument des
  absendenden Dienstes: Sie beschreiben die Dateien, wie der Dienst sie geschickt hat, nicht
  die Dateien des Pakets. `inhalt.txt` nennt sie.
- Jede Datei des Pakets ist eine Anlage mit `zweck: nachweis`. Dazu kommen der SHA-512 der
  Datei im Paket (`hashwert`) und die Dokumentart, wenn das Schema sie kennt. Die Person steht dabei, wenn alle
  Bezüge zu ihr passen. Die Dokumentarten des Wohngeld-Schemas (`$defs/Dokumentart`) sind die
  81 Typen des Katalogs mit ihren Bezeichnungen. Kennt das Schema einen Typ des Katalogs
  nicht, warnt die Validierung des Profils (`docs/pruefprofile.md`).
- `bezuege` nennt jede Angabe, bei der die Prüfung das Dokument abgelegt hat. Das sind die
  Angaben, die der Antrag macht, und die Stellen, die das Profil als `auffang` führt: Ein
  Schwerbehindertenausweis bei `behinderung.vorhanden: false` verweist auf
  `/fachdaten/personen/1/behinderung`, damit er nicht verloren geht. Eine Sterbeurkunde
  verweist auf den Eintrag des Verstorbenen unter `todesfall`, auch wenn er nicht zum Haushalt
  gehört. Eine Anlage ohne Bezug bleibt, wo der Antrag keine passende Angabe macht (eine
  Sterbeurkunde ohne Todesfall), das Profil für die Unterlage keine Stelle kennt (eine
  Schulbescheinigung) oder sie auf eine Person lautet, die der Antrag nirgends nennt. Damit
  fällt keine Datei aus dem Antrag heraus.
- Das Ergebnis wird erneut gegen das Schema geprüft. Ein Paket, dessen Antrag der Empfänger
  ablehnen müsste, entsteht nicht.

Im **Manifest** hat jeder Eintrag zusätzlich `stelle`, den Pointer der Angabe im Antrag. Über
`stelle` und den Dateinamen lassen sich Manifest und `antrag.json` maschinell zusammenführen,
soweit das Manifest die Angabe führt (belegt, offen, unklar). Drei Unterschiede bleiben:

- Ein Bezug auf eine Angabe, die der Antrag verneint (`entfaellt`, der Schwerbehindertenausweis
  oben), steht nur in `antrag.json`. Das Manifest führt diese Angabe nicht.
- Ein Dokument, das auf eine Person lautet, die der Antrag nirgends nennt, steht im Manifest als
  Beleg der Angabe. In `antrag.json` ist es eine Anlage ohne Bezug, wie bei FIM ohne Verweis.
- `hash` am Beleg im Manifest ist der SHA-512 der hochgeladenen Datei, `hashwert` an der
  Anlage der SHA-512 der Datei im Paket. Beide unterscheiden sich, wenn die Prüfung Seiten
  zusammengesetzt oder ein Bild in PDF umgewandelt hat.

## Unterschiede zu FIM im Wohngeld-Profil

Der Beispielfall „Familie Einstein“ liegt in beiden Formaten vor
(`public/beispiele/wohngeld/antrag-einstein-wohngeld-1.7.0.xml` und
`antrag-einstein-wohngeld-oneproof.json`). Ablauf und Art der Prüfung sind gleich, und die
Anforderungen stimmen nach Art, Status und Belegtyp überein (`test/oneproof/einstein.test.ts`).
Zahl und Wortlaut der Angaben unterscheiden sich: Mit der Ersatz-KI der Tests hat der Fall als
FIM-Instanz 19 Angaben, im OneProof Format 18. Wo sie sich unterscheiden, sagen die Formate
dasselbe anders:

| Angabe | FIM | OneProof Format |
|---|---|---|
| Vermögen, Unterhalt, einmalige Einnahmen, Einkommensänderung, Verpflichtungserklärung | je Person gefragt | einmal für den Haushalt; die Person steht am Eintrag |
| Werbungskosten | eine Ja/Nein-Frage mit Nachweisfeld; der Betrag steht im Monat („1.230,00 € im Monat“) | der Betrag `werbungskostenJahr` je Person unter `einkommen`, im Jahr („14.760,00 € im Jahr“); ein Nachweis wird verlangt, wenn er angegeben ist |
| Wortlaut einer Angabe | der Kurzname aus der Wertetabelle des Profils („Lohn / Gehalt“) | der Titel des Codes im Schema („Gehalt oder Lohn“) |
| Miet- und Lastenzuschuss | sechs Schemas (je Zuschuss Erst-, Weiterleistungs-, Erhöhungsantrag) | ein Schema; der Lastenzuschuss steht unter `fachdaten.lastenzuschuss`. Die Wohnfläche wird nur verlangt, wenn `eigentumsform` angegeben ist. |
| ältere Versionen | 1.6.1 wird auf 1.7.0 abgebildet | gibt es nicht |

## Gegenüber dem LeistungsLotse-Antragsformat 1.0

- **Name und Aufbau.** Das Format heißt OneProof Format (`standard: "oneproof-format"`). Das
  eine Schema ist in Rahmen und Wohngeld geteilt. `version` ist die Version des Schemas der
  Leistung.
- **Bezüge** dürfen nur auf Angaben unter `personen` und `fachdaten` zeigen, nicht etwa auf
  `/nachricht/autor`.
- **Genau eine antragstellende Person** legt das Schema fest (`contains` mit `minContains` und
  `maxContains`), statt es nur zu beschreiben.
- **Das Antragsdokument** hat keine Dokumentart und keine Bezüge und kommt höchstens einmal vor.
- **Dokumentarten.** Die Liste folgt dem überarbeiteten Katalog: 81 statt 76 Codes, mit den
  Bezeichnungen des Katalogs.
- **Wohnverhältnis und Zuschuss sind gekoppelt.** Eine Eigentümerin bekommt Lastenzuschuss,
  außer im eigenen Haus mit mehr als zwei Wohnungen; dann Mietzuschuss wie zur Miete. Bei
  `wohnverhaeltnis: owner` ist `eigentumMitMehrAlsZweiWohnungen` deshalb Pflicht, bei jedem
  anderen Wohnverhältnis nicht erlaubt. So ist für jedes Wohnverhältnis klar, welcher Zuschuss
  gilt.
- **Vertretung.** Neu ist der Abschnitt `fachdaten.antrag.vertretung` mit Art
  (gesetzliche Vertretung oder Bevollmächtigung) und Vertreter. Daran hängen Vollmacht und
  Betreuungsurkunde.
- **Namen in Teilen** bei Verstorbenen, betreuenden Personen, Kindergeldempfängern, dem
  anderen Elternteil, Vermietern, der verpflichteten Person einer Verpflichtungserklärung und
  dem Geber eines Zuschusses (`zuschussgeber`). Vermieter und Zuschussgeber können eine Person
  oder eine Stelle sein (`PersonOderStelle`).
- **Einkommensart bei Einkommensänderungen** ist ein Code der Liste `Einkommensart`, kein
  Freitext.
- **Anlagen einer Person** zeigen nicht auf Angaben einer anderen. Das prüft OneProof beim
  Einlesen (oben).

## Grenzen

- Ein Schema gibt es bisher nur für Wohngeld.
- Beim Anlegen aus dem JSON Schema leitet die Seite der Fachabteilung Stellen nur aus
  Abschnitten mit Ja/Nein-Frage und aus Listen ab. Stellen an einzelnen Werten (die Höhe der
  Miete, die Wohnfläche) setzt das Profil. Beim erneuten Einlesen bleiben sie erhalten, solange
  es den Wert im Schema gibt.
