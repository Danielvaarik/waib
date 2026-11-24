# Waib: seadistusjuhend

See juhend viib tühjast kohast töötava leheni aadressil waib.ee. Aega kulub umbes kaks tundi. Tee sammud selles järjekorras.

Menüüde ja nuppude nimed on kirja pandud 2026. aasta novembri seisuga; teenused muudavad neid aeg-ajalt, nii et mõni silt võib veidi erineda.

## Mis on kaustas

| Fail | Milleks |
|---|---|
| `index.html` | Leht, mida kasutaja näeb |
| `admin.html` | Toimetaja vaade kaartide sisestamiseks |
| `config.js` | Kaks seadet, mille täidad 5. sammus |
| `privaatsus.html` | Privaatsusteabe **mustand** |
| `kaardid-naidis.json` | 20 näidiskaarti esimeseks katsetuseks |
| `CNAME` | Ütleb GitHubile, et lehe aadress on waib.ee |
| `supabase/schema.sql` | Andmebaasi tabelid ja reeglid |
| `supabase/functions/waib/index.ts` | Serverifunktsioon |

Kuni `config.js` on tühi, töötab leht näidisrežiimis: kaardid tulevad failist ja võrdlust teistega ei ole. Nii saad 1. ja 6. sammu ära teha ja lehte näha enne, kui server on valmis.

## 1. Koodihoidla GitHubis

1. Tee konto aadressil github.com.
2. Loo uus hoidla nimega `waib`, nähtavus **Public**.
3. Vali „uploading an existing file" ja lohista sinna kogu selle kausta sisu (koos kaustaga `supabase`). Kinnita nupuga **Commit changes**.

Koodis ei ole ühtegi saladust, seega võib hoidla olla avalik.

## 2. Andmebaas Supabase'is

1. Tee konto aadressil supabase.com ja loo uus projekt.
2. Piirkonnaks vali kindel ELi piirkond, näiteks **Central EU (Frankfurt)**. Ära vali üldist „Europe" valikut.
3. Andmebaasi salasõna salvesta paroolihaldurisse. Igapäevatöös seda vaja ei lähe.
4. Ava vasakult **SQL Editor**, kleebi sinna faili `supabase/schema.sql` kogu sisu ja vajuta **Run**. Vastus peab olema „Success".

## 3. Serverifunktsioon

1. Ava vasakult **Edge Functions** ja vali **Deploy a new function → Via Editor**.
2. Funktsiooni nimeks pane täpselt `waib`.
3. Kustuta näidiskood, kleebi asemele faili `supabase/functions/waib/index.ts` sisu ja vajuta **Deploy**.
4. Ava funktsiooni seaded ja lülita **Verify JWT** välja. See on vajalik, sest külastajad ei ole Supabase'i kasutajad; funktsioon kontrollib Google'i tõendit ise.
5. Ava **Edge Functions → Secrets** ja lisa neli saladust:

| Nimi | Väärtus |
|---|---|
| `WAIB_HASH_SECRET` | Juhuslik sõne, vähemalt 40 märki. Tee see paroolihalduri generaatoriga. **Ära seda hiljem muuda**: muutmisel saaksid kõik sel nädalal uuesti vastata. |
| `WAIB_ADMIN_TOKEN` | Toimetaja võti, vähemalt 20 märki. Seda sisestad lehel admin.html. |
| `WAIB_ORIGINS` | `https://waib.ee,https://www.waib.ee` |
| `GOOGLE_CLIENT_ID` | Lisad 4. sammu lõpus. |

6. Kirjuta üles funktsiooni aadress. See on kujul `https://SINU-PROJEKT.supabase.co/functions/v1/waib` ja on näha funktsiooni lehel.

## 4. Google'i sisselogimine

1. Ava console.cloud.google.com ja loo uus projekt nimega Waib.
2. Otsi üles **Google Auth Platform** (varem „OAuth consent screen") ja täida rakenduse andmed: nimi Waib, kasutajatüüp **External**, kontaktiks sinu e-post.
3. Andmetele ligipääsu (scopes) alla ära lisa midagi peale `openid`. Nii ei saa Waib kasutaja nime ega e-posti aadressi.
4. Loo klient: **Clients → Create client → Web application**.
   - **Authorized JavaScript origins:** `https://waib.ee`
   - **Authorized redirect URIs:** `https://waib.ee/` (täpselt nii, kaldkriipsuga lõpus)
5. Kopeeri **Client ID** (lõpeb `.apps.googleusercontent.com`) ja lisa see Supabase'is saladuseks `GOOGLE_CLIENT_ID`. Client secret'it vaja ei ole.
6. Kui rakendus on olekus „Testing", saavad sisse logida ainult käsitsi lisatud testkasutajad. Avalikuks kasutamiseks vajuta **Publish app**.

## 5. Seaded faili config.js

Ava GitHubis fail `config.js`, vajuta pliiatsi ikooni ja täida kaks väärtust:

```js
window.WAIB = {
  API: "https://SINU-PROJEKT.supabase.co/functions/v1/waib",
  GOOGLE_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com"
};
```

Salvesta nupuga **Commit changes**. Kumbki väärtus ei ole salajane.

## 6. Leht aadressile waib.ee

1. GitHubi hoidlas ava **Settings → Pages**. Allikaks vali **Deploy from a branch**, haru `main`, kaust `/ (root)`.
2. Väljale **Custom domain** kirjuta `waib.ee` ja salvesta.
3. GitHub näitab, millised DNS-kirjed on vaja lisada. Lisa need oma domeeni registripidaja juures (seal, kus waib.ee registreerisid). Kirjete jõustumine võib võtta mõnest minutist mõne tunnini.
4. Kui GitHub on domeeni kinnitanud, märgi **Enforce HTTPS**.

## 7. Esimene komplekt

1. Ava `https://waib.ee/admin.html` ja sisesta toimetaja võti.
2. Vajuta **Uus komplekt**. Tunnuseks sobib nädala number, näiteks `2026-W49`.
3. Katsetamiseks vajuta **Impordi JSON** ja kleebi sinna faili `kaardid-naidis.json` sisu. Päris komplekti jaoks lisa kaardid ükshaaval nupuga **Lisa kaart**.
4. Täida silt ja avanemise aeg, märgi **Avaldatud** ja vajuta **Salvesta**.

## 8. Kontroll

- [ ] `https://waib.ee` avaneb ja näitab sinu komplekti silti, mitte teadet „Näidisrežiim".
- [ ] 20 kaardi järel ilmub kokkuvõte ja nupp „Logi sisse Google'iga ja vaata võrdlust".
- [ ] Google'i aknas saad valida konto ja jõuad tagasi Waibi kokkuvõtte juurde.
- [ ] Pärast sisselogimist ilmub teade „Sinu vastused on arvesse võetud" ja vastajate arv.
- [ ] Lehel admin.html on komplekti real vastuste arv kasvanud ühe võrra.
- [ ] Sama Google'i kontoga teisest seadmest vastates arv ei kasva.

Võrdlus teistega avaneb alles siis, kui vastajaid on vähemalt 10. Katsetamise ajaks võid lisada saladuse `WAIB_MIN_N` väärtusega `2`; enne avalikku käivitamist kustuta see.

Kui midagi ei tööta, vaata **Edge Functions → waib → Logs**. Sagedasemad põhjused:

| Mida näed | Põhjus |
|---|---|
| „Kaarte ei õnnestunud laadida" | `config.js` aadress on vale või „Verify JWT" on sisse jäänud |
| Google näitab viga `redirect_uri_mismatch` | Redirect URI ei ole täpselt `https://waib.ee/` |
| „Sisselogimine aegus" | `GOOGLE_CLIENT_ID` saladus ei kattu `config.js` väärtusega |
| „Vastuste saatmine ei õnnestunud" | `WAIB_HASH_SECRET` on puudu või lühem kui 32 märki |

## 9. Iganädalane töö

1. Koosta nädala jooksul lehel admin.html uus komplekt mustandina (jäta „Avaldatud" märkimata).
2. Kui kaardid on valmis, pane avanemise ajaks reede kell 16:00, märgi **Avaldatud** ja salvesta. Komplekt läheb lehele ise õigel ajal.
3. Uue komplekti avanemisel sulgub eelmine automaatselt ja selle vastanute märked kustutatakse esimese uue vastusega.

Kui komplektile on juba vastatud, saab kaartide sõnastust parandada, aga kaarte ei saa enam lisada ega eemaldada.

## 10. Enne avalikku käivitamist

- **Privaatsusteave.** `privaatsus.html` on mustand. Täida nurksulgudes kohad (vastutaja nimi ja kontakt) ja lase tekst juristil üle vaadata. Poliitilised vaated on isikuandmete eriliik ja nõusoleku sõnastus peab olema korrektne.
- **Aadress www.waib.ee.** Kui tahad, et ka see töötaks, lisa registripidaja juures vastav kirje GitHubi juhiste järgi.
- **Koormuspiirang puudub.** Serverifunktsioon ei piira päringute sagedust. Väikese kasutajaskonnaga ei ole see probleem; kui leht muutub populaarseks, tuleb piirang lisada.
- **Ainult Google.** Google'i kontota inimesed saavad kaarte lükata ja oma tulemust näha, aga võrdlust teistega ei näe.

## Mida on kontrollitud ja mida mitte

Andmebaasi skeem, serverifunktsioon, kasutajaliides ja toimetajavaade on läbi proovitud kohalikus katsekeskkonnas: päris Postgresi-ühilduv andmebaas, päris brauser ja järeletehtud Google'i sisselogimine. Päris Supabase'i ja päris Google'i vastu ei ole seda käivitatud, sest selleks on vaja sinu kontosid. 8. sammu kontroll-loend on see koht, kus selgub, kas seadistus sai õige.
