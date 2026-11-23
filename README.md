# Play On

A single-venue court booking application built with React, Express, Node.js and MongoDB. Players book cricket, tennis or padel. Staff manage the daily schedule, payment verification, check-in and revenue.

## Quick local demo

Use Node.js 22.12+ or Node.js 24, npm and a supported 64-bit MongoDB platform. From this directory run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally http://localhost:5173. With no MONGO_URI set, the development command downloads MongoDB 7.0.24 on first use and starts a single-node replica set. Its data persists in .playon/local-mongo. This needs a free port 27177 and access to MongoDB's download host. Set MONGOMS_SYSTEM_BINARY to an installed mongod executable to skip the download.

Run one development server at a time for this local database. If the database port is already in use by Play On, open the existing app or stop the previous dev server with Ctrl+C before restarting.

For players, open `/` and choose **Sign in**. Staff sign in at `/admin`. Enter the local demo credentials below.

| Role | Email | Password |
| --- | --- | --- |
| Player | player@playon.test | PlayOnDemo2026! |
| Admin | admin@playon.test | PlayOnDemo2026! |

Players can also register a separate account to test booking privacy. With the default accounts, use separate browser profiles or a private window to keep staff and player sessions open together.

## Persistent MongoDB with Docker Compose

Requires Node.js 22.12+ and Docker Compose v2. The local database port is bound to loopback.

```sh
cp .env.example .env
docker compose up -d --wait
npm ci
npm run build
npm start
```

Open http://localhost:4000. Express serves both the compiled React application and the API. MongoDB persists records and receipts in the named Docker volume. The health check initializes the local replica set. For hot reload with the same database, stop the server and run npm run dev. Use a replica set, including a MongoDB Atlas cluster, when supplying another MONGO_URI. Cross-date rescheduling uses transactions.

## Venue configuration

.env.example documents connection settings, the venue name, currency, time zone, transfer instructions, hold length and account setup. Set the venue's actual payment details before collecting payments. For a live environment use a private, authenticated MongoDB deployment, enable HTTPS, set SECURE_COOKIE=true, set DEMO_SEED=false, and initialize a staff account using ADMIN_EMAIL and ADMIN_PASSWORD. Bootstrap values only create missing accounts. Disabling demo mode blocks authentication and existing sessions for the two reserved demo identities.

The demo has one indoor and one outdoor court per sport. Starting rates are PKR 2,000/hour for cricket, 1,600 for tennis and 3,000 for padel; staff can set separate indoor and outdoor rates. Courts operate from 6:00 AM to midnight. Type the start and end times as hours and minutes, then select AM or PM for each. Use 12:00 with AM selected as the end time for a booking that ends at midnight. The default checkout hold lasts 10 minutes. The date picker, finance ranges and schedule use Asia/Karachi by default. Weekly reports run Monday through Sunday.

## Player and staff walkthrough

1. Choose a sport, court setting and date. Check the booked ranges, then enter your start and end times. The total uses the hourly rate and entered range. A 90-minute cricket booking initially quotes PKR 3,000.
2. Continue to payment, enter the registered player's name and 11-digit mobile number, and start the hold. Upload a JPG, PNG or PDF under the 5 MiB limit. The player can resume an unexpired checkout from `/my-bookings`.
3. Open Payments as staff. Review the receipt, amount and booking together. Approval unlocks the PDF invoice. Rejection requires a reason and immediately frees the court.
4. Open My bookings as the player to download the invoice. Use its booking ID in the staff Check-in tab, compare the court and time, confirm the registered mobile and mark the visit checked in. A second attempt shows the previous check-in time.
5. Use Schedule to reserve a paid or complimentary VIP booking or close a court, sport or day. A conflicting closure leaves the entire schedule intact. Staff can move an affected reservation to another available court or date and retry the closure. The booking ID, quoted price and verification history stay with the reservation.
6. In Finance, select the period and click a sport or overall amount to see the underlying verified payments. Complimentary visits have their own count and drill-down.

## Booking and accounting rules

- The server computes and snapshots hourly rate and total. It refuses a player hold when the submitted quote no longer matches the current rate.
- Each venue date has a MongoDB schedule document with a revision. Holds, reviews, same-day moves and closures compare and update the revision atomically. A retry reads the winning schedule and rechecks the entire interval. Adjacent bookings can meet at the same minute. Simultaneous requests for independent courts can both succeed.
- A hold's server timestamp determines availability. An abandoned checkout becomes available immediately upon expiry, without a cleanup timer. A successfully uploaded receipt holds the slot until staff review it.
- A separate private collection stores receipt bytes. The API checks the role and booking owner before serving receipts or invoices. Passwords use salted scrypt hashes and session cookies contain opaque random tokens.
- Revenue is the sum of unique approved booking records and paid VIPs in the selected date range. Finance defaults to booking date and also supports payment verification date. Demo records are included in finance like other bookings for testing. Check-in, invoice downloads, rate edits and rescheduling do not record additional revenue. Date ranges include the full end date.

## Verification

```sh
npm test
npx playwright install chromium
npm run test:browser
```

The integration suite starts a real isolated MongoDB replica set. It exercises concurrent overlap, independent courts, hold expiry, private receipts and invoices, snapshot pricing, rejection and release, repeat reviews and check-ins, cross-day moves, closures and finance totals. To use an existing test replica set, supply TEST_MONGO_URI. The API suite creates and removes its own uniquely named test database.

The browser test builds the frontend and drives a 360-pixel player screen and a desktop staff screen through booking, upload, approval, PDF download, check-in and revenue drill-down. Both suites accept MONGOMS_SYSTEM_BINARY. The browser test also accepts CHROMIUM_PATH for an installed Chromium executable. On Linux, Playwright may require browser system dependencies.

## Project layout

- src/main.jsx and src/shared.jsx contain the player experience, accounts and shared UI.
- src/staff.jsx contains the staff operations and finance views.
- server/app.js contains authorization, booking rules, reporting, receipt handling and PDF generation.
- server/start.js serves the compiled app. server/dev.js runs the development environment.
- api/index.js serves as the Vercel serverless function entrypoint.
- vercel.json configures the Vite frontend build, SPA fallback rewrites, and PDFKit asset bundling.
- test/flow.test.js and test/mobile.mjs contain the repeatable API and browser checks.

## Deploying to Vercel

The project is configured for seamless deployment on Vercel:
- **Frontend**: Vite compiles the React SPA to `dist/`, served globally via Vercel's CDN.
- **Backend**: Express runs inside a Vercel Serverless Function (`api/index.js`) using Node.js 22.x.
- **Routing**: SPA routes fallback to `index.html`, and `/api/*` requests route to the serverless function.
- **PDFKit**: Font metrics are included in the serverless bundle via `includeFiles` in `vercel.json`.

### 1. MongoDB Atlas Setup
Since Vercel functions are serverless, provide a hosted MongoDB connection string (such as a free [MongoDB Atlas](https://www.mongodb.com/atlas) M0/Serverless cluster):
- Ensure network access in MongoDB Atlas allows Vercel connections (`0.0.0.0/0` with database user authentication).

### 2. Configure Environment Variables in Vercel
In your Vercel Project Settings > **Environment Variables**, add:
- `MONGO_URI`: `mongodb+srv://<user>:<password>@cluster0.mongodb.net/playon?retryWrites=true&w=majority`
- `VENUE_NAME`: Venue name (e.g., `Play On Sports Club`)
- `VENUE_TIMEZONE`: Timezone (e.g., `Asia/Karachi`)
- `CURRENCY`: Currency code (e.g., `PKR`)
- `HOLD_SECONDS`: Reservation hold duration in seconds (e.g., `600`)
- `PAYMENT_INSTRUCTIONS`: Instructions displayed to players during checkout
- `ADMIN_EMAIL`: Staff email for initial login bootstrap
- `ADMIN_PASSWORD`: Strong password for the staff account
- `DEMO_SEED`: Set to `false` for production (or `true` if you wish to seed demo accounts)
- `SECURE_COOKIE`: `true` (automatically enabled when deployed on Vercel)

### 3. Deploy
Deploy either by:
- Pushing to a connected GitHub repository and importing into Vercel, or
- Running `npx vercel` directly from this directory.

