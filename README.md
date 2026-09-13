# Meadows Park Restaurant — POS & Billing for Kerala

A mobile-first, offline-capable **Point of Sale & billing app** for a restaurant in
Kerala, India. It runs in any phone/tablet browser, can be installed to the home
screen as an app (PWA), **built as a native Android app (APK)** via Capacitor, **or
installed as a desktop app (Windows / macOS / Linux)** via Electron — and works
**fully offline** in every form: all data lives on the device (IndexedDB), so no
internet or server is needed on the shop floor.

Built with React + TypeScript + Vite + Capacitor + Electron. No backend required.

## Quick start

```bash
npm install
npm run dev        # development server → http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve the production build
npm run test:gst   # run the billing/GST math test suite
npm run test:e2e   # build, then drive the real app end-to-end (see “Tests”)
```

Deploy the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages, a
Raspberry Pi, or even a USB drive served locally) — the app then installs like an
app and works offline.

## Desktop app (Windows / macOS / Linux)

The same app ships as a native desktop application (Electron). Every feature works:
tables & ordering, KOT, GST billing, thermal printing, WhatsApp share, reports,
backups — and the desktop build adds two things the browser PWA cannot do:

- **LAN sync hub on the admin's PC** — the desktop app can be the collector hub
  (like the Android app), so waiter phones connect to the counter computer instead
  of needing an Android device for the admin.
- **Web Bluetooth thermal printing** with the app's own printer picker (Electron's
  Web Bluetooth), plus automatic PIN pairing for common thermal printers.
- **Keyboard-first operation** — a counter PC can run the whole flow without a
  mouse: `Alt+1…7` switch tabs, type a table number + `Enter` to open it,
  `Alt+T`/`Alt+D` start takeaway/delivery, `/` searches the menu, `↑`/`↓` pick an
  item and `Enter` adds it, `Alt+P` goes to checkout / prints the receipt, `Enter`
  pays with the typed amount, `Esc` closes popups. Tap the ⌨️ button in the top
  bar for the full list. PIN entry works from the keyboard or the on-screen pad
  (`⌫` deletes a digit, `Enter` submits, `Esc` clears). The **kitchen display**
  is keyboard-first too: `↑`/`↓` select a KOT, `Enter`/`F2` marks it Ready, `F3`
  marks it Served, `P` prints it, `1`/`2`/`3` switch the pending/ready/all filter.

```bash
npm run desktop:dev     # dev: Vite + Electron with hot reload
npm run desktop:build   # production build + installer → release/
```

`npm run desktop:smoke` boots Electron once and checks the app loads; `npm run
test:e2e` goes further and actually **uses** the app (see “Tests” below).

- **Installers**: `release/` gets a Windows NSIS installer (`.exe`), macOS
  `.dmg`, and Linux AppImage/`.deb`. Build each platform on that platform (or use
  GitHub Actions / electron-builder's docker images for cross-building). For a
  quick unpacked test without an installer, run `npm run desktop:dir` and launch
  the binary under `release/`.
- **First run on Windows**: Windows Firewall may ask to allow the app when you
  start the sync hub — allow it on private networks so waiter devices can connect.
- **Data**: the desktop app uses the same IndexedDB storage as the web app, kept in
  the app's own profile folder — a fresh install starts with demo data, and you can
  restore a full backup from any other device (Settings → Data & backup).
- Backups downloaded in the desktop app open a native “Save as…” dialog.
- **Navigation** — tabs are switchable from anywhere, including inside an order
  or the checkout screen (the sidebar stays available), and the checkout has a
  clearly labelled back button.

## Android app (APK)

## Staff users (manage in Settings)

Demo users: **Manager** (PIN `0000`, full access), **Waiter** (`2222`, tables &
orders), **Kitchen** (`1111`, kitchen display only). In **Settings → Staff users**
(admin) you can:

- change any user's **name, role (Manager / Waiter / Kitchen) or PIN**, and
- **add or remove users** — every user signs in with their own 4-digit PIN, and
  the name you give them shows in the top bar and on bills as the staff name.
  PINs must be 4 digits and unique, and at least one Manager must remain.

> The **Settings tab is protected by its own 4-digit PIN** (default `1234`, change it
> in Settings → Staff users). Enter it once per session; it re-locks on sign-out.

## Features

- **Tables & orders** — grid of dine-in tables (free/occupied with live bill
  total), plus takeaway and delivery orders with optional customer name, phone
  and address (printed on the invoice and shown on the KOT as
  “Delivery – name”).
- **Split bill** — “separate bills please” is one tap: split any dine-in order
  into two checks at the same table, each with its own KOT history and invoice.
  Tables with multiple open bills show a picker (Bill 1 / Bill 2).
- **Repeat order** — one tap re-creates the same items (and kitchen note) from
  any past order, in order history.
- **Order notes** — a note to the kitchen/rider (“less spicy, extra gravy”)
  attached to the order and printed on the KOT.
- **Menu & ordering** — categories, search, veg/non-veg badges, quantity
  steppers, per-item notes ("less spicy"), stock tracking with out-of-stock
  protection, item availability toggles, and **dish photos**: add a picture
  to any item in Settings/Menu (auto-resized to a small thumbnail and stored
  on-device, so it works offline and travels with menu backups).
- **KOT (kitchen order tickets)** — send items to the kitchen display, mark
  Ready → Served, printable tickets. Daily KOT numbering.
  - **New-order beep** — the kitchen display plays a short two-tone chime when
    a new KOT arrives (own sends, waiter phones over LAN sync and split bills
    all trigger it), and repeats it every 30s while a pending ticket is still
    unhandled. The 🔔 button mutes/unmutes it, remembered per device.
  - **Order aging** — pending tickets highlight as they get older: amber after
    5 minutes, then red with a gentle pulse after 10, with a live “7m” elapsed
    time on the card, so nothing sits unnoticed in a rush.
- **GST billing engine** (intra-state Kerala: CGST + SGST):
  - Slabs 0/5/12/18/28% per item, with HSN codes.
  - Menu prices can be **inclusive or exclusive** of GST (**exclusive is the
    default** — GST is added on top of the menu price, so the bill total
    includes CGST + SGST; the Subtotal shown is the pre-tax value and
    Subtotal + CGST + SGST (+ round-off) = TOTAL). Existing installs were
    migrated to exclusive automatically on upgrade.
  - A per-bill **GST toggle at checkout** (“Charge GST on this bill”): switching
    it off issues the bill without CGST/SGST (receipt shows plain “INVOICE”, no
    tax lines or tax summary). With inclusive menu prices the total stays the
    same — only the tax lines disappear; in exclusive mode GST is removed from
    the total.
  - Discounts (flat ₹ or %), optional service charge (GST applied per CBIC
    guidance), **delivery charge** (a flat fee on delivery orders, entered at
    checkout — it is not discounted and carries no GST of its own), round-off
    to the nearest rupee (0.50 rounds up). The delivery charge appears on the
    bill, the printed/thermal/WhatsApp receipt, the order detail, the reports
    (a “Delivery charges collected” total) and the CSV export.
  - All money is integer paise — no floating-point rounding bugs. Covered by
    `npm run test:gst`.
- **Payments** — cash (with tender & change), UPI (with scannable QR for any UPI
  app), card, and split payments across methods.
- **Tax invoices** — printable GST invoice with restaurant name/address, GSTIN,
  FSSAI licence no., invoice number (daily sequence), itemised tax summary and
  payment details. Receipts can be reprinted from order history. The bill
  header styles the restaurant name as a signature: the main part (e.g.
  “MEADOWS PARK”) prints in Brush Script MT with the trailing word (e.g.
  “RESTAURANT”) below it in sans-serif.
- **Thermal invoice printing** — connect a Bluetooth ESC/POS thermal printer
  (Settings → Thermal printer), choose 58mm or 80mm paper, and print straight
  from the receipt (or KOT) with one tap. Text is rendered to a 1-bit raster,
  so ₹ and Unicode print correctly on any ESC/POS printer. Receipts are
  **supersampled** (drawn at 2× the dot resolution and smoothed down before the
  1-bit threshold), which removes the stair-step aliasing that makes raster
  text look ragged — noticeably crisper on paper. The bill header is rasterised
  too, so the printed receipt matches the screen: **MEADOWS PARK** in the
  script font with **RESTAURANT** in sans-serif below it. A script font
  (Great Vibes, OFL) is **bundled into the app**, so the script header renders
  on every machine — even offline, with no Brush Script MT installed (Brush
  Script MT is still used first when present). The system Print dialog prints
  the same two-line header in the bundled font, on a clean receipt layout (no
  card borders/shadows on paper) with a widely available monospace body stack
  (Consolas/Courier New), so the alignment and the ₹ glyph stay correct on
  any printer driver. KOT tickets print the restaurant name in the same
  script font.
  - **Bill layout** — the receipt matches the classic POS layout: a
    `Cashier :NAME` / `Covers: N` top row, a `Dish | Qty | Amnt` column header,
    item rows with a veg (`*`) / non-veg (`#`) marker and two-decimal amounts
    (e.g. `1 * 15.00`), right-aligned totals, and a `Service Charge @10.00 :
    + 48.83` line. Invoice/date/customer details sit below the totals. The
    same layout is used on screen, in the system Print dialog, on the
    thermal/USB raster, and in WhatsApp shares.
  - **Bill design editor** — Settings → Bill design lets you change the bill
    yourself with a live preview: custom header lines (e.g. your hours line
    `Open 7:00 AM - 11:00 PM`) and footer lines with `{placeholders}`
    (`{name} {address} {phone} {gstin} {fssai} {invoice} {date} {time}
    {cashier} {covers} {table} {type}`), show/hide toggles for each section
    (restaurant header, TAX INVOICE label, Dish/Qty/Amnt columns, veg/non-veg
    markers, invoice details, GST summary, payments, footer), plus **font size
    (80–150% slider)** and **font thickness (Regular / Bold / Extra bold)**
    controls for the whole bill. Applies everywhere — screen, Print,
    thermal/USB and WhatsApp. On the paper roll a bigger font re-wraps the
    receipt to fewer characters per line so the larger text still fits the
    roll width.
  - **Browser (PWA)**: uses Web Bluetooth (Chrome/Edge, HTTPS).
  - **Desktop app**: uses Web Bluetooth with the app's own printer picker
    (Electron) and auto-answers common pairing PINs.
  - **Desktop app — USB printers**: a thermal printer connected with a USB
    cable can be used too. Settings → USB printer (desktop) lists the
    installed printers; pick one and receipts/KOTs get a “🔌 USB” button that
    sends the same ESC/POS raster straight to it over the USB cable (raw
    write to the OS print queue — no extra drivers or native modules). The
    ESC/POS CUT command rides in the same byte stream right after the receipt
    raster and a generous paper feed (so the last line clears the cutter), and
    the printer executes it in order — the paper is cut automatically right
    after every receipt, with no waiting and no risk of the cut clipping the
    bottom of the bill. A **✂️ Cut** button on the receipt screen sends just
    the cut, for a receipt still hanging out of the printer. The printer's
    paper width is detected automatically (shown next to each printer in the
    picker and in Settings) and the 58/80mm/custom width setting is set to
    match; the detected width is remembered per printer.
  - Paper width: **58mm, 80mm, or a custom roll** (e.g. 76mm) in Settings →
    Thermal printer — set automatically when a USB printer's width is
    detected, or choose it manually.
  - **Android app (APK)**: uses a native Bluetooth plugin speaking classic
    **SPP (Serial Port Profile)** — the protocol most thermal printers expose —
    with the standard SPP UUID, secure-then-insecure fallback, a paired-device
    picker, and it remembers the last printer. The last-connected printer is
    reconnected automatically when you tap the thermal button.
  - The system Print dialog remains available as a universal fallback.
- **Share bill via WhatsApp** — one tap turns the bill into a formatted receipt
  message in WhatsApp, from the receipt screen or order history.
- **Expense & profit tracking** — a dedicated **Expenses** tab (admin) records
  expenses (amount, category, note, date); Reports then show
  **profit = net sales − expenses** for any date range, an expenses-by-category
  breakdown, and expenses + profit are included in the CSV export.- **Reports** — net sales, bills, average bill, payment-method mix, CGST/SGST
  collected, delivery charges, category-wise sales, top items, profit, for
today/yesterday/7 days/month or a custom range, with **CSV export**.
- **End-of-day Z-report** — one tap (Reports → 🧾 End-of-day Z-report) opens a
  printable day-close summary for the business day (respecting the End-of-day
  rollover time): bills, gross sales, sales by payment method, discounts,
  delivery &amp; service charges, CGST/SGST, round-off, **cash to be handed over**
  (“CASH IN DRAWER” = opening cash + cash collected − cash expenses), the day's
  voids with reasons, and the list of bills. It prints through the same paths
  as a receipt: the system **Print** dialog, **Bluetooth thermal**, and
  **USB** on the desktop app (the narrow layout re-wraps to 32/48 characters to
  fit the paper roll).
- **Paid bills by day/week/month** — the **Orders → Paid** tab has Daily /
  Weekly / Monthly / All chips (calendar-based: today, this week from Monday,
  this calendar month) with a live bill count + total sales for the chosen
  range, so you can see exactly what was collected today, this week or this
  month.
- **Backups & recovery** (Settings → Data & backup):
  - **Full backup** — download all data as JSON, import it back (even on a new
    device/phone).
  - **Menu export/import** — back up just the categories & items, or restore a
    menu file into a fresh install.
  - **Auto-backup** — choose a frequency (Off / Daily / Weekly / Monthly) in
    Settings → Data & backup; a snapshot is saved automatically on-device at
    that frequency (checked on every launch and while the app is open). Plus
    one-tap "Backup now"; any snapshot can be restored if data is ever lost or
    corrupted.
  - "Reset to demo data" to start fresh.
- **End of day** — the day rolls over **automatically** at a time you choose
  (Settings → End of day, default 00:00 / midnight; set e.g. 00:30 if your day
  ends at 12:30 AM). The rollover takes an end-of-day snapshot first, restarts
  invoice & KOT numbering from 1, and closes any open orders (marked "End of day
  rollover"). It also catches up if the app was closed overnight (open orders
  from the previous day are closed on the next launch). Paid bills stay in
  history and reports — nothing is ever deleted. **Settings → End of day →
  “Start next day now”** still lets you roll over early, before the automatic time.
- **Multi-device LAN sync** — every staff member can use their own phone while
  all bills still land in the admin's Reports, with **no internet and no
  server**: the admin's device runs a small WebSocket hub on the local network
  (native Android app only), and waiter/kitchen devices connect to it with a
  4-digit pairing code. Orders & KOTs sync both ways (last-write-wins); menu,
  settings, staff users and the end-of-day time are pushed from the hub to
  every connected device.
  See “Multi-device sync (LAN)” below.
- **Restaurant branding** — upload your restaurant **logo** in Settings →
  Restaurant profile; it replaces the 🍽 badge on the login screen, splash,
  sidebar and top bar (stored on-device and synced to connected devices).
- **Offline-first — the desktop app loads with no WiFi at all**: the Electron
  shell is served straight from disk (a pure filesystem handler in the main
  process — no network service involved), so the app opens and runs even when
  the computer has no WiFi/internet connection. All data is on-device and
  printing (USB/Bluetooth), billing and reports keep working. Covered by
  `npm run test:serve`.
- **Offline-first PWA** — installable, works with **no internet** after the
  first load:
  - Zero external dependencies: no CDNs, no webfonts, no external APIs — the
    app shell and all build assets are **precached** by the service worker
    (generated at build time from the actual file list), so the app opens even
    with the server/network completely down.
  - All data lives in IndexedDB (debounced saves, flushed on close); dish
    photos are stored as small data-URL thumbnails on-device; the UPI QR and
    thermal-print raster are generated locally.
  - An **offline banner** appears (on the login screen and everywhere else)
    when the connection drops, so staff know billing keeps working and data is
    safe. It disappears automatically when the connection returns.
  - `npm run test:offline` runs the service worker's exact fetch logic against
    the production build with a network that always fails, proving the shell
    and assets load from cache. (WhatsApp share and Bluetooth printing are the
    only features that inherently need connectivity.)

## Android app (APK)

The web app is wrapped in a native Android shell with Capacitor, so it installs
like a normal app (own icon, own storage) and Bluetooth thermal printing works
through a native plugin instead of the browser-only Web Bluetooth API.

```bash
npm run build && npx cap sync android   # rebuild the web bundle into the app
cd android && ./gradlew assembleDebug   # produces app-debug.apk
```

- APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Package: `com.nellara.pos` · minSdk 24 (Android 7+) · targetSdk 36
- The native plugin (`BluetoothThermalPlugin`) is registered in `MainActivity`;
  it requests the `BLUETOOTH_CONNECT` runtime permission on Android 12+ and
  falls back to insecure RFCOMM for printers that only accept it.
- WhatsApp share in the app opens the WhatsApp app via a native intent
  (`@capacitor/browser`); the browser PWA keeps the `wa.me` tab behaviour.
- A debug-signed APK is fine for testing; for distribution, build a release APK
  signed with your own key.

## Online payments (Razorpay)

The app is offline-first: cash, the UPI QR and card are recorded manually and
always work — no internet, no gateway. On top of that, an **optional online
payment method** can be switched on in **Settings → Online payments
(Razorpay)**: a **“Pay online (card / UPI)”** button then appears at checkout
and opens **Razorpay Checkout**, so customers can pay by card, UPI, netbanking
or wallet and the money settles straight into the restaurant's Razorpay
account.

**How it stays safe**

- Card details are typed into Razorpay's own PCI-DSS compliant page — they
  never touch this app.
- The **secret key never ships in the app**. It lives only on a tiny,
  dependency-free helper server (`server/`) that creates Razorpay orders and
  **verifies the payment signature** (HMAC-SHA256) before the bill is marked
  paid; the app only stores the public Key ID. If the signature check fails,
  the order is *not* marked paid — the checkout is simply rolled back.

**Running the helper server** (Node 18+, run it on the counter PC):

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx RAZORPAY_KEY_SECRET=yyyyyyyy npm run pay:server
```

Then in the app: Settings → Online payments (Razorpay) → enable, paste the
public **Key ID**, set the **server URL** (default `http://localhost:8787`)
and tap **Test connection**. Start with Razorpay **test keys** (dashboard →
Settings → API keys) before going live. Covered by `npm run test:pay`.

**Limitations**

- Needs internet at the moment of payment. Offline, checkout keeps the manual
  cash / UPI QR / card buttons — nothing is blocked.
- **Desktop app**: recommended — the app calls the helper server through the
  Electron main process, so a plain-http server on the counter PC just works.
- **PWA served over HTTPS**: a browser on an https page cannot call a
  plain-http server (mixed content) — put the helper behind HTTPS in that
  case, or use the desktop app.
- **Android app**: cards work in the WebView, but UPI via the checkout may
  not open other UPI apps from there — the built-in UPI QR stays the best UPI
  method on Android.
- Razorpay charges per transaction (see their pricing); UPI via the built-in
  QR has no gateway fee at all.

## Multi-device sync (LAN)

The app is offline-first, but a restaurant usually has several staff members.
Instead of sharing one device, each waiter can use their own phone while every
bill still lands in the admin's Reports — over the local Wi-Fi, with **no
internet and no server**.

**How it works**

- **Collector hub (admin device)** — in the Android app or the **desktop app**,
  tap the **Sync** pill (top-right) → *As collector (admin)* → **Start sync hub**.
  The device starts a WebSocket server on the local network (default port `8765`)
  and shows its addresses and a 4-digit pairing code. The hub runs in the
  **Android app and the desktop app only** (a phone/tablet browser cannot listen
  for connections).
- **Waiter / kitchen devices** — on each phone (Android app *or* browser), tap
  the **Sync** pill → *As waiter / kitchen device* → enter the hub's address
  (e.g. `192.168.1.50:8765`) and the pairing code → **Connect to hub**. The
  pill turns green ("Synced") when connected.
- **What syncs** — orders and KOTs sync both ways (merged by id, last-write-wins
  on `updatedAt`), so a bill taken on a waiter's phone appears in the admin's
  Reports automatically, and the kitchen display on any device sees the KOTs.
  Menu, billing settings, restaurant profile and staff PINs are **hub-authoritative**:
  changes made on the hub are pushed to every connected device.
- **Invoice numbers** — the hub owns the invoice counter. If two devices bill at
  the same time, the hub renumbers the later invoice and sends the correction
  back, so invoice numbers never collide across devices.
- **Reconnection** — clients reconnect automatically (with backoff) if the
  connection drops; new bills taken while offline are pushed when the link
  returns.

**Caveats**

- The hub must be running on the admin's device for sync to happen; each device
  keeps its own full copy of the data regardless, so nothing is lost if the hub
  is off.
- The browser PWA can only be a *client* (it cannot run the hub), and a PWA
  served over **https** cannot reach a `ws://` hub — use the Android app for the
  hub, and for clients either the Android app or an http-served PWA.
- Sync is over your local Wi-Fi only — devices must be on the same network.

## Tests

Everything runs offline with no test framework to install — plain Node scripts
that print a line per check and exit non-zero on failure:

| Command | What it covers |
| --- | --- |
| `npm run test:gst` | Bill math: slabs, inclusive/exclusive pricing, discounts, delivery charge, round-off |
| `npm run test:receipt` | Printed / thermal / WhatsApp receipt text layout and wrapping |
| `npm run test:zreport` | End-of-day Z-report aggregation, rollover day boundary, text width |
| `npm run test:sync` | LAN sync merge and conflict rules |
| `npm run test:rollover` | Business-day boundaries and daily counter resets |
| `npm run test:pay` | Razorpay helper server (order creation + signature check) |
| `npm run test:offline` · `test:serve` | Service-worker fetch logic and the production shell |
| `npm run test:desktop-hub` | Desktop sync-hub transport |
| `npm run desktop:smoke` | Electron boots and loads the app |
| `npm run test:e2e` | **End-to-end**: builds, then drives the real desktop app (below) |

`npm run test:e2e` launches the Electron app with a throwaway profile (so it
always starts from the demo data) and drives it over the DevTools protocol the
way a cashier would: sign in on the PIN pad, bill a delivery order with a
delivery charge, take exact cash, read the receipt, check Reports and the
Z-report, look at the kitchen display, and confirm a waiter cannot reach
Settings. Any failing step prints the screen it got stuck on and makes the run
exit non-zero, so a regression in a core flow is caught without clicking through
the app. `E2E_SHOW=1` keeps the window visible while it runs.

## Demo data

Ships with the **Meadows Park Restaurant (Chemperi)** menu — 53 items across
Tea & Coffee, Bread, Rice & Pulao, Chicken, Breakfast, Biriyani and Veg — plus
12 tables. Size options (Half / Full / Family) are baked in for the chicken and
biryani items; “Fish Biryani” is marked Seasonal (priced at ₹200 by default,
editable in the Menu tab). When a menu update ships with a new version of the
app, existing installs have their categories/items replaced automatically on
first launch (kept data and history are untouched — bills snapshot item names
and prices). Set your restaurant details (GSTIN, FSSAI, UPI ID…) in Settings.

## Notes

- GST treatment here is intra-state (CGST + SGST). For inter-state sales, CGST/SGST
  would become IGST — not handled by design.
- UPI QR generation uses your UPI ID from Settings; it opens the customer's UPI
  app with the amount pre-filled and pays straight to the restaurant's UPI
  account (no gateway, no fees). Online card/UPI collection via Razorpay is
  optional — see “Online payments (Razorpay)” above.
- Thermal printing: in the **browser**, Web Bluetooth requires Chrome/Edge on
  Android or desktop, served over HTTPS (localhost works in development); most
  58mm/80mm ESC/POS printers expose the standard 0xFF00 serial service and are
  picked up automatically. In the **Android app**, classic SPP is used instead
  (see “Android app (APK)” above). In the **desktop app**, Web Bluetooth works
  with the app's own printer picker (see “Desktop app” above). The system Print
  dialog works everywhere.
- WhatsApp sharing opens the `wa.me` deep link with the receipt as the message;
  on phones it goes straight to WhatsApp, on desktop it opens WhatsApp Web.
