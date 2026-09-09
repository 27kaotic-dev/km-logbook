# KM Logbook

A private, offline Android (and desktop) app for tracking **work** and **private**
kilometres, with monthly / yearly export to Excel in a format aligned with the
**ATO logbook** and **cents‑per‑kilometre** methods.

It's a PWA (installable web app): no Play Store, no accounts, no server. All data
stays in the browser's local storage on your device.

---

## What it does

- **Start / Stop trip** from one big button.
- On stop it asks **Work or Personal** and (for work) a **purpose of journey**.
- Records **GPS distance** while the app is open, and lets you enter / correct
  **odometer readings** at start and stop. Odometer readings win when both are set.
- **Trips** tab: month‑by‑month list, tap any trip to edit or delete.
- **Export** tab: pick financial year (1 Jul–30 Jun) or calendar year, optional
  single month, and download an `.xlsx` with four sheets:
  1. **Logbook** – date, times, start/end odometer, km, business/private, purpose.
  2. **Cents per km** – business km per month, 5,000 km cap, estimated claim.
  3. **Vehicle & Period** – car details, logbook‑period odometers, business‑use %.
  4. **All trips** – full audit dump (incl. GPS coords, distance source).
- **Backup / restore** to a JSON file.

---

## Install it on your phone

The app must be served over `https://` (or `http://localhost`) for offline install
to work. Easiest free option is **GitHub Pages**:

1. Create a new GitHub repo and upload the contents of this folder
   (`index.html` must be at the repo root, or in `/docs`).
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a
   branch*, Branch = `main` (folder `/root` or `/docs`).
3. Open the published URL (e.g. `https://yourname.github.io/km-logbook/`) in
   **Chrome on Android**.
4. Chrome menu **⋮ → Add to Home screen / Install app**.
5. Launch it from the home‑screen icon. It now works fully offline.

First launch online caches everything; after that it runs with no connection.

### Other hosting options
- Netlify / Cloudflare Pages / Vercel – drag‑and‑drop the folder.
- Local test: `python -m http.server 8747` then open `http://localhost:8747`.

---

## First‑time setup (Settings tab)

Fill these in so the export is complete:

- **Vehicle**: make, model, engine capacity, registration.
- **Logbook period**: start date + odometer, end date + odometer
  (ATO needs a continuous period of **at least 12 weeks**).
- **Cents‑per‑km rate**: dollars per km. Update it each year — check the current
  rate on ato.gov.au ("cents per kilometre method").
- **Current / last odometer**: pre‑fills the next trip.

---

## GPS accuracy notes

- GPS distance is a convenience estimate. Brief GPS drift and tunnels/parking
  garages cause small errors, so the export always shows GPS km **and** the
  odometer‑based km side by side.
- **Locking the screen can pause GPS** in a browser PWA. For accurate logs, enter
  the real **odometer readings** at start and stop — that's what the ATO wants
  anyway, and it's unaffected by GPS.
- The app keeps the screen awake while a trip is running.

---

## ATO compliance – what this covers and what it doesn't

**Covers (record‑keeping):**
- Per‑journey: dates, start/end odometer, total km, reason for the journey.
- Logbook‑period odometer readings and calculated business‑use %.
- Vehicle identification details.
- Cents‑per‑km summary with the 5,000 business‑km cap applied.

**You still need to:**
- Keep a logbook for a continuous **12‑week** period that's representative of your
  year's driving. A logbook is generally valid for **5 years**.
- Record odometer readings at the **start and end of each income year** you use
  the logbook method.
- Keep receipts / evidence for actual car expenses (fuel, servicing, rego,
  insurance, interest, depreciation) if using the logbook method.
- Retain all records for **5 years** after lodging.

This app is a record‑keeping aid, **not tax advice**. Confirm current rules and
rates at [ato.gov.au](https://www.ato.gov.au).

---

## Files

```
index.html              app shell
css/styles.css           styles
js/store.js              localStorage data layer
js/geo.js                GPS tracking (watchPosition + wake lock)
js/export.js             XLSX workbook builder
js/ui.js                 screens, dialogs, events
js/app.js                bootstrap + service‑worker registration
vendor/xlsx.full.min.js  SheetJS (bundled for offline use)
sw.js                    service worker (offline cache)
manifest.webmanifest     PWA manifest
icons/                   app icons
```

No build step. Edit and reload.

## Privacy

All trips and settings live only in your device's browser storage. Nothing is
uploaded anywhere. Clearing the browser's site data, or "Delete all" in Settings,
erases everything — use **Backup** regularly.
