# Marina Booking Desktop

Aplicație Electron și Android pentru administrarea rezervărilor prin Marina Booking API.

Interfața are doar două spații de lucru:

- **Camere**, asociat workspace-ului API cu slug `rooms`;
- **Camping**, asociat workspace-ului API cu slug `camping`.

Ambele folosesc același OAuth și același API de bază. Datele și cache-urile lor sunt izolate prin
headerul `X-Workspace-ID`; aplicația nu include `workspace_id` în corpurile cererilor.

## Configurare

Configurația publică este furnizată la build sau prin mediu:

```text
MARINA_INTEGRATION_ENABLED=true
MARINA_API_BASE_URL=https://booking.husi.ro
MARINA_OAUTH_CLIENT_ID=...
MARINA_OAUTH_SCOPES=resources:read resources:write bookings:read bookings:write
MARINA_ROOMS_WORKSPACE_ID=
MARINA_CAMPING_WORKSPACE_ID=
```

ID-urile workspace-urilor sunt opționale. Dacă lipsesc, aplicația apelează `GET /v1/workspaces` și
rezolvă ID-urile după slug. Pentru Camere acceptă și workspace-ul implicit ca fallback de
compatibilitate; Camping necesită slug `camping`.

## Dezvoltare și verificare

Necesită Node.js 22.5+.

```bash
npm install
npm run check
npm test
npm run mobile:web
npm start
```

Verificările trebuie făcute local, cu răspunsuri sintetice. Nu se fac scrieri de test pe datele de
producție.

## Build

```bash
npm ci
npm run check
npm test
npm run dist
npm run mobile:apk
```

Instalatorul Windows este scris în `dist-electron/`. Android folosește același contract API și
păstrează refresh token-ul în Android Keystore. Desktop folosește Electron `safeStorage`; fallback-ul
Linux `basic_text` este respins.

Pentru release rulează `./bump`. Scriptul aliniază versiunile desktop/mobile, verifică proiectul și
publică același tag în repository-urile configurate.

Vezi [contractul API](docs/MARINA-API-CONTRACT.md), [arhitectura](docs/ARCHITECTURE.md) și
[lista de verificare manuală](docs/MANUAL-TEST-CHECKLIST.md).
