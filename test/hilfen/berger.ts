// The Berger example as the fake check sees it: one scan with thirteen pages in the order of the
// example PDF, a photo of the disability card, and a file that cannot be opened. The grouping
// answer is what a language model gives for these pages: documents across the scan, one page
// (the blank back side) nowhere.
import { datei } from './falsche-ki.ts'

export const SCAN = [
  'Wohnraummietvertrag zwischen Wohnbau Auenthal eG und Miriam und Daniel Berger, Lindenstraße 8. Seite 1 von 3',
  'Abrechnung der Brutto/Netto-Bezüge für August 2026. Stadtwerke Auenthal GmbH. Miriam Berger. Gesamtbrutto 2.340,00',
  'Agentur für Arbeit Auenthal. Bewilligungsbescheid Arbeitslosengeld. Herrn Daniel Berger. Seite 1 von 2',
  'Mietvertrag Seite 2 von 3: Grundmiete 860,00 EUR, Betriebskosten 180,00 EUR, Heizkosten 100,00 EUR',
  'Abrechnung der Brutto/Netto-Bezüge für September 2026. Stadtwerke Auenthal GmbH. Miriam Berger. Gesamtbrutto 2.340,00',
  'Kita Sonnenblume. Gebührenbescheid Elternbeitrag für Lina Berger: 186,00 EUR monatlich',
  'Arbeitslosengeld: Berechnungsgrundlagen und Rechtsbehelfsbelehrung. Seite 2 von 2',
  '',
  'Abrechnung der Brutto/Netto-Bezüge für Oktober 2026. Stadtwerke Auenthal GmbH. Miriam Berger. Gesamtbrutto 2.340,00',
  'Mietvertrag Seite 3 von 3: Unterschriften, Auenthal, 12.03.2023',
  'Familienkasse Auenthal. Kindergeldbescheid für Lina Berger, 255,00 EUR monatlich',
  'Sparkasse Auenthal. Kontoauszug 10/2026. Miriam Berger. Miete Lindenstraße 8 -1.140,00',
  'Bausparkasse Mittelland AG. Jahreskontoauszug Bausparvertrag 7781 2290. Guthaben 4.312,57',
]

/** A page of the answer of the grouping model: the file it names, and the page. */
interface GruppierSeite {
  media_id: string
  page: number
}

const seiten = (fileId: string, ...nummern: number[]): GruppierSeite[] => nummern.map((page) => ({ media_id: fileId, page }))
const dokument = (evidence_type: string, person: string, pages: GruppierSeite[]) => ({ evidence_type, person, pages, confidence: 92 })

export const GRUPPIERUNG = `\`\`\`json\n${JSON.stringify({
  documents: [
    dokument('rent_contract', 'Miriam Berger', seiten('f1', 1, 4, 10)),
    dokument('payslip', 'Miriam Berger', seiten('f1', 2)),
    dokument('unemployment_benefit_notice', 'Daniel Berger', seiten('f1', 3, 7)),
    dokument('payslip', 'Miriam Berger', seiten('f1', 5)),
    dokument('child_care_cost_proof', 'Miriam Berger', seiten('f1', 6)),
    dokument('payslip', 'Miriam Berger', seiten('f1', 9)),
    dokument('child_benefit_notice', 'Miriam Berger', seiten('f1', 11)),
    dokument('bank_statement', 'Miriam Berger', seiten('f1', 12)),
    dokument('asset_proof', 'Miriam Berger', seiten('f1', 13)),
    dokument('disability_notice', 'Daniel Berger', seiten('f2', 1)),
  ],
})}\n\`\`\``

export const NACHWEISE = [
  datei('scan-unterlagen-familie-berger.pdf', SCAN, { hash: 'scan' }),
  datei('schwerbehindertenausweis-daniel-berger.jpg', ['Schwerbehindertenausweis Daniel Berger GdB 50'], { mime: 'image/jpeg', hash: 'foto' }),
  datei('Rückseite Ausweis.pdf', ['-'], { kaputt: true }),
]
