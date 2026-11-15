# NOOTS-Mock

Stellt einen Nachweisabruf über das NOOTS nach, damit ein Online-Dienst ihn ohne Anschluss entwickeln und vorführen kann.
Alle Personen, Behörden, Register und Nachweise sind erfunden und liegen als JSON unter [`data/`](data).

Node.js 24, Express 5, TypeScript.

```bash
npm install
npm run dev      # http://localhost:8787, startet bei Änderungen in src/ und data/ neu
```

Die Startseite ist die Schnittstellenbeschreibung ([`openapi.yaml`](openapi.yaml)) als Scalar-Referenz. Jeder Aufruf lässt sich dort mit **Test Request** an den Mock schicken, zu jedem Ausgang liegt ein Beispiel bereit.

| Adresse           | Inhalt                                               |
| ----------------- | ---------------------------------------------------- |
| `/`               | Referenz mit Beispielen zum Abschicken               |
| `/sakdc/api/v3/…` | Consumer-API des SAK-DC für den nationalen Abruf     |
| `/dca/v1/…`       | JSON-Fassade im Zuschnitt des Data Consumer Adapters |
| `/mock/persons`   | Personen aus `data/persons`                          |
| `/health`         | Lebenszeichen                                        |

## Beispieldaten

```
data/
  evidence-types.json    Nachweistypen, ihr Register und der Data Provider
  jurisdiction.json      Zuständigkeitsparameter (Regionalschlüssel) und bekannte Werte
  persons/*.json         je Person eine Datei: wer sie ist und was die Register zu ihr führen
```

Eine neue Person ist eine neue Datei in `data/persons/`:

```json
{
  "givenName": "Tom",
  "familyName": "Neumann",
  "dateOfBirth": "1979-12-24",
  "evidence": {
    "residenceCertificate": {
      "address": { "street": "Birkenallee 3", "postalCode": "12503", "city": "Auenthal" },
      "movedIn": "2024-02-01"
    }
  }
}
```

- Die Schlüssel unter `evidence` sind die `key`-Werte aus `evidence-types.json`. Was darunter steht, ist frei und wird zum Inhalt des Nachweises.
- `"ambiguous": true` lässt das Register mit Fehler `0402` antworten.
- Ein Nachweistyp mit `"provider": null` steht für ein Register, das nicht angeschlossen ist.
- Die Dateien werden beim Start gelesen und geprüft. Passt eine nicht, startet der Mock nicht und nennt Datei und Feld.

## Woran sich der Mock hält

**SAK-DC Consumer-API v3.** Das BVA veröffentlicht OpenAPI, Fehlerkatalog und XNachweis-Beispiele unter [`noots/public/ad-noots/sak-apis`](https://gitlab.opencode.de/noots/public/ad-noots/sak-apis) (EUPL-1.2). Der Mock bildet daraus den nationalen Abruf nach: `POST /token`, `GET /de/jurisdiction-parameters/{evidence-type}`, `POST /de/jurisdiction`, `POST /de/evidence`, mit `traceparent`-Pflicht, Bearer-Token, Problemtypen (`urn:noots:…`, RFC 9457) und XNachweis-2-Nachrichten.

**DCA.** Für den Data Consumer Adapter der FITKO ist keine Schnittstelle veröffentlicht, nur [Folien](https://docs.fitko.de/fit/assets/pdf/fit-ab_dokumente/28sitzung/TOP8_DCA_NOOTS.pdf) mit Prinzipien und Angaben. `/dca/v1` ist deshalb eine eigene Annahme: ein JSON-Aufruf, der die SAK-Schritte je Nachweistyp ausführt.

## Ein Abruf

```bash
curl -s http://localhost:8787/dca/v1/evidence-requests -H 'content-type: application/json' -d '{
  "dataConsumer": {"name": "Wohngeldstelle Auenthal", "componentId": "550e8400-e29b-41d4-a716-446655440000"},
  "administrativeService": {"id": "99107023000000", "name": "Wohngeld beantragen"},
  "legalBasis": "WoGG § 23",
  "consent": true,
  "subject": {"givenName": "Nora", "familyName": "Feldmann", "dateOfBirth": "1994-03-14"},
  "evidence": [{"evidenceType": "residenceCertificate"}, {"evidenceType": "incomeTaxAssessment"}, {"evidenceType": "childBenefitNotice"}]
}'
```

Die drei Schritte an der SAK-API stehen in der Referenz unter „SAK-DC“.

## Fälle

| Auslöser                                              | Ergebnis                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Person mit dem Nachweis in `data/persons`             | `delivered`                                                      |
| Person mit `"ambiguous": true` (Alex Doppelt)         | HTTP 200, XNachweis-Fehler `0402`, `ambiguous`                   |
| unbekannte Person, oder Person ohne diesen Nachweis   | HTTP 200, XNachweis-Fehler `0403`, `not_found`                   |
| Vertrauensniveau unter dem des Nachweistyps           | HTTP 200, XNachweis-Fehler `0305`, `level_of_assurance_too_low`  |
| Nachweistyp ohne Data Provider (`childBenefitNotice`) | `404 urn:noots:no_data_provider.found`, `registry_not_connected` |
| `x-mock-scenario: registry-unreachable`               | `502 urn:noots:badgateway.unreachable`, `registry_unreachable`   |
| `x-mock-scenario: timeout`                            | `504 urn:noots:gatewaytimeout`, `registry_unreachable`           |

## Aufbau

```
src/
  server.ts        Start: Konfiguration, Register laden, lauschen, sauber herunterfahren
  app.ts           Express-App: Middleware, Routen, Fehlerbehandlung
  config.ts        Umgebungsvariablen
  registry/        JSON-Dateien lesen und prüfen
  sak/             SAK-DC Consumer-API: Router und Logik
  dca/             JSON-Fassade: Router, Eingabeprüfung und Logik
  xnachweis/       XNachweis-Nachrichten bauen und lesen
  shared/          Tokens, Problemtypen
```

| Befehl                                                               | Zweck                                         |
| -------------------------------------------------------------------- | --------------------------------------------- |
| `npm run dev`                                                        | Entwicklung, Node führt TypeScript direkt aus |
| `npm test`                                                           | Tests (`node:test`)                           |
| `npm run check`                                                      | Typen, Linter, Formatierung, Tests            |
| `npm run build`, `npm start`                                         | nach `dist/` übersetzen und starten           |
| `docker build -t noots-mock . && docker run -p 8787:8787 noots-mock` | als Container                                 |

| Variable    | Standard | Zweck                        |
| ----------- | -------- | ---------------------------- |
| `PORT`      | `8787`   | Port                         |
| `DATA_DIR`  | `./data` | Ordner mit den Beispieldaten |
| `LOG_LEVEL` | `info`   | `silent` bis `trace`         |

## Grenzen

- Das Anfragetoken wird gelesen, sein Siegel nicht geprüft. Kein mTLS, kein Teilnehmerzertifikat.
- `use_idnr` muss `false` sein. Die SAK-API verlangt das derzeit selbst.
- Nur der nationale Abruf, keine EU-Pfade, kein erneuter Abruf bei fachlich asynchroner Lieferung.
- Die Nachweise selbst sind frei erfundene Formate (`sample:…`), keine Fachstandards wie XPersonenstand oder XMeld.
- Die IDs für Geburtsurkunde und Meldebescheinigung sind die Beispiel-IDs aus dem NOOTS-Material, die übrigen sind erfunden.
- Der Text zu Fehlercode `0305` ist eigener Wortlaut. `0402` und `0403` folgen der Codeliste.
