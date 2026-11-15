import { use } from 'react'
import type { ReactNode } from 'react'
import Rahmen from '../components/Seite.tsx'
import EntwurfHinweis from './EntwurfHinweis.tsx'
import { EntwurfKontext } from './entwurfskontext.ts'

const HINWEIS =
  'Nachweisprüfung: OneProof. Vorführung — geprüft werden nur die Dateien, die Sie hier auswählen. Es erfolgt keine Abfrage bei Behörden und kein Antrag wird tatsächlich gestellt.'

const LINKS = [
  { href: '/', text: 'Zum Klick-Dummy für Elterngeld' },
  { href: '/sachbearbeitung.html', text: 'Für die Fachabteilung: Nachweisprofile verwalten' },
  { href: '/api.html', text: 'Die Schnittstelle hinter dieser Seite ansehen' },
]

export interface SeiteProps {
  /** In the service bar. */
  titel: string
  children: ReactNode
}

/**
 * The frame of every view of the check: the service bar above, the note about the demo below.
 * When the check runs against a draft of the department, that is said first, on every view.
 */
export default function Seite({ titel, children }: SeiteProps) {
  const entwurf = use(EntwurfKontext)

  return (
    <Rahmen
      titel={titel}
      hinweis={HINWEIS}
      links={LINKS}
      oben={entwurf ? <EntwurfHinweis profil={entwurf.profil} entwurf={entwurf.entwurf} /> : null}
    >
      {children}
    </Rahmen>
  )
}
