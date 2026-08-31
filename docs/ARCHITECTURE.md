# Arhitectură

## Fluxul datelor

```text
Timeline și panouri renderer
        |
        | IPC validat
        v
Proces principal Electron
        |
        +-- Camere  -> MarinaBookingProvider -> X-Workspace-ID: rooms ID
        +-- Camping -> MarinaBookingProvider -> X-Workspace-ID: camping ID
        |
        v
Marina Booking API /v1/*
```

Rendererul nu are acces la Node și nu face HTTP. Electron păstrează `contextIsolation`, sandbox,
Node dezactivat, CSP restrictiv și validarea intrărilor IPC.

## Workspace-uri

La pornire se creează două contexte Marina independente pentru `rooms` și `camping`. Ele împart
controlerul OAuth și stocarea securizată a tokenului, dar au clienți API și chei de cache separate.
Un răspuns dintr-un workspace nu poate popula calendarul celuilalt.

Dacă ID-ul nu este configurat explicit, clientul citește `GET /v1/workspaces` fără header de
workspace, selectează workspace-ul activ după slug și apoi atașează ID-ul rezolvat tuturor cererilor
scoped. ID-ul nu este adăugat niciodată în payload.

## Cache și sincronizare

SQLite stochează doar configurația publică persistată, refresh token-ul criptat și câte un snapshot
Marina pentru Camere și Camping. Nu există o coadă locală de scrieri sau mutații optimiste către un
al doilea provider. Citirea poate afișa ultimul snapshot când rețeaua lipsește; scrierile necesită o
conexiune API confirmată.

Actualizările folosesc versiunea rezervării și `If-Match`/`expected_version` conform endpoint-ului.
Schimbarea avansului este un PATCH fără email, iar cererea explicită de plată este o operație
separată și nu conține o sumă suprascrisă de client.

## Desktop și Android

Ambele suprafețe folosesc aceleași două workspace-uri, aceeași rezolvare după slug, aceleași headere
și chei de cache distincte. Interfața mobilă păstrează paritatea funcțională și layout-ul responsive,
inclusiv ecranele exterior/interior ale Samsung Galaxy Z Fold7.
