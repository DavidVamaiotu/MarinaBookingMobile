# Marina Booking Desktop

Client desktop Electron pentru rezervările WordPress Booking Calendar prin **Marina Booking API v1.0.5+**. Păstrează designul și interacțiunile timeline-ului Parkline Web, înlocuind serverul local vechi cu un proces principal securizat, bazat exclusiv pe API.

## Dezvoltare

Cerințe: Node.js 22.5+ și un serviciu de credențiale disponibil pentru Electron (Windows Credential Protection, macOS Keychain sau Linux Secret Service).

```bash
npm install
npm test
npm run check
npm start
```

Aplicația are două spații de lucru independente: **Camere** pentru `marinapark.ro` și **Camping** pentru corturi/rulote pe `camping.marinapark.ro`. Fiecare păstrează separat cache-ul, coada și datele de acces, astfel încât ID-urile WordPress identice să nu se suprascrie.

La prima pornire a fiecărui spațiu, deschide Setări și introdu:

- URL-ul API care se termină în `/wp-json/marina-booking/v1`
- utilizatorul API WordPress dedicat
- parola de aplicație
- fusul orar al site-ului, de regulă `Europe/Bucharest`

Camping afișează exact două rânduri, Corturi și Rulote, dar păstrează toate ID-urile de resurse returnate de API. La creare se selectează numai categoria părinte; Booking Calendar verifică întreaga capacitate și atribuie rezervarea primei resurse părinte/copil disponibile pentru tot intervalul, în ordinea priorității configurate în WordPress. ID-ul real atribuit de server rămâne pe rezervare pentru editare și sincronizare. Patul suplimentar nu este oferit în Camping. Site-ul Camping trebuie să aibă instalat Marina Booking API v1.0.4+; aplicația nu încearcă acces direct la baza WordPress.

Parolele sunt criptate separat cu Electron `safeStorage` și păstrate în bazele SQLite locale doar ca date criptate. Aplicația respinge fallback-ul Linux nesigur `basic_text`. Parolele nu sunt returnate niciodată prin IPC.

## Build pentru producție

```bash
npm ci
npm test
npm run check
npm run dist
```

Instalatorul Windows NSIS este scris în `dist-electron/`. Starea aplicației este păstrată în directorul `userData` al utilizatorului, nu lângă aplicația instalată.

## Domeniu

Include timeline pe nouă luni și cache SQLite pentru Camere și Camping, actualizare periodică condiționată, creare/editare, redimensionare de la margine, status aprobat/în așteptare, note, gunoi/restaurare, verificarea disponibilității, previzualizări native de preț și avans, schimbarea avansului cu actualizarea automată a restului și cereri de plată prin email, actualizări optimiste locale, cozi sigure la repornire, diagnostic, setări securizate și actualizare prin API. Crearea unei rezervări necesită disponibilitate online și confirmarea prețului; rezervările din cache rămân disponibile offline.

Nu include administrarea pluginului WordPress, constructori de formulare, configurarea plăților, configurarea șabloanelor de email, ștergere definitivă, acces direct la baza WordPress sau funcțiile vechi Marina Park pentru bonuri, statistici și server local.

Vezi [arhitectura](docs/ARCHITECTURE.md), [compatibilitatea API](docs/API-COMPATIBILITY.md) și [lista de teste manuale](docs/MANUAL-TEST-CHECKLIST.md).
## Instalare pe Android și Windows

### Android (inclusiv Samsung Galaxy Z Fold 7)

Aplicația Android este independentă de PC și folosește direct același Marina Booking API. Pe telefon păstrează un cache local pentru consultare fără internet, dar creează și modifică rezervări numai când există conexiune. Parola API este criptată cu Android Keystore.

1. Generează APK-ul cu `npm run mobile:apk`.
2. Copiază `android/app/build/outputs/apk/debug/app-debug.apk` pe telefon.
3. Pe telefon, deschide APK-ul și permite **Instalare aplicații necunoscute** pentru aplicația din care l-ai deschis (de exemplu My Files).
4. Apasă **Instalare**, apoi deschide **Marina Booking**.
5. În **Setări**, introdu URL-ul API, utilizatorul WordPress și parola de aplicație. Configurează separat filele **Camere** și **Camping**.

Pe Galaxy Z Fold 7 aplicația se adaptează automat atât ecranului exterior, cât și ecranului interior. Poate fi pliată/desfăcută în timp ce rulează; calendarul rămâne derulabil orizontal.

### Windows

1. Generează installerul cu `npm run dist` pe Windows sau într-un mediu care poate construi NSIS.
2. Rulează `dist-electron/MarinaBookingDesktop-Setup-1.0.0.exe`.
3. Installerul este per utilizator și nu cere drepturi de administrator. După instalare, aplicația pornește automat.
4. Deschide **Setări** și configurează conexiunile **Camere** și **Camping**.

Datele locale Windows rămân în profilul utilizatorului la dezinstalare, pentru a proteja coada offline. Aplicația Android și cea Windows folosesc același server, dar au stocări locale separate.
