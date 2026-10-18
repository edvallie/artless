import { Link } from 'react-router'

const SOURCE_URL = 'https://github.com/edvallie/artless'
const ARTISAN_URL = 'https://github.com/artisan-roaster-scope/artisan'

/** Links off the site open in a new tab: leaving this one mid-roast closes the port, and the Hottop ejects the beans. */
function Outside({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export function About() {
  return (
    <main className="page">
      <section className="panel prose" aria-labelledby="about-h">
        <h2 id="about-h">About artless</h2>
        <p>
          artless is a browser control panel for the Hottop 2K+ coffee roaster. It reads and drives the roaster over
          USB, charts the roast, and records everything needed to replay it.
        </p>

        <h3>Use it at your own risk</h3>
        <p>
          artless isn’t made or supported by Hottop, and it comes with no warranty. It drives a heater with beans in it,
          so stay with the roaster while it runs. The safety cutoff and the Hottop’s own watchdog are there for when
          something goes wrong, not instead of you.
        </p>

        <h3>Source code</h3>
        <p>
          artless is free software under the <Outside href={`${SOURCE_URL}/blob/main/LICENSE`}>GNU AGPL</Outside>,
          version 3 or later. The source for this site is on <Outside href={SOURCE_URL}>GitHub</Outside>.
        </p>

        <h3>Credits</h3>
        <p>
          The Hottop protocol and driver are derived from <Outside href={ARTISAN_URL}>Artisan</Outside>, © the Artisan
          team.
        </p>

        <p>
          <Link to="/">Back to the roaster</Link>
        </p>
      </section>
    </main>
  )
}
