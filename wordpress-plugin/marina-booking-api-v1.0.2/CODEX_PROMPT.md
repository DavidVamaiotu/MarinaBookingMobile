# Codex prompt — Electron reception quote modes and local cache

You are editing the existing Electron desktop reception app for Marina Park. Do not replace the current timeline or booking workflow. Integrate the following API capability cleanly through the existing typed API client / Electron main-process network layer.

## API contract already deployed

Base URL: `<configured WordPress site>/wp-json/marina-booking/v1`

Authenticated endpoint:

```text
POST /prices/calculate
```

Request:

```ts
interface PriceQuoteRequest {
  resource_id: number;
  dates: string[]; // sorted ISO YYYY-MM-DD dates
  form_data: Record<string, { value: string | string[]; type?: string }>;
  booking_form_type?: string;
  mode?: "fast" | "full"; // defaults to "full"
}
```

`fast` is for active reception editing. It returns native Booking Calendar values needed to quote the guest:

```ts
interface FastQuote {
  mode: "fast";
  resource_id: number;
  input_dates: string[];
  chargeable_dates: string[];
  days: number;
  nights: number;
  last_checkout_day_excluded: boolean;
  coupon_discount: number;
  total: number;
  deposit: number;
  balance: number;
  formatted: {
    coupon_discount: string;
    total: string;
    deposit: string;
    balance: string;
  };
}
```

`full` is for review/confirmation and includes all `FastQuote` fields plus `base_cost`, `original_cost`, `additional_cost`, `advanced_cost_hints`, `coupon_description`, and the full formatted breakdown.

The server already has a short-lived private quote cache (fast: 60 seconds, full: 30 seconds). It returns `X-Marina-Price-Cache: HIT|MISS|BYPASS`. HTTP responses remain `no-store`; do not rely on browser/HTTP cache behavior.

## Required implementation

1. Add strict TypeScript types for fast and full quote responses. Use a discriminated union on `mode`.
2. Add `getPriceQuote(request, signal?)` to the existing API client. It must use the established authenticated request path, never expose credentials to the renderer, and support `AbortSignal` or equivalent request cancellation.
3. During active date dragging, date picking, or price-dependent form edits:
   - Debounce quote requests by 300 ms.
   - Abort the prior in-flight request when a new input replaces it.
   - Use `mode: "fast"`.
   - Ignore late/stale responses using a monotonically increasing request sequence ID.
4. When the user opens booking review, stops editing, or presses Save:
   - Request `mode: "full"`.
   - Display total, deposit, and balance from the returned native values. Do not calculate any of them in Electron.
   - Before creating/updating a booking, ensure a full quote has completed for the exact current normalized input. If it is older than 15 seconds, request it again.
5. Add a local quote cache in the Electron main process, backed by the app’s existing SQLite storage if available; otherwise use a small in-memory LRU cache. Do not put API credentials or customer details in renderer state unnecessarily.
   - Cache key = SHA-256 of a canonical JSON payload containing `resource_id`, sorted `dates`, recursively key-sorted `form_data`, `booking_form_type`, and `mode`.
   - Fast local TTL: 60 seconds. Full local TTL: 30 seconds.
   - Return a valid local cached quote immediately, then do not make a duplicate network call for the same key while it is valid.
   - Treat caches as an optimisation only. The server remains authoritative.
   - Do not persist a quote past its TTL. Delete expired records on read and periodically prune old rows.
   - Do not cache failed responses, aborted requests, or payloads that fail schema validation.
6. The UI must show a clear non-blocking state such as “Calculating…” while a new quote is pending, but retain the last valid quote visually with a subtle stale indicator until the new response arrives. Do not freeze the timeline.
7. Cache invalidation:
   - A changed resource, dates, booking form type, or any price-dependent field creates a new cache key naturally.
   - After an app settings change that changes the API base URL, clear local quote cache.
   - Add a single `clearQuoteCache()` function for future use; do not automatically clear every quote after booking status/note edits because those operations do not change pricing rules.
8. Add tests:
   - canonical cache key is independent of form-field object order;
   - fast quote debounces and cancels stale requests;
   - a cache hit makes zero network calls;
   - an expired quote fetches again;
   - full mode is requested before save when the quote is stale;
   - stale/late requests cannot overwrite the newest quote;
   - total/deposit/balance displayed are API values, not Electron math.

## Acceptance criteria

- Timeline remains responsive while the user changes dates.
- Receptionist receives total, deposit and balance quickly via `fast` mode.
- Full native quote is used for confirmation and save.
- No Booking Calendar pricing logic is duplicated in Electron.
- API credentials remain in Electron main process / secure storage only.
- No regression to the existing command queue, optimistic updates, or timeline UI.
