# Compatibilitate API

Aplicația desktop folosește Marina Booking API **v1.0.5 sau mai nou**.

Pluginul trebuie instalat separat pe ambele site-uri WordPress. Faptul că `camping.marinapark.ro` folosește Booking Calendar nu expune automat namespace-ul `/wp-json/marina-booking/v1`; fără plugin și o parolă de aplicație dedicată, fila Camping rămâne doar cu structura locală Corturi/Rulote și nu citește sau scrie rezervări.

v1.0.2 oferă funcțiile necesare pentru crearea sigură offline:

- `Idempotency-Key` obligatoriu la fiecare scriere
- replay persistent al răspunsurilor și respingerea payload-urilor diferite
- `external_id` imuabil și obligatoriu la creare
- căutare exactă prin `/bookings/by-external-id/{external_id}` și prin query
- reconciliere prin `sync_gid` Booking Calendar

v1.0.4 adaugă modurile `fast` și `full` pentru contractul read-only `POST /prices/calculate`. Desktopul folosește calcule `fast` anulate și temporizate în timpul editării și un calcul `full` proaspăt înainte de creare sau editare. Headerele de cache ale serverului sunt păstrate doar pentru diagnostic.

v1.0.5 adaugă `GET /bookings/{id}/payment`, `PATCH /bookings/{id}/deposit` și `POST /bookings/{id}/payment-request`. Scrierile sunt idempotente; actualizarea avansului schimbă atomic costul nativ Booking Calendar și fragmentul `Avans / Cost / Rest`, iar emailul de plată poate rămâne în coada persistentă până când actualizarea avansului este confirmată.

Pentru Camping, `GET /resources` trebuie să expună relația `parent_id` pentru resursele copil. `POST /prices/calculate` și `POST /bookings` trebuie să accepte ID-ul resursei părinte, iar crearea trebuie să păstreze selecția WordPress a primei resurse părinte/copil disponibile în ordinea priorității configurate. Clientul nu blochează crearea Camping prin `POST /availability`: contractul binar este folosit pentru resurse individuale, iar validarea finală a capacității părinte rămâne în operația atomică de creare Booking Calendar.

v1.0.3 și versiunile mai vechi nu oferă modurile necesare pentru prețuri, astfel că dialogul de creare necesită upgrade la v1.0.4. Copiile v1.0.0/v1.0.1 nu sunt sigure pentru reîncercarea automată a unei creări după un timeout necunoscut.

La editare, clientul verifică întregul interval nou prin `/availability` și trimite `exclude_booking_id` cu ID-ul rezervării WordPress editate. Pluginul validează ID-ul și îl transmite mecanismului nativ Booking Calendar `skip_booking_id`, astfel încât rezervarea nu intră în conflict cu propriile date, dar suprapunerile cu alte rezervări rămân blocate. Endpoint-ul final de editare repetă aceeași protecție în operația atomică Booking Calendar.

Dimensiunea maximă a unei pagini este 100; clientul paginează până când primește o pagină incompletă.
