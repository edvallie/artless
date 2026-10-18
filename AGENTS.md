# artless — Agent Rules

The always-loaded rules for working in this repo. How the app behaves for a roaster lives in [`README.md`](README.md); read it before changing anything on the roast or control path.

## Persona

Tell me if I'm being an idiot or have a bad idea — don't just appease me. Be concise, don't overexplain. Ask clarifying questions. If there's a better way, say so.

## Project Overview

artless is a browser control panel for the Hottop 2K+ coffee roaster. It reads and drives the roaster over USB serial (Web Serial), charts the roast, and records everything needed to replay it. It's a static single-page app with no backend.

## Tech Stack

- **App:** Vite + React 19, plain CSS (tokens in `src/index.css`, layout in `src/App.css`). React Router in data mode (`createBrowserRouter`, routes in `src/routes.tsx`). No UI library, no state library: stores are small classes read through `useSyncExternalStore`
- **Serial:** Web Serial (`@types/w3c-web-serial`), so only Chrome, Edge and Opera on desktop, from `localhost` or HTTPS
- **Language:** TypeScript strict
- **Tests:** Vitest + `@vitest/coverage-v8`; UI tests use Testing Library + `happy-dom`
- **Lint/format:** oxlint · Prettier (no semicolons, single quotes, 120 columns)
- **Fonts:** Barlow and Barlow Semi Condensed from Google Fonts (`index.html`)
- **License:** AGPL-3.0-or-later. The driver and protocol are derived from [Artisan](https://github.com/artisan-roaster-scope/artisan)

## Directory Structure

```
artless/
├── src/
│   ├── hottop/
│   │   ├── protocol.ts        frame format, checksum, encode/decode, stream parser
│   │   ├── driver.ts          control logic, setpoints, safety cutoff
│   │   ├── transport.ts       the Transport interface (a byte pipe)
│   │   ├── webSerial.ts       115200 8N1 serial transport
│   │   ├── simulator.ts       a pretend roaster (made-up thermal model, real frames and watchdog)
│   │   └── reference-vectors.json  600 frames from the reference implementation
│   ├── components/            ControlPanel, RoastChart
│   ├── pages/                 Roaster (readouts, chart, controls, link details), About, NotFound
│   ├── roastLog.ts            the recording: frames, commands, events, samples, roast clock, export
│   ├── state.ts               the driver singleton, units, debug mode, formatters
│   ├── wakeLock.ts            blocks idle sleep while connected
│   ├── routes.tsx             every page, inside the shell
│   └── App.tsx                shell: top bar, banners, settings drawer, footer
├── public/                    favicon
└── AGENTS.md                  (this file)
```

## Development Workflow

- `npm run dev` serves on `:5173`. **Check for a running server before starting one** (`lsof -nP -i :5173`): if it's there, it's the human's, so use it and don't kill it. If you start one to check a change, stop it before you finish.
- **Verify with the simulator.** Open the settings drawer (☰), turn on **Debug mode**, then **Run simulator**. **20×** speeds up its temperatures, but the roast clock still runs in real time. The simulator's thermal model is invented: use it to check behaviour, never to tune numbers.
- **Debug mode is off by default** and hides the simulator and the machine and link details. Anything for developers rather than roasters goes behind it.
- Scripts: `npm test` · `npm run test:coverage` · `npm run lint` · `npm run build` (typecheck + bundle) · `npx vitest run <path>` for targeted tests.

## Git & commits

- **Branch before you edit.** `type/kebab-work` (`feat/settings-drawer`).
- **Conventional commits**, always: `type(scope): lowercase summary` (`fix(driver): keep setpoints across reconnect`). The body explains _why_. Commit at seams you could revert; don't save everything for one commit at the end.
- **Offer, never assume**, for anything outward-facing: pushing, opening a PR, creating a repo.

## Code Style

- Match the code around you: its naming, comment density and idiom. Comments say _why_, not what.
- Named exports for components (`App` is the one default export). Component files export only components.
- Colors come from the tokens in `src/index.css`, and every token has a dark-mode value. Don't add raw hex.
- UI copy is plain, in sentence case, and says what will happen to the beans. See the banners in `App.tsx` for the voice.
- Files derived from Artisan keep their SPDX and copyright header. A new file ported from Artisan gets the same header.
- Prettier (`npx prettier --check .`) and oxlint must be clean. The existing `react(purity)` warning on `Date.now` in `MachineDetails` is known.
- **Leaving the page mid-roast ejects the beans**: the port closes and the watchdog fires. Pages go in `routes.tsx` under the shell, links between them use `Link`, and links off the site open in a new tab.

## Stop-ship rules

These protect the beans and the roaster. Breaking one is a bug, whatever the tests say.

1. **The watchdog is the emergency stop.** The Hottop ejects the beans if it hears no command for about a second. The driver answers each valid status frame with exactly one command, with no throttle or batching. Never add anything that can delay or skip a reply: an `await` before the write, a debounce, a timer. → `driver.ts`
2. **The safety cutoff is not optional.** At 220 °C BT: heater off, main fan to max, door open, drum and stirrer on. It overrides user setpoints and writes itself into them, so the heater stays off as BT falls. Don't add a way to disable it. → `driver.ts`
3. **Connecting changes nothing.** Until the user touches a control, every output echoes what the Hottop reports. → `driver.ts`
4. **Bytes match the reference.** `protocol.test.ts` checks encode and echo against `reference-vectors.json`. The only intended differences are the two documented in the README. A new difference needs a reason in the README and in the test.
5. **The recording stays replayable.** Every frame verbatim, every command, every event. A change to the export's shape bumps `version` in `RoastExport`. → `roastLog.ts`

## Testing

Tests ship with every change. Test intent, not implementation. Mock at the seam, not inside it: hand the driver a fake `Transport`, give the serial transport a fake `SerialPort`. Tests must be deterministic. Green before done.

| Tier         | When                         | Command                              |
| ------------ | ---------------------------- | ------------------------------------ |
| **Targeted** | Every edit. The normal case. | `npx vitest run <path> [<path> …]`   |
| **Full**     | Finishing a task, shipping   | `npm test` · `npm run test:coverage` |

- **Never `--coverage` on a targeted run.** The thresholds are global, so a narrow run fails them by construction.
- **Coverage never goes below 90%** on statements, branches, functions or lines, and **the ratchet only goes up.** The floors are in `vite.config.ts` and are never set under 90. When coverage improves, raise them in the same change. Never lower one to get a run passing: write the missing test.
- **Cover the branches.** Every conditional, error path and early return gets a test that exercises it. A defensive check that can't fire is better removed than tested with an impossible state.
- **DOM tests opt in per file** with `// @vitest-environment happy-dom` as the first line. Everything else runs in Node.
- **`driver` and `roastLog` are page-wide singletons.** A test that touches them disconnects, clears setpoints and errors, and calls `roastLog.newRoast()` in `afterEach`. For a module-level singleton like `wakeLock`, use `vi.resetModules()` and a fresh import.
- **Time is fake.** Use `vi.useFakeTimers()` and `vi.setSystemTime()` for the roast clock, the simulator's 250 ms beat and the 1 s watchdog. Never sleep in a test.
- A safety change (stop-ship rules 1–3) needs a test that fails without it.
