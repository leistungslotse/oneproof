export interface FooterLink {
  href: string
  text: string
}

/** What the page says about itself, and where else to go from here. */
export interface FooterProps {
  hinweis?: string
  links?: readonly FooterLink[]
}

export default function Footer({
  hinweis = 'Nachweisprüfung: OneProof. Vorführung mit erfundenen Daten — kein echter Verwaltungsdienst, keine echte Registerabfrage.',
  links = [{ href: '/api.html', text: 'Die Schnittstelle hinter dieser Seite ansehen' }],
}: FooterProps) {
  return (
    <footer className="mt-12">
      <div className="kern-divider kern-divider--decorative" />
      <p className="kern-body kern-body--small kern-body--muted mt-4!">{hinweis}</p>
      {links.map(({ href, text }) => (
        <p key={href} className="kern-body kern-body--small mt-2!">
          <a className="kern-link kern-link--small" href={href}>
            {text}
          </a>
        </p>
      ))}
    </footer>
  )
}
