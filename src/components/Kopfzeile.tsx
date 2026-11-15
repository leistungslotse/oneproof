export interface KopfzeileProps {
  titel?: string
  /** The line above the title (who offers the service). */
  kennzeichnung?: string
  /** A page that needs more than the reading measure. */
  breit?: boolean
}

/**
 * KERN 2.8 documents a header component but ships no styles for it, so the
 * service bar below is composed from KERN primitives.
 *
 * The Kopfzeile itself sits flush against the top of the page — that is the
 * convention for a government bar — and is used without its federal flag,
 * because this is a fictional municipal service.
 */
export default function Kopfzeile({
  titel = 'Elterngeld beantragen',
  kennzeichnung = 'Ein Online-Dienst des Landkreises Auenthal',
  breit = false,
}: KopfzeileProps) {
  const spalte = `op-page ${breit ? 'op-page--breit' : ''}`
  return (
    <header>
      <div className="kern-kopfzeile">
        <div className={spalte}>
          <div className="kern-kopfzeile__content">
            <span className="kern-kopfzeile__label">{kennzeichnung}</span>
          </div>
        </div>
      </div>

      <div className="op-servicebar">
        <div className={`${spalte} op-servicebar__inner`}>
          <div>
            <p className="kern-preline kern-preline--small">Landkreis Auenthal</p>
            <p className="kern-title">{titel}</p>
          </div>
          <nav aria-label="Servicemenü">
            <ul className="op-servicebar__links">
              <li>
                <a className="kern-link kern-link--small" href="#hilfe">
                  Hilfe
                </a>
              </li>
              <li>
                <a className="kern-link kern-link--small" href="#kontakt">
                  Kontakt
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  )
}
