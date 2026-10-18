# artless

A browser control panel for the Hottop 2K+. It reads and drives the roaster over USB serial.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit and UI tests, including the driver against reference frames
npm run test:coverage  # the same, failing below the coverage floors in vite.config.ts
npm run build    # static files in dist/, with a copy of index.html as 404.html for GitHub Pages
```

Connecting to the roaster uses Web Serial, which needs **Chrome, Edge or Opera on desktop** and a page served from `localhost` or HTTPS. The simulator works in any browser.

On Linux, your user needs access to the serial device, usually by joining the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and back in).

## The roast clock

artless reads and charts the roaster from the moment it connects, but the clock doesn't start until you press
**Drop beans in**. That marks 0:00 (the _charge_), and the preheat already on the chart keeps its place at negative
time. **Beans out**, or **Drop beans out** in the controls, marks the end; recording carries on afterwards so the
cooling curve is kept too. **New roast** clears the recording.

## What it records

Everything needed to replay a roast exactly, not just the chart series:

- every status frame, at the machine's own rate, with its arrival time in epoch ms and its 36 bytes verbatim, so a
  recording can be fed back through the frame parser byte for byte
- every command artless sent, with its timestamp, decoded values and raw bytes
- every event: connect, disconnect, charge, drop, safety cutoff, and each setpoint change
  with the full setpoint vector after it
- the one-per-second chart series, which is derived from the frames

**Download roast** writes the lot as JSON (`format: "artless.roast"`, version 1). Timestamps are epoch ms, with a
`t` in seconds from the charge alongside. The recording lives in memory only: it is lost on reload.

## What it shows and controls

- Bean temp, environment temp, BT rate of rise and roast time, in °C or °F
- BT rate of rise is a least-squares fit over every frame of the last 20 s, not a two-point secant.
  BT arrives as whole °C, so at 8 °C/min it only ticks every 7.5 s and a secant over a window could
  only ever report multiples of 60/window — 2 °C/min steps at 30 s, 6 °C/min steps at 10 s. Fitting
  the whole window uses where the staircase sits in it, which is what makes 20 s steadier than the
  old 30 s secant while reacting sooner. It needs 10 s of frames before it shows anything.
- A roast chart of BT and ET, with heater and main fan underneath, markers for beans in and out, plus a hover readout
  and a data table
- artless controls the roaster the whole time it's connected. There's no read-only mode or take/release step.
  Until you touch a control, every output echoes what the Hottop reports, so connecting changes nothing.
- Heater 0–100 %, main fan and cooling fan in the machine's 11 steps, and on/off for drum motor, cooling stirrer and eject door
- **Drop beans out**: one button sets heater off, door open, drum and stirrer on, cooling fan at 10, and ends the roast
- **Follow the machine's values**: clears every override so each output echoes what the Hottop reports
- The safety cutoff: at 220 °C BT, the heater goes off, the main fan goes to max, the door opens, and the drum and stirrer run
- Link details: frames received, rejected and sent; the protocol-version and chaff-tray bytes; raw hex of the last frame each way; and a checksum toggle

## Protocol notes

`src/hottop/protocol.test.ts` checks the driver against 600 reference frames. Every byte matches except these, which differ on purpose:

1. **Cooling fan echo.** The cooling fan arrives as 0–10 and is scaled like the main fan, so an untouched cooling fan echoes back correctly instead of being knocked to 0 or 1.
2. **Safety-cutoff main fan.** The cutoff sends the main fan at 10 of 10, matching the intent of the rest of the cut.

artless sends one command per status frame, with no extra throttle.

## Safety

While connected, artless is in control and the Hottop expects a command at least once a second. If none arrives, it ejects the beans. Commands go out in reply to the machine's own status frames, so keep the tab open and the cable connected. That watchdog is also the emergency stop: pull the cable (or press Disconnect) and the beans come out about a second later.

There's no take/release step and no temperature lock on connecting or disconnecting. Releasing would only ever mean "stop sending", which trips the watchdog just like unplugging.

A sleeping computer is the same thing as an unplugged cable, so while the roaster is connected artless holds a screen wake lock to block idle sleep, and releases it on disconnect. The link details say whether the lock is held, and a banner appears if it isn't. The lock can't survive a closed lid, a deliberate sleep, or a backgrounded tab (browsers release it when the page is hidden; artless takes it again when you come back).

## Layout

- `src/App.tsx`: the shell around every page, with the top bar, banners, settings drawer and footer. Moving between pages
  leaves the connection and the recording alone; leaving the site doesn't, so links off it open in a new tab.
- `src/routes.tsx` and `src/pages/`: the roaster, About and not-found pages
- `src/hottop/protocol.ts`: frame format, checksum, encode/decode, stream parser
- `src/hottop/driver.ts`: control logic, setpoints and safety cutoff
- `src/hottop/webSerial.ts`: 115200 8N1 serial transport
- `src/hottop/simulator.ts`: a pretend roaster. Its thermal model and broadcast rate are made up, but it uses the real frame format and the 1 s eject watchdog.
- `src/roastLog.ts`: the recording — frames, commands, events, chart samples, the roast clock and the JSON export
- `src/wakeLock.ts`: holds the screen wake lock while connected, so idle sleep can't drop the link
- `src/hottop/reference-vectors.json`: reference frames for the protocol tests

## License

[AGPL-3.0-or-later](LICENSE). The Hottop protocol and driver (`src/hottop/protocol.ts`, `driver.ts` and their tests)
are derived from the Hottop driver in [Artisan](https://github.com/artisan-roaster-scope/artisan)
(`src/artisanlib/hottop.py`), © The artisan team.
