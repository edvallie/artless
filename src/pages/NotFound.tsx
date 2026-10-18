import { Link } from 'react-router'

export function NotFound() {
  return (
    <main className="page">
      <section className="panel prose" aria-labelledby="missing-h">
        <h2 id="missing-h">There’s no page here</h2>
        <p>
          <Link to="/">Back to the roaster</Link>
        </p>
      </section>
    </main>
  )
}
