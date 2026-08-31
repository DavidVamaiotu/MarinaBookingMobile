# Listă de verificare manuală

Folosește exclusiv un server local sau fixture-uri sintetice; nu crea și nu modifica rezervări de
client în producție.

- [ ] Conectează OAuth și confirmă că `GET /v1/workspaces` nu trimite `X-Workspace-ID`.
- [ ] Deschide Camere și confirmă că resursele/rezervările trimit ID-ul workspace-ului `rooms`.
- [ ] Deschide Camping și confirmă că aceleași endpoint-uri trimit ID-ul workspace-ului `camping`.
- [ ] Confirmă că niciun body pentru resurse, rezervări, disponibilitate sau cotație nu conține `workspace_id`.
- [ ] Folosește aceleași ID-uri de resursă și rezervare în ambele fixture-uri și confirmă izolarea cache-urilor.
- [ ] Creează și editează câte o rezervare sintetică în fiecare workspace; confirmă că nu apare în celălalt.
- [ ] Verifică schimbarea statusului, notei și anularea unei rezervări.
- [ ] Verifică o cotație, actualizarea avansului cu `send_email: false` și apoi acțiunea explicită de email cu `send_email: true`.
- [ ] Simulează un `412` și confirmă mesajul de versiune expirată fără suprascriere silențioasă.
- [ ] Simulează offline și confirmă că snapshot-ul local rămâne vizibil, iar scrierile sunt blocate.
- [ ] Verifică desktop și Android pentru aceleași scenarii.
- [ ] Pe Samsung Galaxy Z Fold7 verifică ecranul exterior, interior și schimbarea dimensiunii în timpul rulării.
