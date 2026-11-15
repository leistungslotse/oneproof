import type { ReactNode } from 'react'
import Footer from './Footer.tsx'
import type { FooterLink } from './Footer.tsx'
import Kopfzeile from './Kopfzeile.tsx'

export interface SeiteProps {
  /** In the service bar. */
  titel: string
  /** The line above it (who offers the service). */
  kennzeichnung?: string
  hinweis?: string
  links?: readonly FooterLink[]
  /** A page that needs more than the reading measure. */
  breit?: boolean
  /** Before everything else on the page. */
  oben?: ReactNode
  children: ReactNode
}

/**
 * The frame of a page: the service bar above, the note about the demo below. What the note says
 * and where else to go from here is up to the page (see `Footer`).
 */
export default function Seite({ titel, kennzeichnung, hinweis, links, breit = false, oben = null, children }: SeiteProps) {
  return (
    <>
      <Kopfzeile titel={titel} kennzeichnung={kennzeichnung} breit={breit} />
      <main className={`op-page ${breit ? 'op-page--breit' : ''} py-10`}>
        {oben}
        {children}
        <Footer hinweis={hinweis} links={links} />
      </main>
    </>
  )
}
