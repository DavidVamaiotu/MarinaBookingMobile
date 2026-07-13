# Listă de teste manuale

- [ ] Instalează Marina Booking API v1.0.4, configurează URL-ul, utilizatorul dedicat, parola de aplicație și `Europe/Bucharest`; Testează conexiunea trebuie să returneze numărul de spații.
- [ ] Creează o rezervare în așteptare cu nume/email/telefon și notă; confirmă că bara locală apare imediat, apoi primește ID de server și starea `sincronizat`.
- [ ] Trage de corpul barei și confirmă că nu se mută; redimensionează plecarea de la margine și confirmă că editarea se sincronizează ulterior.
- [ ] Editează câmpurile clientului și datele în panoul lateral; confirmă că schița rămâne vizibilă în timpul sincronizării.
- [ ] Aprobă rezervarea, apoi pune-o în așteptare; verifică statusul WordPress și culoarea din desktop.
- [ ] Schimbă nota internă de două ori rapid; verifică faptul că rămâne o singură comandă nesincronizată și că WordPress păstrează nota finală.
- [ ] Mută rezervarea la gunoi după confirmare; verifică faptul că nu există ștergere definitivă. Restabilește-o și verifică WordPress.
- [ ] Selectează 22–25 iulie pentru un bungalow de 270 lei/noapte: verifică totalul de 810 lei și avansul de 243 lei; activează patul suplimentar și verifică totalul de 960 lei și avansul de 288 lei. Nu trimite această comparație în producție.
- [ ] Într-o clonă WordPress izolată, schimbă avansul unei rezervări cu nota `Avans: 243, Cost: 810, Rest: 567`; verifică actualizarea automată a notei și faptul că emailul dependent nu pleacă înaintea comenzii de avans.
- [ ] Simulează offline, repornire și revenirea conexiunii; verifică păstrarea cheilor de idempotență și un singur email capturat de mailerul de test. Nu folosi adrese de clienți reali.
- [ ] Schimbă rapid datele și numărul de persoane și verifică stările calculului: `neactualizat`, `se calculează`, `actual`; un răspuns vechi nu trebuie să înlocuiască valorile noi.
- [ ] Deschide Detalii preț și verifică desfășurarea completă; la creare, editare sau redimensionare trebuie cerut un calcul `full` proaspăt înainte de punerea comenzii în coadă.
- [ ] Simulează o eroare de calcul și verifică faptul că suma anterioară rămâne marcată ca veche/eroare și nu se trimite nicio rezervare.
- [ ] Dezactivează rețeaua și confirmă că rezervările din cache rămân vizibile, iar o rezervare nouă nu poate fi trimisă fără disponibilitate și preț confirmate.
- [ ] Închide aplicația cu comenzi în coadă, repornește și confirmă recuperarea barelor optimiste și a comenzilor; reconectează și verifică sincronizarea.
- [ ] Provoacă o respingere de disponibilitate și verifică `conflict` cu Reîncearcă, Revino la local și detaliile rezervării disponibile.
- [ ] Revocă parola de aplicație și verifică oprirea sincronizării după 401/403 fără cereri repetate; înlocuiește parola și verifică reluarea.
- [ ] Simulează un timeout la creare; verifică reconcilierea aceluiași UUID prin `external_id` și faptul că nu apare o rezervare duplicată.
