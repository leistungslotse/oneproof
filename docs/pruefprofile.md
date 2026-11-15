# Prüfprofile

Ein **Prüfprofil** sagt der Engine alles, was sie über eine Leistung wissen muss: welche
Anträge sie liest, an welchen Stellen des Antrags Nachweise hingehören, welche Unterlagen
für welche Aussage genügen und wie gut. Die Engine selbst kennt weder Wohngeld noch ein
FIM-Schema noch einen Dokumenttyp. Eine weitere Leistung ist deshalb **ein weiterer Ordner,
kein weiterer Code**.

Die Frage „Reicht bei der Miete eine Mietbescheinigung, ein Kontoauszug oder ein
Mietvertrag?“ wird im Profil beantwortet: je Antragsart an jeder Stelle des Antrags, an der ein
Nachweis hochgeladen werden kann, in den **Bedingungen** dieser Stelle (siehe
[Format 2](#format-2-bedingungen-je-antragsart)). Die Fachabteilung stellt das nicht in der
JSON-Datei ein, sondern auf der Seite `/sachbearbeitung.html` (siehe
[Profile pflegen](#profile-pflegen-die-seite-der-fachabteilung)).

## Ablage

```
public/profile/
├── index.json                     welche Profile es gibt und welche Version aktuell ist
└── wohngeld/
    └── 2026-11-07/                eine Version des Profils
        ├── profil.json            Antragsarten mit Stellen und Bedingungen, Personen
        ├── dokumenttypen.json     Katalog der Dokumenttypen (auch Anweisung an die KI)
        ├── schema/                das FIM-Schema je Antragsart, in kompakter Form; bei einer
        │                          Antragsart im OneProof Format ihr JSON Schema mit dem Rahmen
        └── abbildung/             Zuordnung alter Feld-IDs auf neue, je älterer Version
```

Die Version 2026-11-15 von Wohngeld hat neben den sechs FIM-Antragsarten eine siebte im
[OneProof Format](oneproof-format.md) (`oneproof:wohngeld`).

`public/profile/index.json`:

```json
{
  "profile": [
    { "id": "wohngeld", "name": "Wohngeld", "aktuell": "2026-11-15", "versionen": ["2026-11-07", "2026-11-15"] }
  ]
}
```

Die Prüfseite lädt standardmäßig das Profil `wohngeld`. Mit `?profil=<id>` oder
`?profil=<id>@<version>` lässt sich ein anderes oder ein älteres Profil wählen, etwa
`/pruefen.html?profil=wohngeld@2026-11-07`.

**Profile sind versioniert.** Jedes Ergebnis nennt die Version, gegen die es geprüft wurde
(`wohngeld@2026-11-07`, im Manifest als `profilVersion`). Wer ein Profil ändert, legt einen
neuen Versionsordner an und trägt ihn in `index.json` ein. So bleibt ein früheres Ergebnis
nachvollziehbar. Die Seite der Fachabteilung erzeugt beides als Paket zum Einspielen.

## Format 2: Bedingungen je Antragsart

`profil.json` gibt es in zwei Formaten. **Format 1** (`"format": 1`, die Version 2026-11-07 von
Wohngeld) hat eine Tabelle `nachweisarten` für alle Antragsarten und eine Liste `stellen`, die
darauf zeigt (beides unten beschrieben). **Format 2** (`"format": 2`) ordnet alles der
Antragsart zu: Jede Antragsart führt jede Stelle ihres FIM-Schemas, an der ein Nachweis
hochgeladen werden kann (jedes Datenfeld vom Typ Datei), und jede Stelle hat eine oder mehrere
Bedingungen. Eine Bedingung sagt, wann sie gilt und welche Unterlagen dann genügen.

Eine Antragsart kann statt mit einem FIM-Schema auch im **OneProof Format** beschrieben sein
(`"format": "oneproof"`). Ihre Positionen und Felder sind dann Pointer-Muster wie
`/fachdaten/personen/*/einkommen/eintraege/*`, die Personen und den Stichtag legt das Format
fest. Alles andere, Bedingungen, Rollen und Zeiträume, gilt gleich. Die Besonderheiten stehen
in [docs/oneproof-format.md](oneproof-format.md#im-prüfprofil).

Die Engine liest beide Formate. Format 2 übersetzt sie beim Laden in dieselbe Form wie Format 1
(`uebersetze` in `src/engine/profil/bedingungen.ts`). Die Seite der Fachabteilung speichert
jede neue Version in Format 2. Öffnet sie eine Version in Format 1, stellt sie sie um
(`ausFormat1` in `src/engine/profil/umstellung.ts`); entschieden wird danach wie vorher.

```json
{
  "format": 2,
  "id": "wohngeld",
  "version": "2026-11-08",
  "name": "Wohngeld",
  "dokumenttypen": "dokumenttypen.json",
  "personen": { "antragsteller": { … }, "mitglieder": { … } },
  "stichtag": "F01000002044",
  "antragsarten": [
    {
      "schema": "S01000000123",
      "version": "1.7.0",
      "name": "Wohngeld – Mietzuschuss, Erstantrag",
      "datei": "schema/S01000000123V1.7.0.json",
      "stellen": [
        {
          "id": "miete",
          "position": "G01000001422/F00000000567",
          "titel": "Höhe der Miete",
          "bereich": "Wohnen",
          "herkunft": { "art": "profil" },
          "nennt": { "feld": "F00000000560", "ja": ["001", "002", "004", "999"], "nein": ["003"] },
          "nurFrage": true,
          "bedingungen": [
            {
              "id": "miete",
              "status": "festgelegt",
              "nachweise": {
                "rent_contract": "genuegt",
                "bank_statement": "pruefen",
                "utility_statement": "ergaenzt"
              },
              "hinweis": "Ihr Mietvertrag oder eine Bescheinigung Ihres Vermieters."
            }
          ]
        }
      ]
    }
  ]
}
```

**Eine Stelle** hat:

| Feld | Bedeutung |
|---|---|
| `id` | eindeutig in der Antragsart |
| `position` | Gruppe und Feld des Datei-Felds im Schema (`G…/F…`, auf oberster Ebene `/F…`) |
| `titel`, `bereich` | Anzeige; `bereich` gruppiert die Stellen auf der Seite |
| `herkunft` | woher die Bedingung stammt, siehe unten |
| `nennt`, `nurFrage`, `auffang`, `einmal`, `aussage`, `merkmale` | wie bei `stellen` in Format 1 |
| `unterscheiden` | eine Frage (Feld-ID) oder `je-frage`: Die Stelle hat je Antwort eine eigene Bedingung |
| `ohne` | der Grund, warum hier bewusst kein Nachweis verlangt wird; die Stelle hat dann keine Bedingung |
| `bedingungen` | mindestens eine, außer bei `ohne` |

**Eine Bedingung** hat:

| Feld | Bedeutung |
|---|---|
| `id` | eindeutig in der Antragsart; bei `unterscheiden` `<stelle>:<code>` |
| `titel`, `wenn` | nur bei `unterscheiden`: die Antwort und die Frage, für die sie gilt |
| `art` | optional: Bedingungen mit gleicher `art` und gleicher Einstellung sind eine Aussage (dieselbe Miete an zwei Stellen) |
| `status` | `festgelegt`; `vorschlag` (aus dem Katalog vorgeschlagen, gilt so); `offen` (noch nicht entschieden) |
| `nachweise` | Dokumenttyp → Rolle (`genuegt`, `pruefen`, `ergaenzt`), oder `{ "rolle", "merkmale", "ersatzweise": { "bedingung", "rolle" } }` |
| `zeitraum` | `{ "mindestens", "hoechstensAlt", "fuer", "beispiel" }`, wie `abdeckung` in Format 1 |
| `hinweis` | der Text für Antragstellende |

Es zählt nur, was eine Bedingung nennt. Ein Dokumenttyp, den sie nicht nennt, zählt dort nicht;
einen Standard aus dem Katalog gibt es nicht. Eine Bedingung ohne Nachweise verlangt
nichts: Eine offene Bedingung hält also niemanden auf. `ersatzweise` ist `groebere` aus
Format 1: Ein Darlehensvertrag ohne Darlehen im Antrag zählt bei der Belastung.

**Herkunft der Bedingung.** Wann eine Stelle einen Nachweis verlangt, liest die Seite aus dem
Schema, in dieser Reihenfolge:

1. **Aus einer Regel** (`regel`): Eine Regel des Schemas nennt das Datei-Feld und eine Frage mit
   Antwortcodes. Daraus wird `nennt`.
2. **Regel nicht verstanden** (`regelFremd`): Eine Regel nennt das Feld, aber nicht in einer
   Form, die sich auswerten lässt. Die Stelle folgt dann dem Aufbau wie in 3 und 4; der
   Wortlaut der Regel steht auf der Seite.
3. **Aus dem Abschnitt** (`abschnitt`): Der Abschnitt mit dem Feld ist optional oder
   wiederholbar. Der Nachweis gilt, wenn der Antrag den Abschnitt enthält.
4. **Immer** (`immer`): sonst, wann immer der Antrag die Stelle enthält.

`profil` heißt: aus dem bisherigen Profil übernommen, bei der Umstellung aus Format 1.

Eine Antragsart im OneProof Format hat keine Regeln in Worten und keine Datei-Felder. Ihre Stellen
kommen aus einer Ja/Nein-Frage (`frage`: ein Abschnitt mit `vorhanden` oder ein einzelnes
Ja/Nein-Feld, das `feld` nennt; der Nachweis gilt bei „ja“), aus einer Liste ohne solche Frage
(`abschnitt`: jeder Eintrag verlangt einen Nachweis) oder vom Profil (`profil`). Die Seite zeigt
`frage` als „Aus der Ja/Nein-Frage“.

**Anbindung.** `personen` und `stichtag` stehen beim Profil. Eine Antragsart, deren Schema
andere Gruppen oder Felder hat, trägt eigene (`antragsarten[].personen`,
`antragsarten[].stichtag`). `abbildungen` und `abbildungKorrekturen` stehen wie in Format 1 bei
der Antragsart.

## Welcher Nachweis genügt für welche Aussage: `nachweisarten`

> Format 1. In Format 2 steht das in den Bedingungen der Stellen (siehe oben). Die Rollen, das
> Merkmal, der Zeitraum und `groebere` gelten dort genauso.

Eine **Nachweisart** ist eine Art von Aussage, die ein Nachweis belegen kann („Höhe der
Miete“, „Einkommen“, „Schwerbehinderung“). Zu jeder Nachweisart steht in `quellen`, welche
Dokumenttypen sie belegen und mit welcher **Rolle**. `titel` und `hinweis` gehören zur
Anzeige: Der `hinweis` steht an der Angabe, solange sie nicht belegt ist.

```json
"miete_hoehe": {
  "titel": "Mietnachweis",
  "hinweis": "Ihr Mietvertrag oder eine Bescheinigung Ihres Vermieters. Ein Kontoauszug oder Zahlungsnachweis kann genügen, wenn die Höhe der Miete daraus hervorgeht.",
  "quellen": {
    "rent_contract":        "genuegt",
    "rent_certificate":     "genuegt",
    "rent_payment_proof":   "pruefen",
    "bank_statement":       "pruefen",
    "utility_statement":    "ergaenzt",
    "heating_statement":    "ergaenzt",
    "parking_service_proof":"ergaenzt"
  }
}
```

| Rolle | Bedeutung | Folge für den Status der Angabe |
|---|---|---|
| `genuegt` | Der Nachweis genügt für sich allein. | `belegt` — sofern die Person im Antrag vorkommt und ein geforderter Zeitraum abgedeckt ist |
| `pruefen` | Der Nachweis kann genügen, ob der Inhalt passt, lässt sich aber nicht automatisch feststellen. | `unklar`, mit dem Hinweis, die Unterlage zu prüfen |
| `ergaenzt` | Der Nachweis stützt die Aussage, genügt allein aber nicht. | `offen`, mit dem Hinweis, dass nur ergänzende Unterlagen vorliegen |

Im Beispiel genügt also ein Mietvertrag oder eine Mietbescheinigung. Ein Mietzahlungsnachweis
oder Kontoauszug führt zu `unklar`, eine Nebenkostenabrechnung allein bleibt `offen`. Mit
denselben Rollen lässt sich jede andere Aussage einstellen: Wer will,
dass bei der Miete auch der Kontoauszug genügt, ändert `"pruefen"` in `"genuegt"`. Wer
ihn dort nicht gelten lassen will, löscht die Zeile.

**Es zählt nur, was dasteht.** Ein Dokumenttyp, der unter `quellen` steht, gilt genau so, wie
er dort steht, mit den Merkmalen und der gröberen Art, die dort stehen. Einer, der bei keiner
Nachweisart steht, belegt nichts. Der Katalog (siehe
[Die Dokumenttypen](#die-dokumenttypen-dokumenttypenjson)) beschreibt nur, woran ein Dokument
zu erkennen ist. Welche Angabe es für eine Leistung belegt, sagt allein das Profil.

Die Prüfseite zeigt diese Regeln dem Nutzer an jeder offenen Angabe unter „Welche Unterlagen
genügen?“, nach Rollen gruppiert. Die Anzeige liest sie aus dem Profil, es gibt keine
zweite Liste.

### Mehr als eine Rolle: Quellen mit Angaben

Statt der Rolle als Text kann eine Quelle ein Objekt sein:

```json
"rent_change_notice": { "rolle": "genuegt", "groebere": { "art": "miete_hoehe", "rolle": "pruefen" } }
```

| Feld | Bedeutung |
|---|---|
| `rolle` | wie oben |
| `groebere` | Eine gröbere Nachweisart, an die das Dokument kommt, wo der Antrag die genaue Aussage nicht macht. Ein Mieterhöhungsschreiben belegt die Veränderung der Miete. Nennt der Antrag keine Veränderung, kommt es zur Höhe der Miete. Als Text (`"groebere": "belastung"`) zählt es dort nur als `ergaenzt`: Dass der Antrag die gröbere Aussage macht, heißt nicht, dass das Dokument sie belegt. Als Objekt `{ "art": …, "rolle": … }` legt das Profil die Rolle dort selbst fest. |
| `merkmale` | Merkmale, die das Dokument für diese Verwendung mitbringt (siehe unten). Beim Einkommen zählt ein Unterhaltszahlungsnachweis nur an einer Einkommenszeile „Unterhalt“: `{ "rolle": "genuegt", "merkmale": { "income_type": "alimony" } }` |

Ein Dokumenttyp darf unter mehreren Nachweisarten stehen, jeweils mit eigener Rolle. Der
Kontoauszug steht bei der Miete und beim gezahlten Unterhalt als `pruefen`.

### Zeitraum: `abdeckung`

Manche Aussagen brauchen mehrere Monate, etwa das Einkommen:

```json
"abdeckung": { "einheit": "monat", "mindestens": 3, "fuer": ["payslip"], "hoechstensAlt": 6, "beispiel": true }
```

Genügen als Nachweis nur Dokumente der Typen in `fuer` (Abrechnungen, die je einen Monat
belegen), müssen mindestens `mindestens` verschiedene Monate vorliegen. Sonst wird die
Angabe `unklar` mit dem Hinweis „2 von 3 Monaten liegen vor. Es fehlt noch ein Monat.“ Ein
Dokument, das den Zeitraum selbst bescheinigt (Verdienstbescheinigung, Rentenbescheid),
löst die Prüfung auf Monate nicht aus.

`hoechstensAlt` (optional) begrenzt das Alter: Ein Monat, der mehr als so viele Monate vor
dem Stichtag liegt, zählt nicht. Drei Abrechnungen aus 2019 sagen nichts über das Einkommen
heute. Der Hinweis nennt dann die Monate, die nicht zählen („3 Abrechnungen sind älter als 6
Monate (01.2019, 02.2019, 03.2019), gerechnet ab dem 13.08.2026, und zählen nicht.“), und die
Angabe bittet um aktuelle Abrechnungen. Der Stichtag ist das Datum des Antrags (siehe
[`stichtag`](#stichtag-antragslage-und-bekanntoffen)), ohne ein solches der Tag der Prüfung.

`"beispiel": true` ist eine Markierung für Menschen und wird nicht ausgewertet. Sie sagt:
Der Wert ist ein Beispielwert für die Vorführung. Wie viele Monate die zuständige Behörde
verlangt, ist mit ihr abzustimmen und im Profil anzupassen.

## Wo im Antrag Nachweise hingehören: `stellen`

> Format 1. In Format 2 hat jede Antragsart ihre eigenen Stellen; die Felder unten gelten dort
> genauso.

Eine **Stelle** ist ein Ort im Antrag, an dem ein Nachweis steht oder stehen kann. Bei
Wohngeld ist es jeweils ein Datei-Feld des FIM-Schemas.

```json
{
  "id": "mitbewohner",
  "art": "mitbewohner",
  "position": ["G00000000326/F60000000296", "G00000001547/F60000000296"],
  "bereich": "Wohnen",
  "titel": "Mitbewohner oder Untermiete",
  "aussage": "{F60000000228} {F60000000227}",
  "nennt": { "feld": "F00000002597", "ja": ["002"], "nein": ["001"], "spaeter": ["003"] }
}
```

| Feld | Bedeutung |
|---|---|
| `id` | Eindeutiger Name der Stelle. Doppelte IDs meldet die Validierung als Fehler. |
| `art` | Die Nachweisart, die hier gilt. Sie muss unter `nachweisarten` stehen. |
| `position` | Das Datei-Feld im Schema: Gruppen-ID und Feld-ID, durch `/` getrennt. Eine Liste, wenn mehrere Felder dieselbe Stelle sind. Die Position muss es in einem Schema des Profils geben. |
| `bereich` | Überschrift, unter der die Angabe in der Anzeige erscheint |
| `titel` | Name der Angabe |
| `aussage` | Satz, der zeigt, was der Antrag hier sagt. Platzhalter wie `{F00000000240\|eur}` werden mit den Werten des Antrags gefüllt (siehe Formate). Fehlt ein Wert, entfällt der ganze Satz. |
| `nennt` | Wann der Antrag die Aussage überhaupt macht (siehe unten) |
| `nurFrage` | `true`: Nur die Frage aus `nennt` entscheidet. Sonst gilt eine optionale Gruppe, die im Antrag vorhanden ist, schon als Aussage. Die „Angaben zur Miete“ gibt es aber bei Mietern wie bei Bewohnern eines Heims, die Frage nach dem Mietverhältnis trennt beide. |
| `einmal` | `true`: eine Angabe für den ganzen Haushalt, auch wenn das Schema je Person fragt (Kinderbetreuungskosten). Sie steht bei der ersten Person, die die Frage mit „ja“ beantwortet, und nimmt Unterlagen jeder Person an. Nur wenn niemand „ja“ sagt, zählt ein „nein“, und dann einmal. |
| `hinweis` | Text an der offenen Angabe anstelle des `hinweis` der Nachweisart. Für Stellen, an denen andere Unterlagen gefragt sind als sonst bei dieser Art, etwa der Heimvertrag bei der Miete. |
| `auffang` | `true`: Die Stelle gibt es auch dann, wenn der Antrag die Aussage nicht macht. So geht ein Schwerbehindertennachweis nicht verloren, nur weil der Antrag keine Schwerbehinderung nennt. |
| `merkmale` | Angaben im Antrag, die zum Nachweis passen müssen |

**`nennt`.** Entweder `"immer"`: Der Antragstyp selbst macht die Aussage (die Miete bei einem
Mietzuschuss). Oder ein Objekt mit dem Feld einer Frage im Antrag und den Antwortcodes, die
„ja“, „nein“ und „später“ bedeuten. Beantwortet der Antrag die Frage mit **nein**, hat die
Angabe den Status `entfaellt` („Im Antrag haben Sie die Frage … mit „Nein“ beantwortet.
Deshalb ist hier kein Nachweis nötig.“). Bei **später** bleibt die Angabe ohne Nachweis
`unklar`, bis die Frage beantwortet ist. Mit `"gefuellt": true` statt der Codes gilt die
Frage als „ja“, sobald das Feld einen Wert hat.

`nennt` kann auch eine **Liste von Fragen** sein. Sie gelten als „oder“: Ein „ja“ genügt,
eine offene Antwort („später“) hält die Angabe offen, und erst „nein“ ohne ein einziges „ja“
lässt sie entfallen. Die Begründung nennt dann alle verneinten Fragen. Eine Frage, die es in
einer Antragsart nicht gibt, zählt als unbeantwortet. So dient eine Liste mehreren
Antragsarten, die dasselbe in verschiedenen Feldern fragen (die Mitbewohner im Miet- und im
Lastenzuschuss).

**Formate in `aussage`:**

| Platzhalter | Ergebnis |
|---|---|
| `{F…}` | der Wert, wie er im Antrag steht |
| `{F…\|eur}` | als Betrag, `950,00 €` |
| `{F…\|code}` | der Klartext zu einem Code aus dem Schema |
| `{F…\|tabelle:name}` | der Kurzname aus der Wertetabelle `name` |

**`merkmale`.** Beschreiben, was ein Nachweis mitbringen muss, damit er an diese Stelle
passt. So steht es bei der Stelle „Einkommen“ im Profil von Wohngeld:

```json
"merkmale": [
  { "name": "income_type", "feld": "F00000000574", "tabelle": "einkommensart" },
  { "name": "betrag",      "feld": "F00000000575", "als": "cent" }
]
```

`feld` ist das Feld im Antrag, dessen Wert das Merkmal bestimmt. `tabelle` übersetzt den Code
aus dem Antrag über eine Wertetabelle in Dokumenttypen („Lohn / Gehalt“ wird `salary`). Mit
`"als": "cent"` wird ein Betrag als ganze Cent bereitgestellt. Ein Dokument mit einem anderen
Merkmal wird dieser Stelle nicht zugeordnet. Was nur eine Seite kennt, schränkt nie ein:
Fehlendes Wissen gilt nicht als Widerspruch.

## Die Dokumenttypen: `dokumenttypen.json`

Der Katalog ist zugleich die Anweisung an das Sprachmodell, das die Seiten zu Dokumenten
gruppiert. Jeder Typ hat einen Schlüssel (`rent_contract`) und:

| Feld | Bedeutung |
|---|---|
| `label` | Name in der Anzeige („Mietvertrag“) |
| `description` | Woran das Modell den Typ erkennt und wovon es ihn abgrenzen soll |
| `fields` | Was aus dem Dokument gelesen werden soll. Ein Feld `monat` heißt: Das Dokument belegt je einen Monat (die Seite schlägt es für den Zeitraum vor). |
| `confusions` | Regeln gegen Verwechslung zweier Typen anhand des Textes: Nennt ein Dokument vom Typ A eines der Wörter in `requires` und keines aus `unless`, ist es in Wahrheit Typ B. Das Modell würfelt nicht, wo der Text die Frage beantwortet. Die Wörter gelten als Teilzeichenkette, auch im Kompositum, ohne Groß- und Kleinschreibung und mit aufgelösten Umlauten (`ae`, `oe`, `ue`, `ss`); ein Zeilenumbruch oder mehrere Leerzeichen im Text zählen als ein Leerzeichen, ein Stichwort aus mehreren Wörtern trifft also auch über einen Zeilenumbruch. Ein Leerzeichen vor dem Wort verlangt den Wortanfang (`" kita"` trifft „Kita-Beitrag“, nicht „Nikita“). Jede Gegenprobe (`unless`) braucht ein Stichwort, das nichts anderes trifft: „miete“ trifft auch „Vermieter“. |
| `match_against` | Felder des Antrags, mit denen ein Dokument dieses Typs besonders abzugleichen wäre (in der ursprünglichen Engine die des Wohngeldantrags) |
| `extract`, `transaction_fields` | nur beim Kontoauszug: Statt fester Felder werden alle Buchungen gelesen (`extract: "transactions"`), je Buchung die Felder aus `transaction_fields` |

Diese Engine liest vom Katalog `label`, `description` und `confusions`, von `fields` nur, ob ein
Feld `monat` vorkommt. `match_against`, `extract` und `transaction_fields` stammen aus dem
Katalog der ursprünglichen Engine und stehen noch darin; ausgewertet werden sie hier nicht.

Der Katalog gilt für jede Leistung gleich: Er beschreibt Dokumente, nicht die Angaben eines
Antrags. Welche Nachweisart ein Typ belegt, mit welchen Merkmalen (die Lohnabrechnung
`income_type: salary`) und ersatzweise für welche gröbere Art, steht im Profil: in Format 1
unter `nachweisarten[...].quellen`, in Format 2 in den Bedingungen. Beim Anlegen einer
Antragsart schlägt die Seite Typen nach ihrem `label` vor. Ältere Kataloge führten dafür
`fim`, `fim_merkmale` und `fim_fallback`. Die Engine liest diese Felder nicht mehr, die
Validierung warnt, wenn ein Katalog sie noch enthält.

Typen, die das Profil nennt und der Katalog nicht kennt, bleiben nutzbar, werden aber mit
ihrem Schlüssel angezeigt und von der Validierung gemeldet.

## Personen und Wertetabellen

`personen` sagt, wo im Antrag die Namen stehen, damit die Engine die Person auf einem
Dokument mit den Personen im Antrag vergleichen kann:

```json
"antragsteller": {
  "gruppe": "G01000001213",
  "name": { "pfad": ["G01000001428"], "nachname": "F60000000227", "vorname": "F60000000228", "geburtsname": "F60000000230" },
  "bezeichnung": "antragstellende Person"
}
```

`geburtsname` ist optional. Ein Dokument auf den Geburtsnamen, etwa eine ältere
Bescheinigung, gehört trotzdem zur Person: Das Sprachmodell bekommt den Geburtsnamen mit, und
der Abgleich kennt ihn. Der Abgleich sieht außerdem über Titel und Grade, die Reihenfolge von
Vor- und Nachname, einen abgekürzten Vornamen („C. Schmidt“) und Umlaut-Schreibweisen
(„Mueller“) hinweg.

Lautet ein Dokument auf eine Person, die im Antrag nicht vorkommt, bleibt die Angabe
`unklar`: „Die Unterlage lautet auf …. Diese Person kommt im Antrag nicht vor.“

**Personen außerhalb des Haushalts.** Jede weitere Gruppe des Antrags, die einen Namen in
denselben Feldern trägt, ist der Engine bekannt: Mitbewohner, ein verstorbenes
Haushaltsmitglied, Unterhaltsempfänger, eine Vertretung. Ein Dokument auf eine solche Person
gehört an die Stelle bei ihrem Eintrag. An jeder anderen Stelle bleibt die Angabe `unklar`
(„Diese Person nennt der Antrag, aber nicht zu dieser Angabe.“), denn der Mietvertrag des
Mitbewohners belegt nicht die Miete des Haushalts.

`wertetabellen` übersetzen Codes des Antrags in Kurznamen und Dokumenttypen
(`"002": { "kurz": "Lohn / Gehalt", "typen": ["salary"] }`). Sie werden von `aussage` und
`merkmale` benutzt.

## Stichtag, Antragslage und bekanntOffen

**`stichtag`** nennt das Feld, das den Antrag datiert. Bei Wohngeld ist das der
Erstellungszeitpunkt der Nachricht (`"stichtag": "F01000002044"`, im Antrag etwa
„13.08.2026 09:09:46“; ISO-Daten werden ebenso gelesen). Ab diesem Tag rechnet
`hoechstensAlt`. Ein Antrag, der im August gestellt und im November geprüft wird, verliert so
keine Abrechnung, die zum Antrag aktuell war. Fehlt das Feld oder steht dort kein Datum,
zählt der Tag der Prüfung. Die Ergebnisseite nennt den Stichtag unter „Angaben zur Prüfung“.

**`antragslage`** sind Sätze mit Platzhaltern wie in `aussage`. Sie sagen dem Sprachmodell,
in welcher Lage der Antragsteller ist:

```json
"antragslage": [
  "Mietverhältnis der antragstellenden Person: {F00000000560|code}",
  "Eigentumsform: {F01000002199|code}"
]
```

Ein Untermietvertrag sieht für Untermieter und Untervermieter gleich aus. Erst die
Antragslage sagt dem Modell die Richtung. Sätze, deren Werte der Antrag nicht hat, entfallen.
Die Sätze gehen an IONOS. Was dort hineinkommt, muss deshalb auch im Hinweis zum Datenschutz
auf der Eingabeseite stehen.

**`bekanntOffen`** nennt Datei-Felder der Schemata, die bewusst keine Stelle haben, jeweils
mit dem Grund:

```json
"bekanntOffen": {
  "/F01000002054": "Der hochgeladene Antrag selbst (Upload OD), kein Nachweis.",
  "G00000001512/F60000000296": "Aufforderung einer Behörde zur Beantragung von Wohngeld: Für dieses Schreiben führt der Katalog keinen Dokumenttyp."
}
```

Die Validierung warnt bei jedem Nachweisfeld, das weder eine Stelle hat noch hier steht. So
fällt ein neues Datei-Feld einer neuen Schemaversion auf, statt still verloren zu gehen. Ein
Feld direkt unter der Wurzel des Antrags hat eine leere Gruppe (`/F01000002054`).

## Schema und Abbildung

`schema/<Schema-ID>V<Version>.json` ist das FIM-Schema in kompakter Form: ein Baum aus
Gruppen und Feldern mit Namen, Fragetexten und Codelisten. Die Engine liest daraus, wo die
Datei-Felder sind und welche Frage ein Feld stellt. Eine Antragsart steht in `profil.json` unter `antragsarten`:

```json
{
  "schema": "S01000000123",
  "version": "1.7.0",
  "name": "Wohngeld – Mietzuschuss, Erstantrag",
  "datei": "schema/S01000000123V1.7.0.json",
  "abbildungen": { "1.6.1": "abbildung/S01000000123_1.6.1_nach_1.7.0.json" }
}
```

`abbildungen` macht ältere Anträge lesbar: Liegt eine Antragsdatei in Version 1.6.1 vor,
werden ihre Feld-IDs mit dieser Datei auf die von 1.7.0 abgebildet. Die Prüfseite
weist darauf hin („Die Antragsdaten liegen in Version 1.6.1 vor und wurden mit der Abbildung
des Herausgebers in Version 1.7.0 gelesen.“). Gibt es für eine Version keine Abbildung,
bricht die Prüfung mit einer Meldung ab, die die unterstützten Versionen nennt.

Die Datei des Herausgebers bleibt unverändert. Wo sie falsch oder unvollständig ist,
korrigiert das Profil sie je Antragsart und Version, und die Korrektur hat Vorrang:

```json
"abbildungKorrekturen": { "1.6.1": { "F00000001827": "F60000000352" } }
```

Ändert eine neue Version nicht nur IDs, sondern auch die **Codes** einer Liste, übersetzt
`werteAbbildungen` (oben im Profil) die Werte, nach Version und neuer Feld-ID:

```json
"werteAbbildungen": { "1.6.1": { "F60000000352": { "01": "001", "02": "002" } } }
```

**OneProof Format.** Eine Antragsart mit `"format": "oneproof"` nennt unter `datei` das JSON
Schema ihrer Leistung (`schema/wohngeld-1.0.schema.json`). Die Schemas, auf die es verweist,
liegen daneben (`schema/rahmen-1.0.schema.json`); die Engine findet sie über ihre URN. Die
kompakte Form, die Engine und Seite der Fachabteilung lesen, entsteht beim Laden
(`kompaktesSchema` in `src/engine/oneproof/schema.ts`). Ältere Versionen und Abbildungen gibt
es im OneProof Format nicht.

Ein bekannter Rest: Die Abbildung des Herausgebers bildet das Sterbedatum `F00000000074`
(1.6.1, ein Datumsfeld) auf `G60000000100` ab, in 1.7.0 eine Gruppe „Sterbedatum
(teilbekannt)“ mit Tag, Monat und Jahr. Im umgesetzten Antrag steht dann ein Wert, wo eine
Gruppe stehen müsste. Die Engine liest das Sterbedatum nicht, nur den Namen der verstorbenen
Person. Deshalb gibt es dafür keine Korrektur. Wer das Datum einmal braucht, muss es in
Anträgen der Version 1.6.1 eigens lesen.

## Profile pflegen: die Seite der Fachabteilung

Unter `/sachbearbeitung.html` („Nachweisprofile verwalten“) legt die Fachabteilung je Antragsart
fest, welche Unterlagen an welcher Stelle des Antrags genügen, ohne eine JSON-Datei anzufassen.
Die Seite ist getrennt von der Prüfseite und hat keinen Code für Wohngeld: Alles, was sie zeigt,
kommt aus dem Profil und den FIM-Schemata. Ein Profil erscheint dort, sobald es in
`public/profile/index.json` steht oder als neues Profil im Browser angelegt ist
(`?profil=<id>` oder `?profil=<id>@<version>` wählt es direkt an, `#<stelle>` eine Stelle).

**Aufbau.** Oben stehen Profil und Antragsart, der Stand des Entwurfs und die Aktionen. Darunter
zeigt der Fortschritt, wie viele Bedingungen festgelegt sind; die Filter „Offen“, „Vorschlag“,
„Festgelegt“ und „Geändert“ engen die Liste ein. Links stehen die Stellen der Antragsart, nach
Bereich und in der Reihenfolge des Schemas, die Stellen ohne Nachweis gesondert. Rechts steht die
gewählte Stelle:

- **Gilt, wenn**: die Bedingung aus dem Schema mit ihrer Herkunft (1 bis 4, bei einer
  Antragsart im OneProof Format „Aus der Ja/Nein-Frage“, oder „Aus dem bisherigen Profil“), bei
  Regeln mit dem Wortlaut.
- **Eigene Bedingung je …**: Eine Stelle lässt sich nach den Antworten einer Frage ihres
  Abschnitts aufteilen, etwa das Einkommen je Einkommensart. Jede Antwort bekommt eine eigene
  Bedingung, zunächst als Vorschlag mit der bisherigen Einstellung. Wer wieder zu einer
  Bedingung zusammenlegt, bekommt sie festgelegt nur, wenn alle gleich und festgelegt waren.
- **Die Bedingungen**, jede mit „Gilt, wenn“, ihren Nachweisen und ihrem Stand. Geöffnet zeigt
  eine Bedingung:
  - alle Dokumenttypen des Katalogs mit „Genügt“, „Kann genügen“, „Ergänzt nur“ oder „Nicht
    zugelassen“; die vorgesehenen oben, die übrigen unter „Weitere Nachweisarten“, mit Suche;
  - den **Zeitraum**: wie viele Monate mindestens, wie alt höchstens, und welche Unterlagen je
    einen Monat belegen (`fuer`). Geprüft wird er nur, wenn alle Unterlagen, die genügen, je
    einen Monat belegen. Eine Unterlage, die einen Zeitraum selbst bescheinigt, genügt ohne ihn;
  - den **Hinweis** für Antragstellende und eine **Vorschau**, wie sie ihn sehen;
  - „Vorschlag übernehmen“ oder „So festlegen“, „Auf Version … zurücksetzen“ und „Übernehmen
    von“, das die Einstellung derselben Stelle einer anderen Antragsart oder einer anderen
    Bedingung der Stelle kopiert. Jede Änderung legt die Bedingung fest.
- **Hier keinen Nachweis verlangen**: mit einem Grund (`ohne`), rückgängig mit „Doch Nachweise
  verlangen“.

**Entwurf, Prüfung, Veröffentlichen.** Die Seite kann nicht auf den Server schreiben. Deshalb
arbeitet sie in zwei Schritten:

1. Änderungen liegen als **Entwurf im Browser** (`localStorage`, ein Entwurf je Profil). Der
   erste Eingriff, der etwas ändert, legt ihn an. Er merkt sich die Version, auf der er
   aufbaut, und überlebt das Neuladen. „Entwurf verwerfen“ löscht ihn und zeigt wieder die
   veröffentlichte Version. Ein neues Profil gibt es bis zur ersten Version nur als Entwurf;
   eingelesene Schemata und der Katalog stehen mit darin.
2. **„Entwurf ausprobieren“** öffnet die Prüfseite mit dem Entwurf
   (`/pruefen.html?profil=<id>&entwurf`). Ein Hinweis oben sagt, dass sie mit einem Entwurf läuft
   und woraus er gemacht ist. So lässt sich eine Änderung an einem echten Antrag mit echten
   Nachweisen testen, bevor jemand anderes sie sieht.
3. Im Hintergrund prüft die Seite den Entwurf mit derselben Validierung wie oben
   (`validiereProfil`). Solange sie Fehler findet, lässt sich nichts veröffentlichen.
4. **„Neue Version veröffentlichen“** erzeugt ein Paket (`<id>-<version>.zip`): den
   vollständigen Ordner der neuen Version und die fortgeschriebene `index.json`. Die Version ist
   ein Datum, vorbelegt mit dem heutigen Tag, oder mit dem Tag nach der neuesten Version, wenn
   es schon eine von heute oder später gibt. Eine vorhandene Version lässt sich nicht
   überschreiben. Der Dialog zählt auf, was sich geändert hat, nach Antragsart, nennt offene
   Bedingungen und sagt, wenn die Version das Format von 1 auf 2 umstellt. Für ein neues Profil
   trägt das Paket das Profil in `index.json` ein.
5. Das Paket entpacken, `profile/` in den Ordner `public/` kopieren, bauen und ausliefern.
   Frühere Versionen bleiben unverändert, ein
   Ergebnis, das gegen sie geprüft wurde, bleibt nachvollziehbar.

Ist inzwischen eine neuere Version des Profils veröffentlicht worden, öffnet die Seite den
Entwurf trotzdem auf seiner Basis und weist darauf hin, dass ihm die Änderungen der neueren
Version fehlen. Kennt sie die Basis des Entwurfs nicht mehr, öffnet sie die veröffentlichte
Version, weist auf den alten Entwurf hin und ersetzt ihn, sobald jemand etwas ändert.

**Was die Seite nicht ist.** Sie ersetzt keine Freigabe. Ein Entwurf liegt nur in dem Browser,
in dem er entstand, und zwei Personen, die zugleich ändern, merken davon nichts. Und sie ist
keine Zugangsbeschränkung: Die Profile sind öffentlich auslieferbare JSON-Dateien, und wer die
Seite kennt, kann sie aufrufen und einen Entwurf anlegen. Verändern kann er damit nichts, denn
was er herunterlädt, muss erst jemand einspielen. Wer die Seite nur der Fachabteilung zeigen
will, schützt sie am Webserver. Eine echte Freigabe, ein Verlauf und
mehrere Bearbeiter brauchen eine Serverkomponente, die es hier nicht gibt.

## Eine weitere Antragsart anlegen

Auf der Seite der Fachabteilung mit „Antragsart aus Schemadatei anlegen“, in drei Schritten:

1. **Schema auswählen.** Das Profil wählen, zu dem die Antragsart gehört, oder „Neues Profil
   anlegen …“ mit einem Namen (daraus entsteht die Kennung). Dann die XDF-Datei des
   Stammdatenschemas, wie sie das FIM-Portal ausliefert (XDF3 oder XDF2), oder das JSON Schema
   einer Leistung im OneProof Format (`wohngeld-1.0.schema.json`; den Rahmen holt die Seite aus
   `/format/oneproof/`). Die Seite liest die Datei im Browser und zeigt, was sie gefunden hat: die
   Nachweisfelder, die Stellen, wie viele Regeln sie auswerten konnte und woher die Bedingungen
   kommen. Die Regeln, die sie nicht auswerten konnte, stehen darunter, mit dem Hinweis, ob sie
   einen Nachweis betreffen. Im OneProof Format kommt jede Stelle aus einem Abschnitt mit
   Ja/Nein-Frage (`vorhanden`) oder aus einer Liste von Einträgen.
2. **Technische Anbindung bestätigen.** Welche Gruppe die antragstellende Person ist, welche die
   Haushaltsmitglieder (jeweils mit den Namensfeldern) und welches Feld den Stichtag trägt. Die
   Seite schlägt das nach den Namen im Schema vor; eine Anbindung des Profils, die zum Schema
   passt, bleibt. Im OneProof Format entfällt der Schritt: Die Personen stehen unter `personen`,
   der Stichtag ist `antragstellung.zeitpunkt`.
3. **Antragsmodell erzeugen.** Legt die Antragsart im Entwurf an. Jede Stelle bekommt eine
   Bedingung: einen Vorschlag aus dem Katalog (Dokumenttypen, deren Name zum Titel der Stelle
   passt, als „Kann genügen“) oder eine offene. Danach geht es mit „Bedingungen festlegen“ zur
   Antragsart.

Wird ein Schema erneut eingelesen, etwa in einer neuen Version, ersetzt es die Antragsart. Was
an Stellen festgelegt ist, die es weiterhin gibt, bleibt. Im OneProof Format bleiben auch die
Stellen, die das Profil an einzelnen Werten setzt (die Höhe der Miete) oder an derselben
Position zweimal führt (Vollmacht und Betreuungsurkunde), solange es den Wert im Schema gibt.
Beim Veröffentlichen kommen die Schemas, auf die ein JSON Schema verweist, mit in den
Versionsordner. Ein neues Profil übernimmt den Katalog
der Dokumenttypen des Profils, das gerade geöffnet ist.

Von Hand bleibt: einen Dokumenttyp, den der Katalog nicht kennt, in `dokumenttypen.json`
ergänzen; für ältere Schemaversionen eine Abbildung nach `abbildung/` legen; Beispielfälle unter
`public/beispiele/<id>/` ablegen (`index.json` listet sie:
`{"beispiele": [{"id", "titel", "beschreibung", "antrag", "nachweise"}]}`, die Pfade relativ zum
Ordner; dann erscheint auf der Prüfseite „Beispiel laden“); und `aktenzeichenPraefix` setzen,
die zwei Buchstaben vor dem Aktenzeichen der simulierten Einreichung (sonst die ersten zwei
Buchstaben der `id`).

### Validierung

`validiereProfil` (`src/engine/profil/validieren.ts`) prüft ein Profil gegen seine Schemata
und seinen Katalog und liefert `fehler` und `warnungen`. Ein Profil in Format 2 prüft sie je
Antragsart gegen deren Schema. Fehler sind dort außerdem: eine Stelle ohne Bedingung (außer mit
`ohne`, das einen Grund braucht); eine doppelte ID einer Stelle oder Bedingung; ein unbekannter
`status`; eine Bedingung einer aufgeteilten Stelle ohne die Frage, nach der sie gilt; ein
`ersatzweise`, das auf eine Bedingung zeigt, die es nicht gibt. Sonst gilt:

- **Fehler** machen das Profil unbrauchbar: eine fehlende Schemadatei; eine Position, die es
  im Schema nicht gibt; eine unbekannte Rolle, auch bei `groebere`; eine `art` ohne Eintrag
  in `nachweisarten`; eine doppelte Stellen-ID; ein `nennt` ohne Feld; eine `groebere`-Art
  oder eine Wertetabelle, die es nicht gibt; ein Personenfeld oder ein `stichtag`, das in
  keinem Schema steht; eine Korrektur der Abbildung, die auf kein Element des Schemas zielt;
  eine `abdeckung` mit einer anderen Einheit als `monat`, mit einem `mindestens` oder
  `hoechstensAlt`, das keine ganze Zahl ab 1 ist, oder ohne Liste unter `fuer`.
- **Warnungen** zeigen Wahrscheinliches, aber Unschädliches: eine Feld-ID in `nennt`,
  `aussage`, `merkmale` oder `antragslage`, die in keinem Schema steht; ein Antwortcode, den
  die Frage nicht kennt; eine Antragsart, die keine der Fragen aus `nennt` hat; ein
  Dokumenttyp, der nicht im Katalog steht; ein Nachweisfeld ohne Stelle, das nicht unter
  `bekanntOffen` steht, und umgekehrt ein Eintrag dort, der eine Stelle hat oder den es nicht
  gibt; eine Werteabbildung auf ein unbekanntes Feld oder einen unbekannten Wert; ein Katalog,
  der bei einem Dokumenttyp noch `fim`, `fim_merkmale` oder `fim_fallback` führt.

Bei einer Antragsart im OneProof Format ist jede Angabe unter `personen` und `fachdaten` eine
mögliche Position. Ein Nachweisfeld ohne Stelle gibt es dort nicht, die Warnung dazu entfällt.
Dafür warnt die Validierung bei einem Typ des Katalogs, den die Dokumentarten des Schemas
(`/anlagen/*/dokumentart`) nicht kennen: Eine Anlage dieses Typs stünde im Antragspaket ohne
Dokumentart.

Der Test `test/profil/profil.test.ts` führt die Validierung für das Profil `wohngeld` in der
Version 2026-11-07 aus und verlangt null Fehler und null Warnungen. Er prüft außerdem, dass
jeder Eintrag in `index.json` auf einen vorhandenen Profilordner zeigt und dass **jede** dort
genannte Version, auch eine von der Fachabteilung veröffentlichte, ohne Fehler validiert.
`test/profil/katalog.test.ts` verlangt von jedem Katalog jeder Version, dass er keine Nachweisart
nennt, und vom Katalog der aktuellen Version, dass er Begriffe des Wohngelds wie „WoGG“ oder
„Wohngeldbehörde“ nur beim Wohngeldbescheid selbst verwendet. Ein
weiteres Profil bekommt für die Warnungen einen eigenen Konsistenztest nach demselben Muster:

```bash
npm test
```

## Fachliche Entscheidungen im Profil Wohngeld

**Unterhalt, den der Haushalt zahlt** (Nachweisart `unterhalt`). Nach
[§ 18 WoGG](https://www.gesetze-im-internet.de/wogg/__18.html) mindern Unterhaltszahlungen
das Einkommen, höchstens um gesetzlich festgelegte Beträge. Liegt ein Unterhaltstitel, eine
notariell beurkundete Unterhaltsvereinbarung oder ein Bescheid vor, gilt der dort
festgelegte Betrag als Grenze. Der Titel bestimmt also, bis zu welcher Höhe abgezogen wird.
Dass gezahlt wird, belegt er nicht, und ohne Titel zählen die nachgewiesenen Zahlungen. Daraus
folgen die Rollen:

| Dokumenttyp | Rolle | Warum |
|---|---|---|
| `maintenance_payment_proof` | `genuegt` | belegt die Zahlung |
| `bank_statement` | `pruefen` | kann die Zahlung zeigen; ob die Überweisung Unterhalt ist, steht im Inhalt |
| `maintenance_title` | `ergaenzt` | bestimmt die Obergrenze, belegt aber keine Zahlung |

Der `hinweis` der Nachweisart bittet trotzdem um einen vorhandenen Titel, weil er die Höhe
des Abzugs bestimmt. Eine Regel „Titel ist Pflicht“ gibt es bewusst nicht. Sie würde Haushalte,
die ohne Titel zahlen, zu Unrecht auf `offen` setzen.

**Aktualität des Einkommens.** Drei Monatsabrechnungen, keine älter als sechs Monate ab dem
Datum des Antrags, sind ein Beispielwert (`"beispiel": true`), keine Vorgabe des Gesetzes.
Was die Wohngeldbehörde verlangt, ist mit ihr abzustimmen.

## Grenzen

- Die Prüfung stellt fest, **was belegt ist, nicht ob ein Anspruch besteht**. Die Engine
  entscheidet nichts in der Sache.
- Passt ein Dokument an mehrere Angaben gleich gut, etwa eine Verdienstbescheinigung ohne
  erkennbare Person bei zwei Einkommen, steht es vorläufig bei der ersten. Belegen kann es
  dort nichts: Die Angabe, an der nur dieses Dokument liegt, und jede andere, zu der es
  ebenso passt und an der sonst nichts liegt, sind `unklar`, bis ein Mensch entscheidet.
- **Beträge** aus dem Antrag werden nicht mit den Beträgen auf den Dokumenten verglichen.
  Das Merkmal `"als": "cent"` ist vorbereitet, die Dokumente liefern aber noch keinen Betrag
  zum Vergleich.
- Der **Zeitraum** (`abdeckung`) kennt nur die Einheit Monat.
- Eine Regel, die die Seite nicht auswerten kann, legt die Fachabteilung selbst aus: Bis sie
  die Stelle aufteilt oder `ohne` setzt, folgt die Stelle dem Aufbau des Schemas.
- Die **Pflege der Profile** geschieht im Browser und endet in einem Paket zum Einspielen.
  Freigabe, Verlauf und mehrere Bearbeiter gibt es nicht (siehe
  [Profile pflegen](#profile-pflegen-die-seite-der-fachabteilung)).
- Welche Unterlagen die zuständige Behörde wirklich anerkennt und wie viele Monate sie
  verlangt, steht im Beispielprofil von Wohngeld als Annahme. Das ist vor einem echten
  Einsatz mit der Behörde abzustimmen.
