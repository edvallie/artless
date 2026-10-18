// The build has to ship the app as 404.html too, or GitHub Pages can't serve any route but /.
import { resolve } from 'node:path'
import { build, type Rolldown } from 'vite'
import { expect, it } from 'vitest'

it('ships the app as 404.html as well as index.html', async () => {
  const out = (await build({
    configFile: resolve(import.meta.dirname, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false },
  })) as Rolldown.RolldownOutput
  const html = (name: string) => out.output.find((f) => f.fileName === name)
  expect(html('404.html')).toBeDefined()
  expect(html('404.html')).toMatchObject({ type: 'asset', source: (html('index.html') as Rolldown.OutputAsset).source })
})
