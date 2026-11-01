# Bezpieczeństwo Nebu

Program jest przeglądarką opartą na Electronie, więc otwiera cudze strony w swoich oknach.
Poniżej: co z tego wynika, co sprawdzono i co zostało świadomie zdecydowane.

## Zasady, na których stoi program

| Zasada | Jak jest zrobione |
|---|---|
| Strony z sieci nie mają dostępu do programu | `contextIsolation` wszędzie, `sandbox` dla każdej karty, `nodeIntegration` nigdy; preload (mostek do programu) dostają **wyłącznie** cztery własne strony wczytane z dysku |
| Karta z preloadem nigdzie nie nawiguje | wpisany adres, kliknięty link i kafelek aplikacji otwierają się w **nowej, zwykłej karcie**; strona z sieci nigdy nie trafia do renderera, który ma dostęp do programu |
| Każda wiadomość IPC ma sprawdzanego nadawcę | przyjmowane są tylko wiadomości od stron wczytanych z katalogu programu |
| Systemowi oddajemy wyłącznie adresy stron | `shell.openExternal` przepuszcza `http`, `https` i `mailto`. Bez tego sita strona podałaby `file:`, `smb:` czy `ms-msdt:` i uruchomiła program na komputerze użytkownika |
| Uprawnienia domyślnie odmawiane | kamera, mikrofon, położenie i powiadomienia — nie ma pytania, jest odmowa (do zmiany w ustawieniach) |
| Brak obchodzenia błędów TLS | zdarzenie `certificate-error` nie jest obsługiwane, więc zły certyfikat zostaje zły |
| CSP na wszystkich stronach własnych | `default-src 'none'`; zero `innerHTML` |
| Zero zależności produkcyjnych | program nie ciągnie ani jednej biblioteki w czasie działania — całe ryzyko łańcucha dostaw to sam Electron/Chromium |

## Integracje pisane słowami — dlaczego model nie pisze kodu

Nasuwa się proste rozwiązanie: niech model napisze JavaScript, a program go uruchomi.
**Tak nie robimy.** Kod od modelu uruchomiony w oknie strony to dokładnie ta dziura, którą
zamykają zasady wyżej, tylko wpuszczona głównym wejściem.

Zamiast tego model wypełnia **przepis** — kilka pól o ustalonym znaczeniu. Przepis nie jest
kodem i nic nie wykonuje. Program robi z niego jedną rzecz: czyta wartości z adresu okna
źródłowego i składa adres, który otwiera w oknie celu.

* adres celu musi być `http(s)` i przechodzi przez to samo sito, co linki zewnętrzne,
* wartości podstawiane są z kodowaniem, więc nie dopiszą parametru ani nie wyjdą ze ścieżki,
* brak choć jednej wartości = przepis nie robi nic (póładres w oknie roboczym jest gorszy
  niż brak akcji),
* wzorce użytkownika są ograniczone i odrzucane, gdy mogłyby zawiesić dopasowanie,
* przed zapisaniem program pokazuje przepis **po polsku** — zatwierdzasz to, co program
  rozumie, a nie swoje zdanie.

## Klucz do modelu

Podajesz go **po instalacji**, w oknie integracji. W paczce nie ma żadnego klucza i być nie
może — `.asar` to zwykłe archiwum. Klucz trafia do Twojego profilu zaszyfrowany mechanizmem
systemowym (`safeStorage`, szyfrowanie powiązane z kontem Windows). Gdy system szyfrowania
nie udostępnia, klucz **nie jest zapisywany wcale** — zamiast kłaść plik tekstowy z kluczem
na dysku, program mówi o tym wprost.

Przy kliknięciu „Napisz przepis" do modelu idą: Twoje zdanie oraz numery monitorów, nazwy
i **adresy** otwartych okien. Nic więcej i tylko wtedy — żadnego ruchu w tle.

## Testy

```
node testy/test-bezpieczenstwo-nebu.cjs    # 40 przypadków: sito adresów, nawigacja karty z preloadem, nadawcy IPC
node testy/test-integracje-nebu.cjs        # 25 przypadków: silnik przepisów i próby wyjścia poza podstawienie
```

Testy wycinają funkcje wprost z `main.js`, więc nie da się ich zdać, usuwając zabezpieczenie.

## Czego program NIE ma

* **podpisu cyfrowego** — Windows pokaże „Windows chronił Twój komputer"; trzeba kliknąć
  „Więcej informacji → Uruchom mimo to". Certyfikat kosztuje i jest w planach,
* **automatycznej aktualizacji** — nową wersję trzeba pobrać samemu,
* **gwarancji** — licencja MIT, używasz na własną odpowiedzialność.

## Znalazłeś dziurę?

Napisz, zanim opublikujesz: **biuro@geo-sys.pl**. Odpowiadam i poprawiam.
