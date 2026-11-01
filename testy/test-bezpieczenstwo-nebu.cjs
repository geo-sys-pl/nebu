// Test dwoch bramek bezpieczenstwa w Nebu, poprawionych po audycie.
//
//   node scripts/test-bezpieczenstwo-nebu.cjs
//
// 1. bezpiecznyDoOtwarcia - co wolno oddac systemowi przez shell.openExternal.
//    Przed poprawka main.js wolal shell.openExternal(url) BEZ sprawdzania schematu, a adres
//    przychodzi ze strony (window.open). `file:` otwiera plik, `ms-msdt:`/`search-ms:` potrafia
//    uruchomic program - czyli dowolna strona wskazywala, co uruchomic na komputerze.
//
// 2. rolaZAdresu - komu wstrzykujemy most 2D/3D. Przed poprawka bylo `includes(':8080/viewer')`,
//    wiec rola przyklejala sie takze do obcej strony z tym ciagiem w zapytaniu. A rola decyduje
//    o wstrzaknieciu kodu, ktory czyta stan strony i steruje drugim oknem (window.__nebuWidok).

const fs = require("fs");
const path = require("path");

const MAIN = process.argv[2] || "C:\\APLIKACJA_3D\\Nebu\\main.js";
const kod = fs.readFileSync(MAIN, "utf8");

function wytnij(nazwa) {
  const m = kod.match(new RegExp("function " + nazwa + "\\([\\s\\S]*?\\n}"));
  if (!m) { console.error("BLAD: nie znalazlem funkcji " + nazwa + " w " + MAIN); process.exit(1); }
  return m[0];
}

const bezpiecznyDoOtwarcia = new Function(wytnij("bezpiecznyDoOtwarcia") + "; return bezpiecznyDoOtwarcia;")();
// rolaZAdresu pyta WARIANT.geo: w edycji publicznej zadna strona nie dostaje roli
// (a wiec i mostu). Testujemy edycje firmowa - tam role maja dzialac.
const rolaZAdresu = new Function("WARIANT", wytnij("rolaZAdresu") + "; return rolaZAdresu;")({ geo: true });
const rolaPubliczna = new Function("WARIANT", wytnij("rolaZAdresu") + "; return rolaZAdresu;")({ geo: false });

// [adres, czy wolno otworzyc w systemie, jaka rola (null = zadna)]
const PROBY = [
  // zwykly ruch - ma dzialac jak dotad
  ["https://example.com/x", true, null],
  ["http://mapa.example.org:8080/viewer/?a=1", true, "mapa2d"],
  ["http://model.example.org:5000/", true, "model3d"],
  ["http://mapa.example.org:5555/?powiat=2603", true, "amz"],
  ["mailto:biuro@unimaptech.pl", true, null],

  // schematy, ktorymi strona uruchomilaby program
  ["file:///C:/Windows/System32/calc.exe", false, null],
  ["smb://obcy/udzial/zly.exe", false, null],
  ["ms-msdt:/id PCWDiagnostic /skip force", false, null],
  ["search-ms:query=haslo&crumb=location:\\\\obcy\\udzial", false, null],
  ["javascript:alert(1)", false, null],
  ["", false, null],

  // podszycie sie pod mape/model - most NIE moze trafic do obcej strony
  ["https://obca.example/?x=:8080/viewer", true, null],
  ["https://obca.example/viewer#:5000/", true, null],
  ["https://obca.example:8080/nie-viewer", true, null],
  ["https://obca.example:8081/viewer", true, null],
];

let zle = 0;
for (const [adres, oczOtworz, oczRola] of PROBY) {
  const otworz = bezpiecznyDoOtwarcia(adres);
  const rola = rolaZAdresu(adres);
  const ok = otworz === oczOtworz && rola === oczRola;
  if (!ok) zle++;
  console.log((ok ? "OK  " : "BLAD")
    + "  otworz=" + String(otworz).padEnd(5)
    + " rola=" + String(rola).padEnd(8)
    + "  " + (adres || "(pusty)"));
}


// ============================================================ 3. karta startowa
//
// Karta startowa to JEDYNA karta z preloadem, czyli z `window.geo`: zapis listy stron,
// otwarcie pliku stanu, czyszczenie danych, DevTools, logowanie. Przed poprawka kazde
// wejscie na strone w tej karcie (kafelek aplikacji, wpisany adres, kliknięty link)
// ladowalo ja W TYM SAMYM renderze - z tym dostepem. Teraz zostac moze tylko start.html.

const START_TESTOWY = "geo:start";
const czyAdresStartu = new Function(
  "START",
  wytnij("czyAdresStartu") + "; return czyAdresStartu;",
)(START_TESTOWY);

const PROBY_STARTU = [
  ["geo:start", true],
  ["file:///C:/APLIKACJA_3D/Nebu/start.html", true],
  ["file:///C:/APLIKACJA_3D/Nebu/start.html?x=1", true],
  ["http://mapa.example.org:8080/viewer/?mapfile=X.map", false],
  ["https://obca.example/start.html", false],
  ["file:///C:/APLIKACJA_3D/Nebu/ustawienia.html", false],
  ["file:///C:/obcy/zly-start.html", false],
  ["about:blank", false],
  ["", false],
];

// ============================================================ 4. nadawca IPC
//
// Zalecenie 17 Electrona: sprawdzaj nadawce kazdej wiadomosci IPC. Drugi zamek za
// tym, ze karta startowa nie nawiguje - gdyby kiedys przeciekla, sito nie wpusci
// polecen od strony z sieci.

const odNaszejStrony = new Function(
  "path",
  "NASZE_STRONY",
  wytnij("odNaszejStrony") + "; return odNaszejStrony;",
)(path, ["start.html", "pasek.html", "ustawienia.html", "logowanie.html", "integracje.html"]);

const PROBY_NADAWCY = [
  ["file:///C:/APLIKACJA_3D/Nebu/start.html", true],
  ["file:///C:/APLIKACJA_3D/Nebu/pasek.html", true],
  ["file:///C:/APLIKACJA_3D/Nebu/logowanie.html", true],
  ["file:///C:/APLIKACJA_3D/Nebu/integracje.html", true],
  ["http://mapa.example.org:8080/viewer/", false],
  ["https://obca.example/start.html", false],
  ["file:///C:/obcy/start.html", true], // sito patrzy na nazwe pliku: obcy plik z dysku o nazwie
  // start.html przeszedlby, ale IPC i tak wymaga preloadu, a ten dostaje wylacznie karta
  // zaladowana z katalogu programu. Zaostrzyc do pelnej sciezki, gdy pojawi sie wiecej stron.
  ["", false],
  [null, false],
];

for (const [adres, oczekiwane] of PROBY_STARTU) {
  const wynik = czyAdresStartu(adres);
  const ok = wynik === oczekiwane;
  if (!ok) zle++;
  console.log((ok ? "OK  " : "BLAD") + "  zostaje-w-karcie-startowej=" + String(wynik).padEnd(5) + "  " + (adres || "(pusty)"));
}

for (const [adres, oczekiwane] of PROBY_NADAWCY) {
  const wynik = odNaszejStrony({ senderFrame: { url: adres } });
  const ok = wynik === oczekiwane;
  if (!ok) zle++;
  console.log((ok ? "OK  " : "BLAD") + "  wolno-slac-IPC=" + String(wynik).padEnd(5) + "  " + (adres || "(pusty)"));
}

// ============================================================ 5. ustawienia karty startowej
//
// Statycznie: karta startowa musi dostawac piaskownice i WSPOLNA sesje. Bez `session`
// chodzila po sesji domyslnej - poza zasadami prywatnosci i poza sitem uprawnien,
// a brak sita znaczy u Electrona zgode (kamera, mikrofon, polozenie bez pytania).

const BLOK_STARTOWEJ = (kod.match(/webPreferences: startowa[\s\S]*?\n  \}\);/) || [""])[0];
for (const [opis, wzor] of [
  ["karta startowa ma sandbox", /sandbox: true/],
  ["karta startowa ma wspolna sesje", /session: w\.prywatne \? sesjaUlotna : sesja/],
  ["karta startowa ma contextIsolation", /contextIsolation: true/],
]) {
  const ok = wzor.test(BLOK_STARTOWEJ);
  if (!ok) zle++;
  console.log((ok ? "OK  " : "BLAD") + "  " + opis);
}

// ============================================================ 6. edycja publiczna
//
// Publicznie wydajemy zwykla przegladarke wielomonitorowa - bez aMAPy, bez modelu, bez AMZ.
// Wtedy ZADNA strona nie dostaje roli, a wiec i wstrzykniecia mostu, choc trafi na port
// 8080, 5000 czy 5555 (u kogos w domu moze tam stac cokolwiek).

const PROBY_PUBLICZNEJ = [
  "http://mapa.example.org:8080/viewer/?a=1",
  "http://model.example.org:5000/",
  "http://mapa.example.org:5555/?powiat=2603",
  "http://localhost:5000/",
];

for (const adres of PROBY_PUBLICZNEJ) {
  const wynik = rolaPubliczna(adres);
  const ok = wynik === null;
  if (!ok) zle++;
  console.log((ok ? "OK  " : "BLAD") + "  rola-w-edycji-publicznej=" + String(wynik).padEnd(8) + "  " + adres);
}

const RAZEM = PROBY.length + PROBY_STARTU.length + PROBY_NADAWCY.length + PROBY_PUBLICZNEJ.length + 3;
console.log(zle ? "\n" + zle + " z " + RAZEM + " PRZYPADKOW NIE PRZESZLO" : "\nWSZYSTKIE " + RAZEM + " PRZYPADKOW OK");
process.exitCode = zle ? 1 : 0;
