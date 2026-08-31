# Contract de integrare Marina Booking API

Documentația furnizată pentru `/v1/*` este autoritatea contractului. Aplicația nu sondează rute
OpenAPI/Swagger.

## Autentificare

Accesul protejat folosește OAuth Authorization Code cu PKCE S256. Fiecare cerere `/v1/*` trimite:

```http
Authorization: Bearer <access_token>
```

Access token-ul rămâne în memorie. Refresh token-ul este criptat prin mecanismul securizat al
platformei și este înlocuit după rotație.

## Selectarea workspace-ului

Aplicația expune doar Camere și Camping. Configurația poate furniza ID-urile prin
`MARINA_ROOMS_WORKSPACE_ID` și `MARINA_CAMPING_WORKSPACE_ID`.

Dacă un ID lipsește, clientul apelează:

```http
GET /v1/workspaces
Authorization: Bearer <access_token>
```

Această cerere nu include `X-Workspace-ID`. Sunt considerate doar workspace-urile active. Camping
se rezolvă după slug `camping`. Camere se rezolvă după `rooms`, apoi `camere`, `default` sau
workspace-ul marcat `is_default`.

După rezolvare, fiecare cerere scoped trimite:

```http
X-Workspace-ID: <workspace_id>
```

`workspace_id` nu este inclus în corpurile cererilor de resurse, rezervări, disponibilitate,
cotații, prețuri, avans sau cereri de plată. Un `404` este tratat în contextul workspace-ului activ,
fără fallback către alt workspace.

## Izolarea datelor

Camere și Camping au clienți și snapshot-uri cache separate. Nu există mirroring, dual-write,
schimbare automată de provider sau migrare. ID-urile egale din cele două workspace-uri rămân izolate.

## Rezervări și prețuri

Resursele se citesc din `GET /v1/resources`, iar rezervările din `GET /v1/bookings`, cu paginare de
maximum 200 de înregistrări. Cotațiile folosesc `POST /v1/quotes`; scrierile de rezervare folosesc
quote-ul confirmat și versiunea curentă.

Avansul se actualizează prin `PATCH /v1/bookings/{id}` cu `deposit_minor`, versiunea așteptată și
`send_email: false`. Emailul de plată este o acțiune explicită separată:

```http
POST /v1/admin/bookings/{id}/payment-request
Idempotency-Key: <uuid-v4>
Content-Type: application/json

{
  "send_email": true,
  "payment_type": "deposit",
  "payment_reason": "Avans rezervare"
}
```

Clientul nu trimite o sumă în cererea de plată; serverul folosește avansul curent al rezervării.
