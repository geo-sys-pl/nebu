# Nebu

Przegladarka wielomonitorowa z zapisem sesji pracy.

Otwierasz swoje strony w osobnych oknach, kazde na wybranym ekranie, ukladasz je raz —
a Nebu zapamietuje wszystko: ktore strony, na ktorych monitorach, w ktorych kartach,
przewiniete dokad i w jakim powiekszeniu. Zamykasz program, otwierasz nastepnego dnia,
masz dokladnie to samo. Ulozenia mozna tez zapisac jako pliki i przelaczac miedzy nimi.

Wszystkie okna dziela jedna sesje, wiec logujesz sie raz, a nie w kazdym oknie osobno.

## Do czego to jest

Do pracy na kilku ekranach z aplikacjami, ktore i tak dzialaja w przegladarce: panel
administracyjny na jednym monitorze, dokumentacja na drugim, dashboard na trzecim.
Zwykla przegladarka gubi taki uklad przy kazdym zamknieciu — Nebu nie.

## Jak sie uzywa

| Czynnosc | Jak |
|---|---|
| dodac strone | **Ustawienia** (⚙ albo Ctrl+,) — nazwa, adres, ekran, skrot |
| przeniesc okno na inny ekran | przycisk **Ekran** albo Alt+1…9 |
| nowe okno | **+ Okno** albo Ctrl+N — wybierasz strone i ekran |
| karty | Ctrl+T nowa, Ctrl+W zamknij, Ctrl+Tab nastepna, Ctrl+1…9 skok |
| zapisac uklad | Ctrl+Shift+S (jako plik), potem Ctrl+S nadpisuje |
| otworzyc uklad | Ctrl+O albo menu **Uklad** |
| ekran startowy | ▦ albo Ctrl+Home — kafelki stron i zapisanych ukladow |
| zmienic wyglad | **Wyglad** — Klasyczny, Kafelki, Matrix |

Uklad biezacy zapisuje sie sam: przy kazdej zmianie, co 15 sekund i przy zamykaniu.
Zamkniecie calego programu (okna jedno po drugim) zachowuje komplet okien;
zamkniecie pojedynczego okna w trakcie pracy usuwa je z ukladu po kilku sekundach.

## Gdzie leza dane

`%APPDATA%\Nebu` (Windows) — katalog instalacji pozostaje tylko do odczytu, jak wymaga tego sklep.

| Plik | Zawartosc |
|---|---|
| `strony.json` | lista stron uzytkownika |
| `sesja.json` | uklad biezacy, wybrany wyglad, sciezka otwartego ukladu |
| `uklady\*.nebu` | zapisane uklady pracy (czytelny JSON — mozna je kopiowac i wysylac) |
| `dziennik.log` | przebieg pracy i bledy |

## Integracje pisane slowami

Opisujesz zdaniem, co ma sie dziac miedzy monitorami — na przyklad *„wez wspolrzedne
z aplikacji na srodkowym monitorze i otworz je w aplikacji na prawym, z kamera na wysokosci
50 m"*. Program zamienia to na **przepis**, pokazuje go po polsku i wykonuje dopiero po
Twoim zatwierdzeniu.

Dziala z aplikacjami, ktore trzymaja swoj stan w adresie (wspolrzedne, zoom, numer dzialki,
wysokosc kamery). Okno otwierasz z **Ustawien** albo przelacznikiem `--integracje`; tam tez
podajesz swoj klucz AI, ktory zostaje zaszyfrowany w Twoim profilu.

**Zaden kod od modelu nie jest uruchamiany** — model wypelnia pola przepisu, a program
sklada z nich adres. Dlaczego akurat tak: [BEZPIECZENSTWO.md](BEZPIECZENSTWO.md).

## Instalacja

Instalator z [Releases](../../releases) — instaluje sie dla uzytkownika, **bez uprawnien
administratora**. Jest tez wersja przenosna: jeden plik `.exe`, bez instalowania.

Program nie jest podpisany cyfrowo, wiec Windows pokaze „Windows chronil Twoj komputer" —
**Wiecej informacji → Uruchom mimo to**. Przy kazdym wydaniu podajemy sume kontrolna:

```powershell
Get-FileHash "Nebu Setup 1.0.0.exe" -Algorithm SHA256
```

## Budowanie

```
npm install
npm start                                  # uruchomienie ze zrodel
node narzedzia/buduj.js publiczna          # instalator + wersja przenosna w dist/
node narzedzia/buduj.js publiczna dist-x   # to samo, do wskazanego katalogu
npm run dist-linux                         # AppImage i .deb
node narzedzia/ikona.js                    # przegenerowanie ikon
```

Testy, bez uruchamiania programu:

```
node testy/test-bezpieczenstwo-nebu.cjs    # 40 przypadkow
node testy/test-integracje-nebu.cjs        # 25 przypadkow
```

## Pliki zrodlowe

| Plik | Rola |
|---|---|
| `main.js` | proces glowny: okna, monitory, karty, uklady, skroty |
| `pasek.html` | pasek narzedzi nad trescia |
| `start.html` | ekran startowy z kafelkami |
| `ustawienia.html` | lista stron uzytkownika |
| `preload.js` | most miedzy wlasnymi stronami a programem |
| `motywy.css` | barwy trzech trybow wygladu |
| `narzedzia/ikona.js` | generator ikon (bez zadnych bibliotek) |
| `integracje.html` | okno integracji i klucza AI |
| `narzedzia/integracje.js` | silnik przepisow — czyta adres zrodla, sklada adres celu |

## Bezpieczenstwo

Osobny dokument: [BEZPIECZENSTWO.md](BEZPIECZENSTWO.md) — co sprawdzono, co naprawiono
i czego program nie ma. Znaleziona dziure zglos na **biuro@geo-sys.pl**, zanim
ja opublikujesz.

## Licencja

MIT — wolno uzywac, zmieniac, laczyc z innym kodem i sprzedawac, takze komercyjnie,
pod warunkiem **zachowania w kodzie informacji o autorze**:

> Nebu, Copyright (c) 2026 GEO-SYS Łukasz Czeczotka

Pelna tresc: [LICENSE](LICENSE).

---

**GEO-SYS Łukasz Czeczotka** — geodezja i programowanie, Katowice · [geo-sys.pl](https://www.geo-sys.pl)
