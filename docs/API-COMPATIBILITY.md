# API compatibility

The desktop app targets Marina Booking API **v1.0.2 or newer**.

v1.0.2 provides the capabilities required for safe offline creates:

- required `Idempotency-Key` on every write
- persisted response replay and payload mismatch rejection
- required immutable `external_id` for creates
- exact lookup through `/bookings/by-external-id/{external_id}` (and query lookup)
- reconciliation through Booking Calendar `sync_gid`

No API plugin change was needed after inspecting `/home/david/Downloads/marina-booking-api-v1.0.2`.

Older v1.0.0/v1.0.1 copies are not safe for automatic create retry after an unknown timeout and are intentionally unsupported.

One remaining contract limitation is availability validation for an edit: `/availability` has no `exclude_booking_id`. The client checks only newly introduced dates when the resource is unchanged, then relies on the Booking Calendar edit endpoint for final validation. If the resource changes, all dates are checked.

The list endpoint’s maximum page size is 100; the client paginates until a short page is returned.
