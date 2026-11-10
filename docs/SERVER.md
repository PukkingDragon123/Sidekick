# Sidekick server

One Node process that gives the Sidekick clients everything that cannot live on a device:
accounts and device pairing, the synced save, live presence and the teleport between devices,
school imports (Google Classroom, Microsoft Teams for Education, iCal feeds), the sidekick's
AI chat and planner, reminders and push notifications, and the optional Plus subscription.

It also serves the built web client (`web/dist`) when that exists, so one port is all you deploy.

- [Run it](#run-it)
- [Configuration](#configuration)
- [What the API does beyond the types](#what-the-api-does-beyond-the-types)
- [Google Classroom](#google-classroom)
- [Microsoft Teams for Education](#microsoft-teams-for-education)
- [Calendar feeds (Canvas, Moodle, Schoology, ...)](#calendar-feeds-canvas-moodle-schoology-)
- [AI](#ai)
- [Push and reminders](#push-and-reminders)
- [Sidekick Plus (Stripe)](#sidekick-plus-stripe)
- [Security notes](#security-notes)
- [Tests, and what they do and do not prove](#tests-and-what-they-do-and-do-not-prove)

## Run it

Requirements: Node 22.13 or newer (the server uses the built-in `node:sqlite`). Nothing else to
install: no database server, no Redis.

```bash
npm install                # once, at the repository root
cp .env.example .env       # optional; every variable is optional
npm run dev:server         # tsx watch, restarts on change
npm run start              # plain start
```

The server listens on `PORT` (default 8787) for both HTTP and WebSocket (`/ws`). On start it
prints which optional capabilities are on. `GET /api/health` reports the same to clients.

To serve the web client from the same port, build it first (`npm run build`); the server picks
up `web/dist` as soon as it exists and falls back to `index.html` for client-side routes.
During development the Vite dev server (`npm run dev:web`, port 5173) talks to the API across
origins, which is why `http://localhost:5173` is the default in `CORS_ORIGINS`.

Data lives in `server/data/` (ignored by git): `sidekick.db` and, unless `SIDEKICK_SECRET` is
set, `secret.key`. Back both up; the database without the key cannot decrypt the stored school
credentials. Node prints an `ExperimentalWarning` about SQLite at start; that is expected on
Node 22.

Behind a reverse proxy: forward WebSocket upgrades for `/ws`, do not buffer
`/api/ai/chat` (it is a server-sent event stream; the server sends `X-Accel-Buffering: no` for
nginx), set `PUBLIC_URL` to the outside URL, and set `TRUST_PROXY=true` so rate limiting sees
real client addresses.

## Configuration

Everything is set through environment variables; `.env.example` lists and explains all of them.
The short version:

| Area | Variables | Without them |
| --- | --- | --- |
| Core | `PORT`, `HOST`, `PUBLIC_URL`, `CORS_ORIGINS`, `TRUST_PROXY`, `AUTH_RATE_MAX` | sensible local defaults |
| Storage | `SIDEKICK_DATA_DIR`, `SIDEKICK_DB`, `SIDEKICK_SECRET` | `server/data`, generated key file |
| AI | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, `SIDEKICK_MODEL`, `SIDEKICK_CHAT_EFFORT`, `SIDEKICK_PLAN_EFFORT`, `AI_FREE_PER_DAY`, `AI_PLUS_PER_DAY`, `SIDEKICK_FALLBACKS`, `SIDEKICK_EAGER_TOOL_INPUT` | chat answers `no_ai`, plans come from the offline planner |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Connect Google Classroom" is off |
| Microsoft | `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | "Connect Teams" is off |
| OAuth | `OAUTH_BROWSER_BINDING` | on |
| Sync | `AUTO_SYNC_MINUTES` | sources are pulled only when a client asks |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | a key pair is generated and stored |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Plus cannot be bought |

A provider counts as configured only when all of its variables are present; half a
configuration behaves like none. Invalid values (an unknown effort level, a non-numeric port)
stop the server at start with a message naming the variable.

## What the API does beyond the types

`shared/src/api.ts` is the contract. These are the behaviours it does not spell out.

**Errors.** Every failure is `{ "error": "<sentence a person can read>", "code": "<stable id>" }`
with a matching HTTP status. Codes in use: `unauthorized` (401), `invalid_json`,
`invalid_body`, `bad_code`, `blocked_url`, `feed_unreachable`, `feed_error`, `too_many` (400),
`not_found` (404), `no_state` (409), `too_large` (413), `rate_limited` (429, with
`Retry-After`), `not_configured`, `no_billing` (503), `billing_failed` (502), `bad_signature`
(400), `internal` (500).

**No save, no server-side changes.** The server never invents a save. Until a device has done
its first `PUT /api/state`, `GET /api/state` returns `{ "state": null }`, and sync, plan and chat
answer `no_state` (chat as an `error` event with code `failed`).

**State.** `PUT /api/state` runs `mergeState(serverCopy, incoming)`, overwrites `premium` from
the server's own record, trims `chat` to the last 60 messages and returns the result. Section
stamps and task `updatedAt` values more than five minutes ahead of the server clock are pulled
back to that limit, so one device with a wrong clock cannot pin a section forever. Unknown extra
fields in the save are stored and returned untouched. Bodies are limited to 4 MB for the save and
64 KB elsewhere (512 KB for the Stripe webhook).

**WebSocket.** Connect to `/ws?token=<device token>`. A missing or unknown token completes the
handshake and is then closed with code **4401**, so a browser can tell "sign in again" from "the
network is down". On connect you always get `presence`; if this connection made the device the
new host because the previous host is offline, a `teleport` with `from: null` follows it. For
`summon` and `release` the order is `teleport`, then `presence`. `from` is the previous host only
when that device is online (it is the one that plays the dissolve); otherwise it is `null`.
`release` from a device that is not the host, or when no other device is online, does nothing.
`ping` is recorded as activity ("most recently active device") and not answered. `state` messages
go to the account's other devices, never back to the device whose request caused the change;
changes with no device behind them (scheduler, billing webhook) go to all of them.

**Integrations.**
- `GET /api/integrations/:provider/start?return=<app url>` returns `{ url }` and also sets a
  short-lived HttpOnly cookie scoped to the callback path. The callback only completes in a
  browser that presents that cookie (see [Security notes](#security-notes)). Same-origin calls
  need nothing special. A client on another origin must make this one request with
  `credentials: 'include'` (the server allows credentials for origins in `CORS_ORIGINS`).
- After the consent page, the browser lands on `return` (or on `PUBLIC_URL/` if `return` is
  missing or not one of our own origins) with `?integration=<provider>&status=ok`, or
  `status=error&reason=denied | expired | browser_mismatch | exchange_failed | too_many |
  not_configured`. The client should then call `POST /api/integrations/sync`.
- `POST /api/integrations/ics` fetches and parses the feed before storing anything, imports it,
  and answers with a `SyncRes` plus `integration: IntegrationInfo`. `webcal://` links are
  accepted. Adding the same link again updates the existing source.
- `DELETE /api/integrations/:id` answers `{ "ok": true }`. Tasks that were imported stay; they
  carry the student's notes and progress.
- Imports only write what the source owns (title, course, description, due, url, points) and
  may flip `done` to true. Items whose deadline passed more than 14 days ago are not added, and
  one source holds at most 300 open tasks at a time (nearest deadlines first; the rest is
  reported in `errors` and picked up as places free up).

**Chat.** `POST /api/ai/chat` always answers `200 text/event-stream` once the request itself
is valid; problems arrive as an `error` event (`no_ai`, `limit`, `failed`). Text arrives as
`text` deltas; `done.message.text` is the authoritative final text. After an `error` event any
text already shown should be discarded. `state` events carry the whole save after a tool changed
it. The user message and the reply are appended to `state.chat` only when the turn succeeds.

**Push.** `POST /api/push/subscribe` answers `{ "ok": true }`; `POST /api/push/test` answers
`{ "ok": true, "sent": <n> }`. The decrypted payload a service worker receives is JSON:
`{ "title": string, "body": string, "taskId"?: string, "tag"?: string }` (`tag` lets a newer
notice replace an older one about the same thing).

**Billing.** `POST /api/billing/checkout` takes an optional `{ "return": "<app url>" }` and the
browser comes back with `?plus=success` or `?plus=cancelled`. Premium changes reach clients as
a `state` message.

## Google Classroom

Read-only. Scopes requested: `openid`, `email`,
`https://www.googleapis.com/auth/classroom.courses.readonly`,
`https://www.googleapis.com/auth/classroom.coursework.me.readonly`.
Calls made: `courses.list` (`studentId=me`, `courseStates=ACTIVE`), `courses.courseWork.list`
and `courses.courseWork.studentSubmissions.list` (course work id `-`, `userId=me`) per course.

Set it up in the [Google Cloud console](https://console.cloud.google.com/). Menu names move
around from time to time; the steps are:

1. **Project.** Create a project (or pick one) in the project selector at the top.
2. **Enable the API.** *APIs & Services → Library*, search for **Google Classroom API**, open it,
   press **Enable**.
3. **Consent screen.** *APIs & Services → OAuth consent screen* (in newer consoles: *Google
   Auth Platform → Branding / Audience / Data Access*).
   - *User type / Audience*: **Internal** if the project belongs to the school's own Google
     Workspace and only that school will use it (no Google review needed). **External** for
     anyone else.
   - App name, user support e-mail, developer contact.
   - *Scopes / Data Access → Add or remove scopes*: add the four scopes listed above. The two
     Classroom scopes are classed as sensitive.
   - *External* apps start in **Testing**: add every student account under *Test users* (up to
     100), and note that Google expires refresh tokens of testing apps after 7 days, so students
     will have to reconnect weekly until the app is published. Publishing an app with sensitive
     scopes requires Google's verification.
4. **OAuth client.** *APIs & Services → Credentials → Create credentials → OAuth client ID*.
   - Application type: **Web application**.
   - *Authorized redirect URIs → Add URI*: `<PUBLIC_URL>/api/integrations/google/callback`
     exactly, for example `http://localhost:8787/api/integrations/google/callback` for local
     work and `https://sidekick.example.org/api/integrations/google/callback` in production.
     (Authorized JavaScript origins are not needed.)
   - **Create**, then copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` and
     `GOOGLE_CLIENT_SECRET`. Restart the server; `/api/health` should now say `"google": true`.
5. **School accounts need their admin's blessing.** In Google Workspace for Education the
   administrator decides which third-party apps may touch student data, and accounts marked as
   under 18 are blocked from any app the admin has not configured. The admin has to, in the
   [Admin console](https://admin.google.com/):
   - *Security → Access and data control → API controls → Manage third-party app access →
     Configure new app*, find the app by its OAuth client ID, and give it **Trusted** (or
     limited) access for the relevant organisational units;
   - *Apps → Google Workspace → Classroom → Data access*: allow users to authorise apps to
     access their Classroom data.
   Until that is done students see "Access blocked: your institution's admin needs to review
   this app" instead of the consent page.

What students see: a Google consent page asking to view their classes and their own course work
and grades. Nothing can be changed in Classroom through these scopes.

How deadlines are read: Classroom reports `dueDate` and `dueTime` in UTC, with zero-valued
fields omitted. A date with no time at all is treated as the end of that UTC day. A submission
in state `TURNED_IN` or `RETURNED` marks the task done.

## Microsoft Teams for Education

Read-only, through Microsoft Graph. Scopes requested: `offline_access openid email User.Read
EduAssignments.ReadBasic EduRoster.ReadBasic`. Calls made:
`GET /education/me/classes` (class names), `GET /education/me/assignments?$expand=submissions`,
and, only for assignments whose submissions did not come back expanded,
`GET /education/classes/{classId}/assignments/{id}/submissions`.

Set it up in the [Microsoft Entra admin center](https://entra.microsoft.com/):

1. *Identity → Applications → App registrations → New registration*.
   - Name: e.g. "Sidekick".
   - *Supported account types*: **Accounts in any organizational directory (Any Microsoft
     Entra ID tenant - Multitenant)**. This matches the default sign-in authority
     `organizations`. If you register it for a **single tenant** (one school), set `MS_TENANT`
     to that tenant's ID or domain. Personal Microsoft accounts cannot use the education API.
   - *Redirect URI*: platform **Web**, value `<PUBLIC_URL>/api/integrations/microsoft/callback`.
   - **Register**.
2. On the app's *Overview* page copy **Application (client) ID** into `MS_CLIENT_ID`.
3. *Certificates & secrets → Client secrets → New client secret*. Copy the secret's **Value**
   (not the "Secret ID") into `MS_CLIENT_SECRET` right away; it is shown once. Note its expiry
   date: when it lapses, connecting and refreshing stop working until you create a new one.
4. *API permissions → Add a permission → Microsoft Graph → Delegated permissions*, and add
   `offline_access`, `openid`, `email`, `User.Read`, `EduAssignments.ReadBasic`,
   `EduRoster.ReadBasic`.
5. **Admin consent is normally required.** The two `Edu*` permissions need an administrator's
   approval, and most school tenants do not let students consent to apps at all. A student who
   tries before that sees "Need admin approval". Each school's tenant admin has to grant consent
   once, either
   - in their own tenant: *Enterprise applications → (the app) → Permissions → Grant admin
     consent*, or, if they own the registration, the **Grant admin consent for …** button on the
     *API permissions* page; or
   - by opening
     `https://login.microsoftonline.com/<their-tenant-id-or-domain>/adminconsent?client_id=<MS_CLIENT_ID>`
     while signed in as an admin. Afterwards Microsoft sends the browser to the app's redirect
     URI without a sign-in in progress, so landing on Sidekick with
     `?integration=microsoft&status=error&reason=expired` at that point is expected and harmless.
6. Restart the server; `/api/health` should say `"microsoft": true`.

The school has to be using Assignments in Teams for Education; a tenant without the education
workload answers Graph's education endpoints with an error, which the app shows as "Your school
may need to approve this app first" (403).

How status is read: a submission that is `submitted`, `returned` or `excused` marks the task
done; `working` and `reassigned` (handed back for another attempt) do not. Without roster
access the assignments still import, only without class names.

## Calendar feeds (Canvas, Moodle, Schoology, ...)

Any iCalendar (`.ics`) feed works: `POST /api/integrations/ics { url, label }`. The link
contains a private token, so the server stores it encrypted and never logs it. Where to find it:

- **Canvas**: open **Calendar** in the left-hand navigation; at the bottom of the right-hand
  column click **Calendar Feed** and copy the address in the box.
- **Moodle**: open the **Calendar** (Dashboard → Calendar, or the calendar block → "Full
  calendar"), choose **Import or export calendars** (older versions: **Export calendar**), pick
  *All events* and a time range such as *Recent and next 60 days*, then press **Get calendar URL**
  and copy it. If the button is missing, the site administrator has switched calendar export off.
- **Schoology**: click your name (top right) → **Settings** → under *Share Your Schoology
  Calendar* choose **Enable**, save, and copy the link that appears (it starts with `webcal://`,
  which is fine).
- **Google Calendar**: *Settings → (the calendar) → Integrate calendar → Secret address in iCal
  format*.
- **Outlook / Microsoft 365**: *Settings → Calendar → Shared calendars → Publish a calendar*,
  then copy the **ICS** link.

What is read: `VEVENT` and `VTODO`, with line unfolding, escaped text, UTC times, `TZID` times
(IANA names, Windows names such as "Eastern Standard Time", and prefixed forms), floating times
(in the feed's `X-WR-TIMEZONE`, else the student's zone) and all-day dates (due at 23:59 that
day). Canvas's `Title [Course]` and Moodle's `CATEGORIES` become the course. Cancelled events
are skipped. Not handled: recurrence rules are not expanded (a repeating event is read at its
first occurrence, plus any individually moved instances), and custom `VTIMEZONE` definitions are
not interpreted (the `TZID` has to be a known zone name).

## AI

Enabled only when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set. A base URL alone, or a
CLI login on the machine, deliberately does not turn it on.

- **Model**: `claude-opus-5-5` unless `SIDEKICK_MODEL` says otherwise, with adaptive thinking.
  Effort is `low` for chat and `medium` for planning.
- **Refusal fallbacks are on by default.** Every request carries `fallbacks: "default"` and the
  `server-side-fallback-2026-07-01` beta header: if a safety classifier declines a request, the
  API re-runs it on the model Anthropic recommends for that case instead of handing the student
  an error. Set `SIDEKICK_FALLBACKS=off` to send neither.
- **Chat** is a streaming tool loop. The model can call `add_task`, `update_task`,
  `complete_task`, `set_reminder`, `save_plan` and `emote`. Tool schemas are strict; inputs are
  validated again on the server before they run; a tool call is never run from a turn that
  ended in a refusal or was cut off by the token limit. The tools never set `rewarded`.
- **Prompt caching**: the system prompt is three blocks. The rules (shared by everyone) and
  the persona (species, names) carry cache breakpoints; the notes that change with every
  message (local time, open tasks with ids, streak, the pet's needs) come after the last
  breakpoint. Each model call logs one line with `cache_read` / `cache_write` token counts, which
  is how you check caching still works after editing a prompt.
- **Planning** uses structured output and falls back to the offline planner from `shared`
  whenever the model cannot answer; `plan.source` says which one produced the plan.
- **Limits**: `AI_FREE_PER_DAY` / `AI_PLUS_PER_DAY` messages per account per UTC day. Calls that
  fail on our side are not counted.
- Prompts live in `server/src/ai/prompt.ts`; the tool definitions in `server/src/ai/tools.ts`.

## Push and reminders

Standard Web Push (VAPID, `aes128gcm`). The client fetches the public key from
`GET /api/push/key`, subscribes in its service worker and posts the subscription to
`POST /api/push/subscribe`. Subscriptions that a push service reports as gone (404/410) are
removed.

Once a minute the scheduler, per account:

- fires reminders whose time has come (once each; a reminder that is more than 12 hours late,
  because the server was down, is marked done without a notification);
- if `settings.notifyDueSoon`: sends one nudge when an open task comes within 24 hours of its
  deadline and one when it comes within 2 hours. Several tasks crossing a line in the same minute
  share one notification. Move a deadline and the nudges are owed again;
- if `settings.notifyDaily`: sends the daily briefing at `settings.dailyAt` in `settings.tz`
  (or up to two hours late if that minute was missed).

Every notification goes to all of the account's push subscriptions and, as a `notify` message,
to its open sockets. The text is short and signed with the active sidekick's name.

## Sidekick Plus (Stripe)

Optional. With all three variables set, `/api/health` says `"billing": true`.

1. In the Stripe dashboard create a **Product** ("Sidekick Plus") with a **recurring price** and
   copy the price ID (`price_…`) into `STRIPE_PRICE_ID`.
2. *Developers → API keys*: put the secret key into `STRIPE_SECRET_KEY`. A restricted key that
   can only write Checkout Sessions is enough.
3. *Developers → Webhooks → Add endpoint*: URL `<PUBLIC_URL>/api/billing/webhook`, events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy the endpoint's signing
   secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
4. Locally: `stripe listen --forward-to localhost:8787/api/billing/webhook` prints a signing
   secret to use while it runs.

Plus is on while the subscription is `active` or `trialing`. The webhook is the only thing that
changes `premium`; a client cannot set it.

## Security notes

- **Device tokens** are random 256-bit values; only their SHA-256 is stored. Pair codes are six
  characters, valid for ten minutes, single use, and asking for a new one cancels the old one.
  Registration and code entry are rate limited per IP address.
- **Credentials at rest** (OAuth tokens, feed links, the VAPID private key) are sealed with
  AES-256-GCM under `SIDEKICK_SECRET` or the generated key file.
- **OAuth**: authorization-code flow with PKCE (S256) and a single-use `state` that expires
  after ten minutes. On top of that the flow is bound to the browser that started it with an
  HttpOnly, SameSite=Lax cookie. Without that binding someone could start a flow for their own
  Sidekick account, send the consent link to a classmate, and end up with that classmate's
  course work attached to their account. `OAUTH_BROWSER_BINDING=off` exists for clients that
  cannot finish in the same browser; prefer changing the client.
- **Server-side requests to user-supplied URLs** (calendar feeds, push endpoints) go through a
  guard: http/https only, no credentials in the URL, every address the host resolves to must be
  public (loopback, private, link-local, CGNAT, multicast, documentation ranges and their IPv6
  equivalents are refused), the connection is pinned to the address that was checked, redirects
  are re-checked hop by hop (three at most), and responses are capped at 5 MB and 15 seconds.
- **Links from feeds** are passed to clients only if they are http(s).
- **Logs** contain request paths, status codes, error classes and token counts. They do not
  contain tokens, keys, feed links, e-mail addresses or anything a student or the model wrote.
- **CORS** is limited to `CORS_ORIGINS`. The API authenticates with a bearer token, not with
  cookies, so cross-site requests carry no ambient authority.
- Text from teachers and feeds reaches the model as data inside the notes block, and the system
  prompt says to treat it as information only. The tools can change nothing outside the
  student's own task list, reminders and plan.

## Tests, and what they do and do not prove

```bash
npx vitest run             # from the repository root
npx tsc -p server --noEmit
```

Each test boots a real server on a random port with an in-memory database, a fake clock, and
fakes injected for everything outside the process. What that means for each area:

- **Proven end to end in tests**: accounts, pairing, state merge, WebSocket presence and
  teleport, the iCal parser, the import rules, the SSRF guard (including its real socket path
  against a local server), the scheduler, Web Push encryption (payloads are decrypted with the
  subscription keys), the Stripe signature check, static file serving.
- **Tested against fixtures only, never against the real service**: Google's OAuth and
  Classroom API, Microsoft's OAuth and Graph API, Stripe's API, and real push services. The
  fixtures follow the response shapes in the official documentation; they are not recordings.
- **Tested against a scripted API, never a live model**: the chat tool loop and the planner run
  through the real Anthropic SDK with a scripted transport, so request shapes and stream handling
  are exercised, but no test shows how a model actually behaves with these prompts.
