# Arhitectură

## Timeline-ul existent este păstrat

Aplicația sursă folosea un timeline cu grid CSS personalizat, nu o bibliotecă de calendar:

- obiectele `unit` reprezentau rândurile spațiilor;
- obiectele `stay` reprezentau barele rezervărilor;
- `timelineLaneItems()` atribuia suprapunerile unor sub-linii deterministe;
- rândurile erau virtualizate peste 60 de spații, cu overscan;
- corpul barei deschide detaliile, iar mânerele invizibile de la margini redimensionează sosirea/plecarea;
- vizualizarea folosea o fereastră orizontală tamponată de mai multe luni și etichete fixe pentru spații.

Desktopul păstrează aceste mecanisme și stilul plannerului Parkline Web în `app.js` și `styles.css`. Folosește fereastra tamponată de nouă luni, scala săptămânală/zilnică, lățime dinamică pentru zile, etichete fixe, linii compacte, gestionarea rezervărilor adiacente și recentrarea la margini. `src/shared/timeline-adapter.js` este limita dintre API și liniile/elementele timeline-ului.

## Limitele proceselor

```text
Timeline și panouri în renderer
        |
        | intenții IPC validate
        v
Procesul principal Electron
  Camere:  BookingService -> marina-booking.sqlite -> marinapark.ro
  Camping: BookingService -> marina-booking-camping.sqlite -> camping.marinapark.ro
           fiecare cu CommandQueue, credențiale și MarinaApiClient proprii
```

Rendererul nu are acces la Node și nu face HTTP. Izolarea contextului, sandbox-ul, Node dezactivat, CSP restrictiv, permisiunile refuzate, validarea HTTPS și validarea implicită a certificatelor rămân active.

## Date locale și coadă

SQLite stochează `resources`, `bookings`, `booking_dates`, `booking_form_data`, `booking_notes`, `optimistic_overlays`, `commands` și `sync_errors` normalizate. Modul WAL păstrează tranzacțiile UI scurte.

Camere și Camping folosesc baze locale separate. Această limită este obligatorie deoarece cele două site-uri WordPress pot avea aceleași ID-uri de resurse, rezervări și comenzi. Camping păstrează toate resursele și rezervările returnate de API, cu check-in la 14:00, apoi le grupează vizual în exact două rânduri fixe: Corturi și Rulote. ID-ul API original rămâne pe rezervare pentru editare și sincronizare. Camere păstrează fluxul existent și check-in-ul la 15:00. La creare, Camping trimite ID-ul resursei părinte Corturi sau Rulote, iar Booking Calendar alege prima resursă părinte/copil liberă pentru întregul interval, conform priorității din WordPress. Clientul nu aplică înainte verificarea binară `/availability`, deoarece aceasta este destinată resurselor individuale și nu modelează sigur capacitatea părinte; endpoint-ul de creare WordPress rămâne autoritatea finală pentru alocare și acceptare.

Citirea inițială acoperă fereastra timeline-ului de nouă luni. `loaded_ranges` reține momentul în care un interval complet a fost verificat. Pornirea și temporizatorul local de cinci minute reutilizează imediat SQLite și fac GET doar când intervalul lipsește sau este mai vechi de 15 minute; butonul Actualizează forțează verificarea. Deplasarea în fereastra tamponată nu interoghează API-ul. O reîmprospătare completă reconciliază local rezervările lipsă, păstrând modificările optimiste și conflictele.

Fiecare modificare salvează starea optimistă și comanda într-o singură tranzacție locală. Coada procesului principal trimite în fundal. Comenzile rămân ordonate pentru rezervare și spațiu; spații diferite pot folosi până la trei sloturi concurente. Editările și notele nesincronizate se combină, dar creările nu.

Dialogul de creare nu calculează bani local. Schimbările de date, spațiu, număr de persoane sau pat suplimentar declanșează un calcul `fast` temporizat la 300 ms; cererea anterioară este anulată, iar răspunsurile întârziate sunt ignorate. Cache-ul LRU din memorie păstrează calculele `fast` 30 de secunde și `full` 15 secunde. Revizuirea detaliată folosește `full`, iar creare/editare/redimensionare cer un calcul `full` proaspăt înainte de salvare.

Stările sunt `queued`, `sending`, `synced`, `failed`, `conflict` și `needs_attention`. Comenzile `sending` întrerupte revin în `queued` la pornire. Erorile temporare și HTTP 5xx/429 folosesc backoff exponențial cu jitter. Erorile de autentificare opresc coada. Comenzile rețin endpoint-ul API normalizat; schimbarea endpoint-ului izolează comenzile din coadă până când fiecare este verificată și reîncercată explicit către noua țintă.

UUID-ul comenzii de creare este atât `external_id`, cât și `Idempotency-Key`. După un timeout necunoscut, coada reconciliază prin endpoint-ul exact pentru external ID înainte de a reîncerca aceeași cheie. Nu creează o cheie nouă pentru aceeași operație.

Actualizările remote nu înlocuiesc overlay-urile optimiste. O rezervare de pe server modificată sau lipsă în timpul scrierilor locale devine un conflict explicit.
