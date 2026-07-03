# Architecture

## Existing timeline retained

The source application used a custom CSS grid timeline rather than a calendar dependency:

- `unit` objects were resource rows.
- `stay` objects were booking bars.
- `timelineLaneItems()` assigned overlapping stays to deterministic sub-lanes.
- rows were virtualized above 60 resources with overscan.
- bar bodies moved stays; invisible edge handles resized arrival/departure.
- the view used a buffered multi-month horizontal window and sticky resource labels.

The desktop app keeps those mechanics and CSS concepts in `app.js` and `styles.css`. `src/shared/timeline-adapter.js` is now the boundary that maps normalized API resources/bookings to timeline lanes/items. No replacement calendar implementation was introduced.

## Process boundaries

```text
Renderer timeline and panels
        |
        | narrow validated IPC intents
        v
Electron main process
  BookingService -> SQLite normalized state
                 -> durable CommandQueue
                 -> MarinaApiClient -> HTTPS Marina Booking API v1.0.2+
```

The renderer has no Node access and performs no HTTP. `contextIsolation`, sandboxing, disabled Node integration, restrictive CSP, denied permissions, HTTPS validation, and default certificate validation remain enabled.

## Local data and queue

SQLite stores normalized `resources`, `bookings`, `booking_dates`, `booking_form_data`, `booking_notes`, `optimistic_overlays`, `commands`, and `sync_errors`. WAL mode keeps short UI transactions responsive.

Every mutation first commits its optimistic booking state and command in one local transaction. The main-process queue then sends in the background. Commands remain ordered for both booking and resource; different resources can use up to three concurrent slots. Unsent edits and notes coalesce, creates never do.

States are `queued`, `sending`, `synced`, `failed`, `conflict`, and `needs_attention`. Interrupted `sending` commands return to `queued` at startup. Temporary failures and HTTP 5xx/429 use bounded exponential backoff with jitter. Authentication failures pause the queue.

Create command UUID equals both `external_id` and `Idempotency-Key`. After an unknown timeout, the queue reconciles by the exact external-ID endpoint before retrying the same key. It never creates a new key for that operation.

Remote refreshes do not replace optimistic overlays. A changed or missing server booking while local writes are pending becomes an explicit conflict.
