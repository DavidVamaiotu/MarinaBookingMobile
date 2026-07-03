# Marina Booking Desktop

A focused Electron desktop client for WordPress Booking Calendar reservations through **Marina Booking API v1.0.2+**. It preserves the existing Parkline timeline interaction model while replacing the legacy local property-management server with a secure API-only main process.

## Development

Requirements: Node.js 22.5+ and an OS credential service available to Electron (Windows Credential Protection, macOS Keychain, or a Linux Secret Service implementation).

```bash
npm install
npm test
npm run check
npm start
```

On first launch, open Settings and enter:

- API URL ending in `/wp-json/marina-booking/v1`
- the dedicated WordPress API username
- its Application Password
- the site timezone, normally `Europe/Bucharest`

The password is encrypted with Electron `safeStorage` and kept in the application’s local SQLite database only as encrypted bytes. The app rejects Electron’s insecure Linux `basic_text` fallback. It is never returned through IPC.

## Production build

```bash
npm ci
npm test
npm run check
npm run dist
```

The Windows NSIS installer is written to `dist-electron/`. Runtime state is stored under Electron’s per-user `userData` directory, not beside the installed application.

## Scope

Included: visible-range timeline, create/edit, drag/resize, approved/pending status, notes, trash/restore, availability validation, optimistic local updates, restart-safe queue, diagnostics, secure settings, and API-backed refresh.

Excluded: WordPress plugin administration, form builders, payment configuration, email-template configuration, permanent deletion, direct WordPress database access, and all legacy Marina Park bar/receipt/statistics/local-server features.

See [Architecture](docs/ARCHITECTURE.md), [API compatibility](docs/API-COMPATIBILITY.md), and [manual test checklist](docs/MANUAL-TEST-CHECKLIST.md).
