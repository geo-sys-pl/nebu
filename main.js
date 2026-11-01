// Nebu - przegladarka wielomonitorowa z zapisem sesji pracy.
//
// Dowolna liczba okien, kazde na wybranym monitorze, karty jak w zwyklej przegladarce
// i jedna wspolna sesja (te same ciasteczka i logowania we wszystkich oknach).
// Stan pracy - ktore strony, na ktorych ekranach, w ktorych kartach i w ktorym miejscu -
// zapisuje sie sam przy zamykaniu i da sie go zachowac jako plik *.nebu.
//
// Dane uzytkownika (strony, sesja, stany) leza w katalogu danych aplikacji, nie przy programie:
// katalog instalacji ze sklepu jest tylko do odczytu.

const { app, BaseWindow, BrowserWindow, WebContentsView, screen, session, ipcMain, shell, Menu, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');

const KATALOG = __dirname; // zasoby programu (html, css)

// Edycja programu. Ten sam kod sluzy wersji publicznej i firmowej - rozni je tylko
// wariant.json obok programu: nazwa, strony wgrane na starcie i miejsce na dane.
// Brak pliku albo blad odczytu = edycja publiczna.
const WARIANT = (() => {
  // `geo` to integracje geodezyjne: mosty mapa 2D <-> model 3D, przycinanie obrebow w AMZ,
  // odswiezanie mapy po zapisie w modelu. W edycji PUBLICZNEJ (brak wariantu) sa wylaczone -
  // tam Nebu jest zwykla przegladarka wielomonitorowa z zapisem ukladow, a wstrzykiwanie
  // naszego kodu stronom, ktore trafia na port 8080/5000/5555, byloby i zbedne, i ryzykowne.
  const domyslny = { nazwa: 'Nebu', daneObokProgramu: false, strony: [], uklad: null, geo: false };
  try {
    const dane = JSON.parse(fs.readFileSync(path.join(KATALOG, 'wariant.json'), 'utf8').replace(/^﻿/, ''));
    return { ...domyslny, geo: true, ...dane };
  } catch {
    return domyslny;
  }
})();

const NAZWA = WARIANT.nazwa;

// Autor programu. Wariant edycji moze zmienic NAZWE produktu, ale nie to - stad osobna stala,
// uzywana w oknie "o programie", na ekranie startowym i w dzienniku. Ta sama tresc jest
// w LICENSE, w naglowkach plikow zrodlowych i we wlasciwosciach pliku .exe (CompanyName).
const FIRMA = 'GEO-SYS Łukasz Czeczotka';

// Edycja firmowa trzyma dane przy programie - caly katalog mozna skopiowac na inna stacje
// razem z ukladami pracy. Edycja ze sklepu musi pisac do katalogu uzytkownika,
// bo katalog instalacji jest tylko do odczytu.
const DANE_BAZOWE = (() => {
  // --dane=<katalog> trzyma profile we wskazanym miejscu zamiast w AppData.
  // Po co: AppData bywa przekierowane (program uruchomiony z aplikacji w pakiecie MSIX
  // dostaje wlasna, prywatna warstwe), wiec ten sam Nebu widzi wtedy inny profil niz
  // uruchomiony skrotem - inne uklady, inne ustawienia i dlugie szukanie, czemu
  // "u mnie dziala, a u ciebie nie".
  const wskazany = process.argv.find((a) => a.startsWith('--dane='));
  if (wskazany) {
    const katalog = wskazany.slice('--dane='.length).trim().replace(/^"|"$/g, '');
    try {
      fs.mkdirSync(katalog, { recursive: true });
      fs.accessSync(katalog, fs.constants.W_OK);
      return katalog;
    } catch (e) {
      console.error('Nie moge pisac do ' + katalog + ' - zostaje katalog uzytkownika:', e.message);
    }
  }

  if (!WARIANT.daneObokProgramu) return app.getPath('userData');

  // Po spakowaniu KATALOG wskazuje wnetrze archiwum app.asar - tam nie da sie pisac.
  // "Obok programu" znaczy wtedy: obok pliku wykonywalnego. Gdyby i tam sie nie dalo
  // (instalacja dla wszystkich uzytkownikow w Program Files), cofamy sie do katalogu
  // uzytkownika - lepiej dane gdzie indziej niz program, ktory nie wstaje.
  // Wersja przenosna rozpakowuje sie przy kazdym starcie do katalogu tymczasowego,
  // wiec 'obok programu' znaczy tam: obok pliku .exe, ktory uzytkownik klikna.
  // Ten katalog podaje sam electron-builder w PORTABLE_EXECUTABLE_DIR.
  const przenosny = process.env.PORTABLE_EXECUTABLE_DIR;
  // Katalog danych nazywamy po edycji. Inaczej wersja przenosna czysta i firmowa,
  // lezac w tym samym folderze, siegalyby po te same ustawienia - a wtedy jedna
  // otwiera uklad drugiej (bylo: czyste Nebu wstawalo ze stronami Czarnocina).
  const nazwaDanych = 'dane-' + String(NAZWA || 'nebu').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const obok = przenosny
    ? path.join(przenosny, nazwaDanych)
    : app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'dane')
      : path.join(KATALOG, 'dane');

  try {
    fs.mkdirSync(obok, { recursive: true });
    fs.accessSync(obok, fs.constants.W_OK);
    return obok;
  } catch {
    return app.getPath('userData');
  }
})();

// Profil to osobny zestaw wszystkiego: swoje strony, swoje logowania, swoje uklady.
// "Nebu --profil=biuro" i "Nebu --profil=geodezja" to dwa niezalezne swiaty w jednej instalacji.
// Bez parametru pracuje profil domyslny, czyli zwykly katalog danych.
const PROFIL = (() => {
  const arg = process.argv.find((a) => a.startsWith('--profil='));
  const nazwa = arg ? arg.slice('--profil='.length).trim() : '';
  return nazwa.replace(/[\/:*?"<>|]/g, '_');
})();

const DANE = PROFIL ? path.join(DANE_BAZOWE, 'profile', PROFIL) : DANE_BAZOWE;

// Przeprowadzka profilu przy pierwszym starcie z --dane=. Zabieramy ustawienia, strony
// i uklady z dotychczasowego miejsca (AppData), zeby przestawienie katalogu nie wygladalo
// jak utrata calej konfiguracji. Cache przegladarki zostawiamy - odtworzy sie sam.
function przeprowadzProfil(zStarego, doNowego) {
  const doZabrania = ['sesja.json', 'strony.json', 'uklady'];
  if (!fs.existsSync(zStarego) || zStarego === doNowego) return;
  if (doZabrania.some((n) => fs.existsSync(path.join(doNowego, n)))) return; // juz przeniesione

  let cokolwiek = false;
  for (const nazwa of doZabrania) {
    const zrodlo = path.join(zStarego, nazwa);
    if (!fs.existsSync(zrodlo)) continue;
    try {
      fs.cpSync(zrodlo, path.join(doNowego, nazwa), { recursive: true });
      cokolwiek = true;
    } catch (e) {
      console.error('Nie udalo sie przeniesc', nazwa, '-', e.message);
    }
  }
  if (cokolwiek) console.log('Profil przeniesiony z ' + zStarego + ' do ' + doNowego);
}

// Kazdy profil dostaje wlasny katalog danych Chromium (cache, ciasteczka, blokady).
// Bez tego dwie instancje - np. praca na profilu "lukasz" i test na "czarnocin" -
// biloby sie o te same pliki. Z tym: profile chodza obok siebie, nie przeszkadzajac sobie.
if (PROFIL) {
  fs.mkdirSync(DANE, { recursive: true });
  przeprowadzProfil(path.join(app.getPath('userData'), 'profile', PROFIL), DANE);
  app.setPath('userData', DANE);
  app.setPath('sessionData', DANE);
}
const PLIK_STRON = path.join(DANE, 'strony.json');
const PLIK_SESJA = path.join(DANE, 'sesja.json');
const ROZSZERZENIE = 'nebu';
const ROZSZERZENIA_CZYTANE = ['nebu', 'geostan']; // .geostan - uklady z pierwszej wersji firmowej
const WERSJA_STANU = 1;

const WYS_NARZEDZI = 38;        // rzad z adresem i przyciskami
const WYS_KART = 32;            // rzad kart, gdy widoczny
const PARTYCJA_BAZA = 'persist:nebu'; // sesja trwala: logowania przezywaja zamkniecie programu
const PARTYCJA_ULOTNA = 'nebu-ulotna'; // bez "persist:" - Chromium trzyma to tylko w pamieci

// Domeny zyjace ze sledzenia. Lista jest krotka i wbudowana, zeby nie pobierac niczego
// z sieci i nie udawac pelnego blokera reklam - chodzi o odciecie najczestszych nadajnikow.
const SLEDZACE = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'googletagservices.com',
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
  'facebook.net', 'connect.facebook.net', 'graph.facebook.com',
  'scorecardresearch.com', 'quantserve.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
  'hotjar.com', 'hotjar.io', 'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'branch.io', 'adroll.com', 'bluekai.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net',
  'smartadserver.com', 'adnxs.com', 'casalemedia.com', 'yandex.ru/metrika', 'clarity.ms',
];
const START = 'geo:start';      // wewnetrzna strona startowa z kafelkami aplikacji
const MOTYWY = ['klasyczny', 'kafelki', 'matrix'];

let aplikacje = [];      // strony uzytkownika z strony.json
let zalogowany = null;   // kto pracuje w tej sesji (edycja z logowaniem)
let katalogStanow = '';  // gdzie leza zapisane uklady pracy (*.nebu)
let sesja = null;        // sesja trwala - wspolne logowania we wszystkich oknach
let sesjaUlotna = null;  // sesja okien prywatnych - ginie razem z programem
let zablokowane = 0;     // licznik odcietych zadan sledzacych
let licznikOkien = 0;
let licznikKart = 0;
let przelaczamyStan = false; // trwa podmiana ukladu - zero okien to wtedy stan przejsciowy

/** @type {Map<number, object>} */
const okna = new Map();

// ==================================================================== dziennik

// Zapis przebiegu do dziennik.log - okna powstaja i gina bez sladu w konsoli,
// bo proces glowny Electrona nie ma gdzie pisac, gdy uruchamia go skrot.
const PLIK_LOG = path.join(DANE, 'dziennik.log');
function log(...czesci) {
  const linia = new Date().toISOString().slice(11, 23) + '  ' + czesci.join(' ') + '\n';
  try { fs.appendFileSync(PLIK_LOG, linia, 'utf8'); } catch { /* dziennik nie moze psuc programu */ }
}

process.on('uncaughtException', (e) => log('BLAD NIEPRZECHWYCONY:', e && e.stack || e));
process.on('unhandledRejection', (e) => log('ODRZUCONA OBIETNICA:', e && e.stack || e));

// =============================================================== konfiguracja

// Notatnik i PowerShell zapisuja UTF-8 ze znacznikiem BOM - bez jego usuniecia
// JSON.parse sie wywraca na pierwszym znaku.
function czytajTekst(sciezka) {
  return fs.readFileSync(sciezka, 'utf8').replace(/^\uFEFF/, '');
}

// Strony uzytkownika: nazwa, adres, monitor, skrot i znacznik wolnej przegladarki.
// Przy pierwszym uruchomieniu powstaje jedna pozycja - reszte dodaje sie w Ustawieniach.
function czytajStrony() {
  try {
    const dane = JSON.parse(czytajTekst(PLIK_STRON));
    const lista = (dane.strony || []).filter((s) => s && s.nazwa && s.url);
    if (lista.length) return lista;
  } catch { /* pierwszy start albo uszkodzony plik - ponizej zawartosc domyslna */ }

  const domyslne = WARIANT.strony.length
    ? WARIANT.strony
    : [{ nazwa: 'WWW', url: 'https://www.google.com/', monitor: 1, skrot: 'F1', www: '1' }];
  zapiszStrony(domyslne);
  return domyslne;
}

function zapiszStrony(lista) {
  fs.mkdirSync(DANE, { recursive: true });
  fs.writeFileSync(PLIK_STRON, JSON.stringify({ wersja: 1, strony: lista }, null, 2), 'utf8');
}

// Wybrany tryb wygladu: zapamietany w sesji, domyslnie klasyczny.
function motyw() {
  const z = czytajSesje().motyw;
  return MOTYWY.includes(z) ? z : 'klasyczny';
}

function ustawMotyw(nazwa) {
  if (!MOTYWY.includes(nazwa)) return;
  zapiszSesje({ motyw: nazwa });
  log('motyw:', nazwa);
  for (const w of okna.values()) {
    if (w.okno.isDestroyed()) continue;
    odswiezPasek(w);
    // Ekran startowy tez ma zmienic barwy - przeladowujemy tylko jego.
    for (const k of w.karty) {
      if (k.ostatniDobryUrl === START && !k.view.webContents.isDestroyed()) k.view.webContents.reload();
    }
  }
  if (oknoUstawien && !oknoUstawien.isDestroyed()) oknoUstawien.reload();
}

function aplikacjaPoNazwie(nazwa) {
  return aplikacje.find((a) => a.nazwa === nazwa) || aplikacje[0];
}

// Okno wolnej przegladarki: ma karty i zatrzymuje linki u siebie.
function czyWww(aplikacja) {
  return /^(1|tak|true)$/i.test(String(aplikacja.www || ''));
}

// ============================================================ pliki stanow

function bezpiecznaNazwa(nazwa) {
  return String(nazwa || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'stan';
}

function sciezkaStanu(nazwa) {
  return path.join(katalogStanow, bezpiecznaNazwa(nazwa) + '.' + ROZSZERZENIE);
}

// Lista stanow = zawartosc katalogu. Plik mozna skopiowac, wyslac, wrzucic na dysk sieciowy.
function listaStanow() {
  try {
    return fs.readdirSync(katalogStanow)
      .filter((p) => ROZSZERZENIA_CZYTANE.some((r) => p.toLowerCase().endsWith('.' + r)))
      .map((p) => {
        const sciezka = path.join(katalogStanow, p);
        const stan = czytajStanZPliku(sciezka);
        return stan && { nazwa: stan.nazwa, sciezka, zapisano: stan.zapisano, okien: stan.okna.length };
      })
      .filter(Boolean)
      .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
  } catch {
    return [];
  }
}

function czytajStanZPliku(sciezka) {
  try {
    const dane = JSON.parse(czytajTekst(sciezka));
    if (!Array.isArray(dane.okna) || !dane.okna.length) return null;
    return {
      nazwa: dane.nazwa || path.basename(sciezka, '.' + ROZSZERZENIE),
      zapisano: dane.zapisano || null,
      okna: dane.okna,
    };
  } catch {
    return null; // nie nasz plik albo uszkodzony
  }
}

async function zapiszStanDoPliku(sciezka, nazwa) {
  const opis = await migawka();
  if (!opis.length) return false; // pusty uklad skasowalby zawartosc pliku

  fs.mkdirSync(path.dirname(sciezka), { recursive: true });
  fs.writeFileSync(sciezka, JSON.stringify({
    wersja: WERSJA_STANU,
    nazwa: nazwa || path.basename(sciezka, '.' + ROZSZERZENIE),
    zapisano: new Date().toISOString(),
    okna: opis,
  }, null, 2), 'utf8');

  zapiszSesje({ aktywny: sciezka });
  odswiezPaski();
  return true;
}

// =================================================================== prywatnosc

// Aktywny uklad moze zyc razem z praca: przesuniecie mapy, inny obreb, inna dzialka -
// plik *.nebu dostaje swiezy adres. Wylaczenie zamraza uklad w postaci z chwili zapisu.
// Okna jednego ukladu chodza razem: klikniecie w ktorekolwiek wyciaga na wierzch
// pozostale - na swoich monitorach, bez zabierania fokusu temu klinietemu.
// Wylaczenie przydaje sie, gdy ktos chce miec obok siebie okno innego programu.
// Ile ekranow zajac. "auto" znaczy tyle, ile jest podlaczonych - dzieki temu uklad
// zrobiony na trzy monitory otworzy sie sensownie takze na laptopie.
// Wartosc z wiersza polecen (--ekrany=2) ma pierwszenstwo przed zapamietana.
function ileEkranow() {
  const arg = process.argv.find((a) => a.startsWith('--ekrany='));
  const zArg = arg ? parseInt(arg.split('=')[1], 10) : NaN;
  if (Number.isFinite(zArg) && zArg > 0) return zArg;

  const zapamietane = czytajSesje().ekranow;
  if (Number.isFinite(zapamietane) && zapamietane > 0) return zapamietane;
  return ekranyOdLewej().length;
}

// Uklad dopasowany do liczby ekranow: nadmiarowe okna nie gina, tylko dolaczaja
// jako karty do ostatniego okna. Na jednym monitorze caly uklad to jedno okno z kartami.
function dopasujDoEkranow(uklad) {
  const ile = Math.max(1, Math.min(ileEkranow(), ekranyOdLewej().length));
  if (uklad.length <= ile) return uklad;

  const kolejnosc = { srodkowy: 0, prawy: 1, lewy: 2 };
  const wedlugWaznosci = [...uklad].sort(
    (a, b) => (kolejnosc[a.rola] ?? 9) - (kolejnosc[b.rola] ?? 9),
  );

  const zostaja = wedlugWaznosci.slice(0, ile);
  const doKart = wedlugWaznosci.slice(ile);

  const ostatnie = zostaja[zostaja.length - 1];
  ostatnie.karty = [...(ostatnie.karty || []), ...doKart.flatMap((o) => o.karty || [])];

  // Plik ukladu zostaje wzorcem na pelny zestaw monitorow - praca na mniejszej liczbie
  // ekranow nie moze go okroic, bo jutro przy trzech monitorach nie byloby co odtwarzac.
  ukladOkrojony = true;
  log('dopasowanie do', ile, 'ekranow |', doKart.length, 'okien jako karty | plik ukladu chroniony');
  return zostaja;
}

function razemNaWierzch() {
  const w = czytajSesje().razemNaWierzch;
  return w === undefined ? true : !!w;
}

function autoZapisUkladu() {
  const w = czytajSesje().autoZapisUkladu;
  return w === undefined ? true : !!w;
}

const PRYWATNOSC_DOMYSLNA = {
  blokujSledzace: true,   // odcinanie skryptow analitycznych i reklamowych
  odmawiajUprawnien: true, // kamera, mikrofon, polozenie, powiadomienia - bez pytania: nie
  niePamietaj: false,      // kazde okno startuje w trybie prywatnym
  proxy: '',               // np. socks5://127.0.0.1:9050 dla Tora
};

function prywatnosc() {
  return { ...PRYWATNOSC_DOMYSLNA, ...(czytajSesje().prywatnosc || {}) };
}

// Sesja trwala i ulotna dostaja te same zasady - roznica jest tylko w tym,
// czy cokolwiek zostaje na dysku po zamknieciu programu.
function zastosujPrywatnosc() {
  const p = prywatnosc();
  for (const s of [sesja, sesjaUlotna]) {
    if (!s) continue;

    s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (szczegoly, oddzwon) => {
      if (!p.blokujSledzace) return oddzwon({});
      let host = '';
      try { host = new URL(szczegoly.url).hostname; } catch { return oddzwon({}); }
      const sledzi = SLEDZACE.some((d) => host === d || host.endsWith('.' + d));
      if (sledzi) {
        zablokowane++;
        if (zablokowane <= 5) log('zablokowano sledzenie:', host); // potem juz tylko licznik
      }
      oddzwon({ cancel: sledzi });
    });

    // Prosba o niesledzenie - honorowana przez czesc serwisow, kosztuje nas nic.
    s.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (szczegoly, oddzwon) => {
      oddzwon({ requestHeaders: { ...szczegoly.requestHeaders, DNT: '1', 'Sec-GPC': '1' } });
    });

    s.setPermissionRequestHandler((_wc, uprawnienie, oddzwon) => {
      if (!p.odmawiajUprawnien) return oddzwon(true);
      // Pelny ekran i schowek sa potrzebne do pracy; reszta domyslnie odmowa.
      oddzwon(['fullscreen', 'clipboard-sanitized-write'].includes(uprawnienie));
    });

    s.setProxy(p.proxy ? { proxyRules: p.proxy } : { mode: 'system' });
  }
  log('prywatnosc:', JSON.stringify(p));
}

// Usuniecie wszystkiego, co strony zdazyly zapisac - ciasteczka, magazyny, cache, hasla sesji.
async function wyczyscDane() {
  for (const s of [sesja, sesjaUlotna]) {
    if (!s) continue;
    await s.clearStorageData();
    await s.clearCache();
    await s.clearAuthCache();
  }
  log('wyczyszczono dane przegladania');
}

// ====================================================== sesja (uklad biezacy)

// Sesja w pamieci. Wczesniej kazde pytanie o ustawienie (motyw, prywatnosc, obrysy...)
// czytalo plik z dysku, a przesuwanie mapy wyzwala takie pytania kilkanascie razy na sekunde -
// z tego brala sie wieksza czesc mulenia. Plik jest teraz tylko zapisem trwalym.
let sesjaWPamieci = null;

function czytajSesje() {
  if (sesjaWPamieci) return sesjaWPamieci;
  try {
    const dane = JSON.parse(czytajTekst(PLIK_SESJA));
    sesjaWPamieci = { ...dane, okna: Array.isArray(dane.okna) ? dane.okna : [] };
  } catch {
    sesjaWPamieci = { aktywny: null, motyw: null, katalogStanow: null, okna: [] };
  }
  return sesjaWPamieci;
}

function zapiszSesje(zmiany) {
  const dane = { ...czytajSesje(), ...zmiany };
  sesjaWPamieci = dane;
  fs.mkdirSync(DANE, { recursive: true });
  fs.writeFileSync(PLIK_SESJA, JSON.stringify(dane, null, 2), 'utf8');
  return dane;
}

async function zapiszSesjeAuto() {
  const opis = await migawka();
  if (!opis.length) return; // zamkniecie ostatniego okna nie kasuje zapamietanego ukladu
  zapiszSesje({ okna: opis });
  odswiezAktywnyUklad(opis);
}

// Dopisanie biezacych adresow do otwartego pliku ukladu: "Wyry" jutro otworzy sie tam,
// gdzie dzis skonczyles. Aktualizacja SCALA, a nie nadpisuje - okno zamkniete na chwile
// zostaje w ukladzie, bo inaczej jedno klikniecie w krzyzyk kasowaloby je na zawsze.
// Trwale usuniecie okna z ukladu robi swiadomy zapis: Ctrl+S.
function odswiezAktywnyUklad(opis) {
  if (!autoZapisUkladu()) return;
  if (ukladOkrojony) return; // patrz dopasujDoEkranow
  const sciezka = czytajSesje().aktywny;
  if (!sciezka || !fs.existsSync(sciezka)) return;

  try {
    const stan = czytajStanZPliku(sciezka);
    if (!stan) return;

    // Dopasowanie okna z pliku do okna otwartego teraz. Najpewniejszy jest trwaly
    // identyfikator, ale uklady zapisane wczesniej (albo przygotowane recznie) go nie maja -
    // wtedy szukamy po nazwie strony i roli monitora, a na koncu po samej nazwie.
    // Kazde biezace okno zuzywa sie raz, wiec nic nie trafi do pliku podwojnie.
    const wolne = [...opis];
    const wez = (pasuje) => {
      const i = wolne.findIndex(pasuje);
      return i < 0 ? null : wolne.splice(i, 1)[0];
    };

    const scalone = stan.okna.map((stare) =>
      (stare.idUkladu && wez((o) => o.idUkladu === stare.idUkladu))
      || wez((o) => o.aplikacja === stare.aplikacja && o.rola === stare.rola)
      || wez((o) => o.aplikacja === stare.aplikacja)
      || stare,
    );

    // Okna otwarte dodatkowo, ponad to, co bylo w pliku.
    scalone.push(...wolne);

    fs.writeFileSync(sciezka, JSON.stringify({
      wersja: WERSJA_STANU,
      nazwa: stan.nazwa,
      zapisano: new Date().toISOString(),
      okna: scalone,
    }, null, 2), 'utf8');
  } catch (e) {
    log('nie udalo sie odswiezyc ukladu:', e.message);
  }
}

// Zapis z opoznieniem: seria zamkniec przy wyjsciu nie zdazy nadpisac ukladu
// okrojona lista, a przesuwanie okna myszka zapisuje sie raz, nie co piksel.
let timerSesji = null;
let konczymyPrace = false; // trwa zamykanie calego stanowiska
let ukladOkrojony = false; // pracujemy na mniejszej liczbie ekranow niz ma uklad
function zapiszSesjePozniej(ms = 1500) {
  clearTimeout(timerSesji);
  timerSesji = setTimeout(zapiszSesjeAuto, ms);
}

// ================================================= odczyt miejsca w aplikacji

// Pelny adres, przewiniecie strony i - jesli aplikacja ma w .ini 'stan_js' - dowolny
// opis widoku (wspolrzedne kamery, zasieg mapy, zaznaczony obiekt).
async function stanStrony(w, k) {
  const wc = k.view.webContents;
  if (wc.isDestroyed()) return null;

  if (k.ostatniDobryUrl === START) return { url: START, scroll: null, widok: null, zoom: 1, tytul: 'Start' };

  const url = wc.getURL();
  if (!url || /^(data|about|chrome|devtools|file):/i.test(url)) return null; // strona bledu, nie aplikacja

  try {
    const podstawa = await wc.executeJavaScript(`(() => {
      const el = document.scrollingElement || document.documentElement;
      return { url: location.href, scroll: { x: el.scrollLeft, y: el.scrollTop } };
    })()`, true);

    let widok = null;
    if (w.aplikacja.stan_js) {
      // Wyrazenie z .ini nie moze wywrocic zapisu calego stanu.
      widok = await wc.executeJavaScript(
        `(() => { try { return (${w.aplikacja.stan_js}); } catch (e) { return null; } })()`, true);
    }
    return { ...podstawa, widok, zoom: wc.getZoomFactor(), tytul: k.tytul || '' };
  } catch {
    return null; // strona jeszcze sie laduje albo nie wpuszcza skryptu
  }
}

async function opiszKarte(w, k) {
  const strona = await stanStrony(w, k);
  const zapas = k.ostatniOpis || {};

  const opis = {
    url: (strona && strona.url) || k.ostatniDobryUrl || w.aplikacja.url,
    tytul: (strona && strona.tytul) || k.tytul || zapas.tytul || '',
    scroll: strona ? strona.scroll : zapas.scroll || null,
    zoom: strona ? strona.zoom : zapas.zoom || 1,
    widok: strona ? strona.widok : zapas.widok || null,
  };

  k.ostatniOpis = opis; // zapas, gdyby strona nie odpowiedziala przy nastepnym zapisie
  return opis;
}

// Opis okna: aplikacja, monitor, geometria i wszystkie karty z miejscem w aplikacji.
async function opiszOkno(w) {
  const bounds = w.okno.getBounds();
  const karty = await Promise.all(w.karty.map((k) => opiszKarte(w, k)));
  const aktywna = Math.max(0, w.karty.findIndex((k) => k.id === w.aktywna));

  return {
    idUkladu: w.idUkladu,
    aplikacja: w.aplikacja.nazwa,
    ...opiszEkran(screen.getDisplayMatching(bounds).id), // displayId + pozycja + rola
    bounds,
    maximized: w.okno.isMaximized(),
    prywatne: w.prywatne,
    karty,
    aktywna,
    ...karty[aktywna], // url i reszta na wierzchu - czyta to takze starsza wersja programu
  };
}

// Wersja synchroniczna: bierze ostatni znany opis kazdej karty zamiast pytac strone.
// Przy zamykaniu okna nie ma czasu na odpowiedz renderera, a zapis musi zdazyc.
function migawkaSync() {
  return [...okna.values()]
    .filter((w) => !w.okno.isDestroyed())
    .map((w) => {
      const bounds = w.okno.getBounds();
      const karty = w.karty.map((k) => k.ostatniOpis || { url: k.ostatniDobryUrl, tytul: k.tytul || '' });
      const aktywna = Math.max(0, w.karty.findIndex((k) => k.id === w.aktywna));
      return {
        idUkladu: w.idUkladu,
        aplikacja: w.aplikacja.nazwa,
        ...opiszEkran(screen.getDisplayMatching(bounds).id),
        bounds,
        maximized: w.okno.isMaximized(),
        prywatne: w.prywatne,
        karty,
        aktywna,
        ...karty[aktywna],
      };
    });
}

async function migawka() {
  const zywe = [...okna.values()].filter((w) => !w.okno.isDestroyed());
  return Promise.all(zywe.map(opiszOkno));
}

// Stan zapisany starszym formatem ma jedno okno = jedna strona; nowy ma liste kart.
function kartyZOpisu(wpis) {
  if (Array.isArray(wpis.karty) && wpis.karty.length) return wpis.karty;
  return [{ url: wpis.url, scroll: wpis.scroll, zoom: wpis.zoom, widok: wpis.widok, tytul: wpis.tytul }];
}

// ============================================== otwieranie i zapis stanu (UI)

function wczytajStanZPliku(sciezka) {
  const stan = czytajStanZPliku(sciezka);
  if (!stan) {
    dialog.showErrorBox(NAZWA, 'Nie udalo sie odczytac pliku stanu:\n' + sciezka);
    return;
  }

  zapiszSesje({ aktywny: sciezka });

  log('wczytuje stan', sciezka, '| bylo okien:', okna.size, '| bedzie:', stan.okna.length);
  const poprzednie = [...okna.values()];

  // Najpierw nowe okna, dopiero potem zamkniecie starych. Gdyby bylo odwrotnie,
  // liczba okien spadlaby na chwile do zera, a wtedy Electron konczy caly program
  // (zdarzenie window-all-closed) i nowe okna gasna zaraz po otwarciu.
  ukladOkrojony = false;
  przelaczamyStan = true;
  for (const wpis of dopasujDoEkranow(stan.okna)) otworzOkno(wpis);

  for (const w of poprzednie) {
    okna.delete(w.id);
    w.okno.removeAllListeners('close');
    w.okno.destroy();
  }
  przelaczamyStan = false;
  log('stan wczytany | okien teraz:', okna.size);
}

async function zapiszJako(w) {
  const wynik = await dialog.showSaveDialog(w.okno, {
    title: 'Zapisz stan pracy',
    defaultPath: path.join(katalogStanow, 'nowy stan.' + ROZSZERZENIE),
    filters: [{ name: 'Uklad pracy Nebu', extensions: [ROZSZERZENIE] }, { name: 'Wszystkie pliki', extensions: ['*'] }],
    properties: ['createDirectory'],
  });
  if (wynik.canceled || !wynik.filePath) return;

  const sciezka = wynik.filePath.toLowerCase().endsWith('.' + ROZSZERZENIE)
    ? wynik.filePath
    : wynik.filePath + '.' + ROZSZERZENIE;

  await zapiszStanDoPliku(sciezka, path.basename(sciezka, '.' + ROZSZERZENIE));
}

async function otworzZPliku(w) {
  const wynik = await dialog.showOpenDialog(w.okno, {
    title: 'Otworz stan pracy',
    defaultPath: katalogStanow,
    filters: [{ name: 'Uklad pracy', extensions: ROZSZERZENIA_CZYTANE }, { name: 'Wszystkie pliki', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (wynik.canceled || !wynik.filePaths.length) return;
  wczytajStanZPliku(wynik.filePaths[0]);
}

// Ctrl+S - zapis do stanu, z ktorego pracujesz; gdy takiego nie ma, pyta o plik.
async function zapiszBiezacy(w) {
  const aktywny = czytajSesje().aktywny;
  if (aktywny && fs.existsSync(aktywny)) {
    await zapiszStanDoPliku(aktywny, path.basename(aktywny, '.' + ROZSZERZENIE));
    return;
  }
  await zapiszJako(w);
}

async function usunStan(w, wpis) {
  const odpowiedz = await dialog.showMessageBox(w.okno, {
    type: 'question',
    buttons: ['Usun', 'Anuluj'],
    defaultId: 1,
    cancelId: 1,
    message: 'Usunac stan "' + wpis.nazwa + '"?',
    detail: wpis.sciezka,
  });
  if (odpowiedz.response !== 0) return;

  try { fs.unlinkSync(wpis.sciezka); } catch { /* ktos skasowal plik wczesniej */ }
  if (czytajSesje().aktywny === wpis.sciezka) zapiszSesje({ aktywny: null });
  odswiezPaski();
}

// ================================================================== geometria

function ekranNumer(nr) {
  const ekrany = ekranyOdLewej();
  const n = Math.max(1, parseInt(nr, 10) || 1);
  return ekrany[Math.min(n, ekrany.length) - 1] || screen.getPrimaryDisplay();
}

function ekranPoId(id) {
  return ekranyOdLewej().find((e) => e.id === id) || null;
}

// Monitory uporzadkowane tak, jak stoja na biurku - od lewej do prawej.
// Kolejnosc zwracana przez system bywa przypadkowa, wiec sortujemy po wspolrzednej X.
// Wynik trzymamy w pamieci: przy przesuwaniu mapy pasek odswieza sie kilkanascie razy
// na sekunde, a monitory nie zmieniaja sie miedzy jednym drgnieciem a drugim.
let ekranyWPamieci = null;

function ekranyOdLewej() {
  if (!ekranyWPamieci) {
    ekranyWPamieci = screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x);
  }
  return ekranyWPamieci;
}

function zapomnijEkrany() { ekranyWPamieci = null; }

// Rola monitora: gdzie stoi, a nie jaki ma numer seryjny. Dzieki temu przelozenie kabli
// albo zmiana rozdzielczosci nie rozsypuje ukladu - okno wraca na "srodkowy", nie na "ten".
function opiszEkran(displayId) {
  const lista = ekranyOdLewej();
  const pozycja = Math.max(0, lista.findIndex((e) => e.id === displayId));
  return {
    displayId,
    pozycja: pozycja + 1,        // 1 = najbardziej z lewej
    ekranow: lista.length,
    rola: rolaEkranu(pozycja, lista.length),
  };
}

function rolaEkranu(pozycja, ile) {
  if (ile <= 1) return 'jedyny';
  if (pozycja === 0) return 'lewy';
  if (pozycja === ile - 1) return 'prawy';
  return ile === 3 ? 'srodkowy' : 'srodkowy-' + pozycja;
}

// Wybor monitora przy otwieraniu okna. Kolejnosc prob:
// 1. ten sam monitor, jesli wciaz jest podlaczony i uklad monitorow sie nie zmienil,
// 2. ta sama pozycja od lewej, gdy liczba monitorow sie zgadza,
// 3. ta sama rola - lewy zostaje lewym, prawy prawym, srodkowy ladem w srodku,
// 4. monitor glowny, gdy nic nie pasuje.
function ekranDlaOpisu(wpis) {
  const lista = ekranyOdLewej();

  const poId = lista.find((e) => e.id === wpis.displayId);
  if (poId && (!wpis.ekranow || wpis.ekranow === lista.length)) return poId;

  if (wpis.pozycja && wpis.ekranow === lista.length) return lista[wpis.pozycja - 1] || poId || lista[0];

  switch (wpis.rola) {
    case 'lewy':  return lista[0];
    case 'prawy': return lista[lista.length - 1];
    case 'srodkowy': return lista[Math.floor((lista.length - 1) / 2)];
    default: break;
  }
  if (wpis.rola && wpis.rola.startsWith('srodkowy-')) {
    const nr = parseInt(wpis.rola.split('-')[1], 10);
    if (nr) return lista[Math.min(nr, lista.length - 1)];
  }
  return poId || screen.getPrimaryDisplay();
}

function ustalGeometrie(wpis) {
  const ekran = ekranDlaOpisu(wpis);

  if (wpis.bounds && zawieraSie(wpis.bounds, ekran.workArea)) {
    return { bounds: wpis.bounds, maximized: !!wpis.maximized, ekranId: ekran.id };
  }

  const { x, y, width, height } = ekran.workArea;
  return {
    bounds: { x: x + 20, y: y + 20, width: Math.max(800, width - 40), height: Math.max(600, height - 40) },
    maximized: wpis.maximized !== false,
    ekranId: ekran.id,
  };
}

// Srodek okna w obszarze roboczym monitora - tyle wystarczy, zeby uznac pozycje za sensowna.
function zawieraSie(b, obszar) {
  const srodekX = b.x + b.width / 2;
  const srodekY = b.y + b.height / 2;
  return srodekX >= obszar.x && srodekX <= obszar.x + obszar.width
      && srodekY >= obszar.y && srodekY <= obszar.y + obszar.height;
}

let trwaPodnoszenie = false;

// Wszystkie okna ukladu na wierzch. Kolejnosc ma znaczenie: najpierw pozostale,
// na koncu to, ktore uzytkownik wybral - zeby zostalo na samej gorze i z fokusem.
function podniesGrupe(wybrane) {
  if (!razemNaWierzch() || trwaPodnoszenie) return;
  trwaPodnoszenie = true;

  try {
    for (const w of okna.values()) {
      if (w.id === wybrane.id || w.okno.isDestroyed()) continue;
      // showInactive przywraca zwiniete okno, nie odbierajac fokusu wybranemu.
      if (w.okno.isMinimized()) w.okno.showInactive();
      w.okno.moveTop();
    }
    if (!wybrane.okno.isDestroyed()) wybrane.okno.moveTop();
  } catch (e) {
    log('podnoszenie okien:', e.message);
  } finally {
    // Krotka blokada - inaczej zmiana kolejnosci okien wywolalaby sie sama w kolko.
    setTimeout(() => { trwaPodnoszenie = false; }, 250);
  }
}

function przeniesNaEkran(w, displayId) {
  const ekran = ekranPoId(displayId);
  if (!ekran) return;

  const bylZmaksymalizowany = w.okno.isMaximized();
  if (bylZmaksymalizowany) w.okno.unmaximize();

  const { x, y, width, height } = ekran.workArea;
  const b = w.okno.getBounds();
  w.okno.setBounds({
    x: x + 20,
    y: y + 20,
    width: Math.min(b.width, width - 40),
    height: Math.min(b.height, height - 40),
  });

  if (bylZmaksymalizowany) w.okno.maximize();
  w.okno.focus();
}

// ======================================================================= karty

// Rzad kart pokazuje sie w oknie WWW zawsze, w oknie aplikacji dopiero od drugiej karty.
function pokazacKarty(w) {
  return czyWww(w.aplikacja) || w.karty.length > 1;
}

function wysokoscPaska(w) {
  return WYS_NARZEDZI + (pokazacKarty(w) ? WYS_KART : 0);
}

function ulozWidoki(w) {
  const { width, height } = w.okno.getContentBounds();
  const gora = wysokoscPaska(w);
  w.pasek.setBounds({ x: 0, y: 0, width, height: gora });
  for (const k of w.karty) {
    k.view.setBounds({ x: 0, y: gora, width, height: Math.max(0, height - gora) });
  }
}

function kartaAktywna(w) {
  return w.karty.find((k) => k.id === w.aktywna) || w.karty[0];
}

// Czy adres to wciaz nasza strona startowa - jedyna, ktorej wolno zostac w karcie z preloadem.
function czyAdresStartu(url) {
  const t = String(url || '');
  if (t === START) return true;
  try {
    const u = new URL(t);
    return u.protocol === 'file:' && /(^|\/)start\.html$/i.test(u.pathname);
  } catch (_) { return false; }
}

// Adres wskazany w karcie startowej (wpisany, kliknety, wybrany z kafelka) otwieramy w nowej
// karcie - bez preloadu i w piaskownicy - a startowa zamykamy. Najpierw nowa, potem zamkniecie:
// odwrotna kolejnosc zostawia okno na chwile bez kart.
function przeniesDoZwyklejKarty(w, k, url) {
  utworzKarte(w, { url }, true);
  zamknijKarte(w, k.id);
  zapiszSesjePozniej(800);
}

// Jedyne wejscie do nawigacji karty z naszej strony (menu, kafelki, pole adresu). Nawigacja
// wywolana przez glowny proces nie przechodzi przez 'will-navigate', wiec sito jest tutaj.
function nawigujKarte(w, k, url) {
  if (!k) return;
  if (k.startowa && !czyAdresStartu(url)) { przeniesDoZwyklejKarty(w, k, url); return; }
  k.view.webContents.loadURL(url);
}

function utworzKarte(w, opis, aktywuj = true) {
  const adres = (opis && opis.url) || w.aplikacja.url;
  const startowa = adres === START;

  // Most 'geo' dostaje tylko nasza strona startowa - zadna strona z internetu.
  // Piaskownica i wspolna sesja obowiazuja TAKZE te karte. Bez `session` chodzila ona po sesji
  // domyslnej, czyli poza zasadami prywatnosci (blokada sledzenia, DNT) i poza sitem uprawnien
  // - a brak sita znaczy u Electrona ZGODE, wiec strona dostawalaby kamere, mikrofon i polozenie
  // bez pytania.
  const view = new WebContentsView({
    webPreferences: startowa
      ? {
        preload: path.join(KATALOG, 'preload.js'), contextIsolation: true, spellcheck: false,
        sandbox: true, session: w.prywatne ? sesjaUlotna : sesja,
      }
      : { session: w.prywatne ? sesjaUlotna : sesja, contextIsolation: true, sandbox: true },
  });
  const k = {
    id: ++licznikKart,
    view,
    startowa,
    tytul: '',
    ostatniDobryUrl: adres,
    doPrzywrocenia: opis || null,
    ostatniOpis: null,
  };
  w.karty.push(k);
  w.okno.contentView.addChildView(view);
  view.setVisible(false);

  const wc = view.webContents;

  wc.on('page-title-updated', (_zd, tytul) => { k.tytul = tytul; odswiezPasek(w); });
  wc.on('console-message', (zd) => {
    // Most z mapy 2D: strona zglasza KONIEC ruchu mapy, nie kazde drgniecie.
    if (zd.message && zd.message.startsWith('NEBU-KAMERA ')) {
      log('kamera 3D po poleceniu:', zd.message.slice('NEBU-KAMERA '.length));
      return;
    }
    if (zd.message && zd.message.startsWith('NEBU-WIDOK ')) {
      if (synchronizacjaWlaczona() && rolaOkna(w) === 'mapa2d' && k.id === w.aktywna) {
        try {
          const dane = JSON.parse(zd.message.slice('NEBU-WIDOK '.length));
          if (Array.isArray(dane.bbox) && dane.bbox.length === 4) wyslijWidok(dane.bbox, dane.bbox.join(','), 0);
        } catch (e) { log('most 2D: zle zgloszenie -', e.message); }
      }
      return;
    }
    if (zd.level !== 'error') return;
    if (/Electron Security Warning/.test(zd.message)) return; // pouczenia znikaja po spakowaniu
    log('strona:', zd.message.slice(0, 200), '|', (zd.sourceId || '') + ':' + (zd.lineNumber || 0));
  });
  for (const zdarzenie of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) {
    wc.on(zdarzenie, () => {
      const url = wc.getURL();
      if (url && !/^(data|about|chrome|devtools|file):/i.test(url)) k.ostatniDobryUrl = url;
      odswiezPasek(w);

      // Widok z adresu bierzemy TYLKO przy pierwszym wejsciu na strone (otwarcie ukladu,
      // wklejony link). Dalej rzadzi most: strona zglasza koniec ruchu mapy sama, wiec
      // model nie dostaje dziesieciu poleceni na jedno przeciagniecie.
      if (zdarzenie === 'did-navigate' && synchronizacjaWlaczona()
          && rolaOkna(w) === 'mapa2d' && k.id === w.aktywna) {
        const bbox = bboxZAdresu(url);
        if (bbox) przeniesWidokDo3D(bbox);
      }

      // Integracje pisane przez uzytkownika. Dzialaja w KAZDEJ edycji, takze publicznej -
      // nie maja nic wspolnego z geodezja, czytaja adres i otwieraja adres.
      if (zdarzenie === 'did-navigate' && k.id === w.aktywna && url) integracjeZeZrodla(w, url);
    });
  }
  wc.on('did-finish-load', () => {
    przywrocWidok(w, k);
    const rola = rolaOkna(w);
    if (rola === 'amz') przytnijObreby(k);
    if (rola === 'mapa2d') wstrzyknijMost(k, 'most-2d.js');
    if (rola === 'model3d') wstrzyknijMost(k, 'most-3d.js');
  });

  // Google odmawia logowania kazdej przegladarce osadzonej w aplikacji - takiej jak ta.
  // Zamiast zostawiac uzytkownika ze sucha strona odmowy, mowimy o co chodzi
  // i proponujemy jedyne wyjscie, ktore dziala: przegladarke systemowa.
  wc.on('did-navigate', (_zd, adres) => {
    if (adres.includes('accounts.google.com') && /rejected|InformError|deniedsignin/i.test(adres)) {
      wyjasnijBlokadeGoogle(w, k);
    }
  });

  // Serwer nie odpowiada - komunikat zamiast pustego bialego okna.
  wc.on('did-fail-load', (_zd, kod, opisBledu, adres, glowna) => {
    if (!glowna || kod === -3) return; // -3 = nawigacja przerwana przez uzytkownika
    wc.loadURL(stronaBledu(w.aplikacja.nazwa, adres, kod, opisBledu));
  });

  // Okno WWW zachowuje sie jak zwykla przegladarka: link z target=_blank otwiera nowa karte.
  // Aplikacja firmowa wypycha takie linki na zewnatrz, zeby nie mnozyc okien roboczych.
  wc.setWindowOpenHandler(({ url }) => {
    if (czyWww(w.aplikacja)) {
      utworzKarte(w, { url }, true);
      zapiszSesjePozniej(800);
      return { action: 'deny' };
    }
    // TYLKO http(s) i poczta. shell.openExternal oddaje adres systemowi, a system uruchamia
    // to, co do schematu przypisano: `file:` otwiera plik, `ms-msdt:`/`search-ms:` i podobne
    // potrafia uruchomic program. Adres przychodzi tu ze STRONY (window.open), wiec bez tego
    // sita dowolna strona wskazywalaby, co uruchomic na komputerze uzytkownika.
    if (bezpiecznyDoOtwarcia(url)) shell.openExternal(url);
    else log('zablokowany adres zewnetrzny:', String(url).slice(0, 120));
    return { action: 'deny' };
  });

  // Karta startowa jest JEDYNA z preloadem, czyli z `window.geo` - sterowaniem programem
  // (zapis listy stron, otwarcie pliku stanu, czyszczenie danych, DevTools). Gdy uzytkownik
  // wpisal w niej adres albo kliknal link, strona z sieci ladowala sie W TYM SAMYM renderze,
  // a wiec z tym dostepem. Dlatego nawigacji tu nie puszczamy: adres otwieramy w nowej,
  // zwyklej karcie - bez preloadu, w piaskownicy. Dla uzytkownika wychodzi na to samo.
  if (startowa) {
    wc.on('will-navigate', (zdarzenie, cel) => {
      if (czyAdresStartu(cel)) return;
      zdarzenie.preventDefault();
      log('karta startowa: adres przeniesiony do zwyklej karty ->', String(cel).slice(0, 120));
      przeniesDoZwyklejKarty(w, k, cel);
    });
  }

  podepnijSkroty(wc, w.id);
  if (startowa) { k.tytul = 'Start'; wc.loadFile(path.join(KATALOG, 'start.html')); }
  else wc.loadURL(adres);

  if (aktywuj) aktywujKarte(w, k.id);
  else { ulozWidoki(w); odswiezPasek(w); }
  return k;
}

function aktywujKarte(w, id) {
  if (!w.karty.some((k) => k.id === id)) return;
  w.aktywna = id;
  for (const k of w.karty) k.view.setVisible(k.id === id);
  ulozWidoki(w);
  odswiezPasek(w);
  const k = kartaAktywna(w);
  if (k && !k.view.webContents.isDestroyed()) k.view.webContents.focus();
}

function zamknijKarte(w, id) {
  log('zamykam karte', id, 'w oknie', w.id, '| kart', w.karty.length);
  const i = w.karty.findIndex((k) => k.id === id);
  if (i < 0) return;

  if (w.karty.length === 1) { w.okno.close(); return; } // ostatnia karta = zamkniecie okna

  const k = w.karty[i];
  wyjasnioneKarty.delete(k.id);
  w.karty.splice(i, 1);
  w.okno.contentView.removeChildView(k.view);
  k.view.webContents.close();

  if (w.aktywna === id) aktywujKarte(w, w.karty[Math.min(i, w.karty.length - 1)].id);
  else { ulozWidoki(w); odswiezPasek(w); }
  zapiszSesjePozniej(800);
}

function przelaczKarte(w, krok) {
  if (w.karty.length < 2) return;
  const i = w.karty.findIndex((k) => k.id === w.aktywna);
  const nowy = (i + krok + w.karty.length) % w.karty.length;
  aktywujKarte(w, w.karty[nowy].id);
}

// ======================================================================= okno

function otworzOkno(wpis) {
  const aplikacja = aplikacjaPoNazwie(wpis.aplikacja);
  if (!aplikacja) return null;

  const geom = ustalGeometrie(wpis);
  const id = ++licznikOkien;
  log('otwieram okno', id, aplikacja.nazwa, '| ekran:', opiszEkran(geom.ekranId || ekranDlaOpisu(wpis).id).rola, '| kart:', kartyZOpisu(wpis).length);

  const okno = new BaseWindow({
    ...geom.bounds,
    title: aplikacja.nazwa + (wpis.prywatne ? ' (prywatne)' : '') + ' - ' + NAZWA + (PROFIL ? ' [' + PROFIL + ']' : ''),
    backgroundColor: '#1e1e1e',
    show: false,
  });

  const pasek = new WebContentsView({
    webPreferences: { preload: path.join(KATALOG, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  pasek.webContents.loadFile(path.join(KATALOG, 'pasek.html'));
  okno.contentView.addChildView(pasek);

  const w = {
    id, okno, pasek, aplikacja, karty: [], aktywna: null,
    // Znak rozpoznawczy okna w ukladzie - przezywa przeniesienie na inny monitor
    // i zmiane strony. Bez niego zapis dopisywalby kopie zamiast aktualizowac wpis.
    idUkladu: wpis.idUkladu || 'okno-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    // Okno prywatne nie zostawia sladu: ciasteczka i magazyny gina z zamknieciem programu.
    prywatne: wpis.prywatne !== undefined ? !!wpis.prywatne : prywatnosc().niePamietaj,
  };
  // Reszta programu pyta o biezaca karte przez w.tresc - tak jak wczesniej o jedyny widok.
  Object.defineProperty(w, 'tresc', { get: () => { const k = kartaAktywna(w); return k ? k.view : null; } });
  okna.set(id, w);

  okno.on('resize', () => ulozWidoki(w));
  pasek.webContents.on('did-finish-load', () => odswiezPasek(w));

  podepnijSkroty(pasek.webContents, id);

  const karty = kartyZOpisu(wpis);
  karty.forEach((opisKarty) => utworzKarte(w, opisKarty, false));
  const aktywna = Math.min(Math.max(0, parseInt(wpis.aktywna, 10) || 0), w.karty.length - 1);
  aktywujKarte(w, w.karty[aktywna].id);

  // Zamkniecie okna czeka dluzej niz przesuniecie: wychodzac z programu zamykasz okna
  // jedno po drugim, a kazde takie zamkniecie resetuje odliczanie. Gdy znikna wszystkie,
  // migawka jest pusta i zapis nie dochodzi do skutku - uklad z trzema oknami zostaje caly.
  // Okna ukladu sa jednym stanowiskiem pracy, wiec zamkniecie ktoregokolwiek konczy calosc:
  // zapisujemy komplet - wszystkie monitory, okna i karty - i zamykamy program.
  // Pojedyncza karte zamyka Ctrl+W, a pojedyncze okno usuwa sie z ukladu zapisem Ctrl+S.
  okno.on('close', (zdarzenie) => {
    if (konczymyPrace) return; // juz trwa zamykanie calosci - nie wchodzimy w to drugi raz
    konczymyPrace = true;
    zdarzenie.preventDefault(); // najpierw zapis, dopiero potem zamkniecie

    const uklad = migawkaSync(); // wszystkie okna jeszcze istnieja
    log('zamykam stanowisko | okien:', uklad.length, '| ekranow:', ekranyOdLewej().length);
    try {
      zapiszSesje({ okna: uklad });
      odswiezAktywnyUklad(uklad);
    } catch (e) {
      log('blad zapisu przy zamykaniu:', e.message);
    }
    app.quit();
  });

  okno.on('focus', () => podniesGrupe(w));
  okno.on('moved', () => { odswiezPasek(w); zapiszSesjePozniej(); });
  okno.on('resized', () => zapiszSesjePozniej());
  okno.on('maximize', () => zapiszSesjePozniej(300));
  okno.on('unmaximize', () => zapiszSesjePozniej(300));

  if (geom.maximized) okno.maximize();
  okno.show();
  return w;
}

// Odtworzenie miejsca w aplikacji po zaladowaniu strony: powiekszenie, przewiniecie
// i - gdy aplikacja ma w .ini 'przywroc_js' - wlasny widok (kamera, zasieg mapy).
// Mapy i modele 3D dociagaja dane po zaladowaniu dokumentu, stad odczekanie.
async function przywrocWidok(w, k) {
  const wpis = k.doPrzywrocenia;
  k.doPrzywrocenia = null; // tylko pierwsze zaladowanie; pozniejsza nawigacja to decyzja uzytkownika
  if (!wpis) return;

  const wc = k.view.webContents;
  if (wc.isDestroyed()) return;

  if (wpis.zoom && wpis.zoom !== 1) wc.setZoomFactor(wpis.zoom);

  const zwloka = parseInt(w.aplikacja.opoznienie_ms, 10) || 1200;
  setTimeout(async () => {
    if (wc.isDestroyed()) return;
    try {
      if (wpis.scroll) {
        await wc.executeJavaScript(`window.scrollTo(${Number(wpis.scroll.x) || 0}, ${Number(wpis.scroll.y) || 0})`, true);
      }
      if (wpis.widok != null && w.aplikacja.przywroc_js) {
        await wc.executeJavaScript(
          `(STAN => { try { ${w.aplikacja.przywroc_js} } catch (e) { console.warn('przywroc_js:', e); } })(${JSON.stringify(wpis.widok)})`, true);
      }
    } catch { /* strona nie wpuscila skryptu - uklad okien i tak jest odtworzony */ }
  }, zwloka);
}

// Przy przesuwaniu mapy zdarzenia nawigacji lecia lawinowo. Pasek pokazuje adres i role
// ekranu - odswiezanie go czesciej niz kilka razy na sekunde niczego nie wnosi.
const odswiezaniePaska = new WeakMap();

function odswiezPasek(w, natychmiast) {
  if (w.okno.isDestroyed() || w.pasek.webContents.isDestroyed()) return;

  if (!natychmiast) {
    const teraz = Date.now();
    const ostatnio = odswiezaniePaska.get(w) || 0;
    if (teraz - ostatnio < 120) return;
    odswiezaniePaska.set(w, teraz);
  }
  const k = kartaAktywna(w);
  if (!k) return;

  const wc = k.view.webContents;
  const aktywny = czytajSesje().aktywny;

  w.pasek.webContents.send('stan', {
    aplikacja: w.aplikacja.nazwa,
    url: wc.isDestroyed() ? '' : wc.getURL(),
    wstecz: !wc.isDestroyed() && wc.navigationHistory.canGoBack(),
    naprzod: !wc.isDestroyed() && wc.navigationHistory.canGoForward(),
    ekran: numerEkranu(w),
    ekranow: ekranyOdLewej().length,
    rolaEkranu: opiszEkran(screen.getDisplayMatching(w.okno.getBounds()).id).rola,
    stanAktywny: aktywny ? path.basename(aktywny, '.' + ROZSZERZENIE) : '\u2014',
    bezAdresu: !!WARIANT.ukryjAdres, // edycja dla klienta zewnetrznego: pasek bez adresu
    zKartami: pokazacKarty(w),
    karty: w.karty.map((karta) => ({
      id: karta.id,
      tytul: etykietaKarty(karta),
      aktywna: karta.id === w.aktywna,
    })),
  });
}

// Krotki podpis karty: tytul strony, a gdy go nie ma - nazwa serwera.
function etykietaKarty(k) {
  if (k.tytul) return k.tytul;
  try {
    const u = new URL(k.ostatniDobryUrl);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return 'nowa karta';
  }
}

function odswiezPaski() {
  for (const w of okna.values()) if (!w.okno.isDestroyed()) odswiezPasek(w, true);
}

function numerEkranu(w) {
  const biezacy = screen.getDisplayMatching(w.okno.getBounds());
  return ekranyOdLewej().findIndex((e) => e.id === biezacy.id) + 1;
}

function stronaBledu(nazwa, adres, kod, opis) {
  const html = '<!doctype html><meta charset="utf-8">'
    + '<body style="background:#1e1e1e;color:#ddd;font:14px Segoe UI,sans-serif;padding:40px">'
    + '<h2 style="color:#e06c5a">' + nazwa + ' nie odpowiada</h2>'
    + '<p>Adres: <code>' + adres + '</code></p>'
    + '<p>Blad: ' + opis + ' (' + kod + ')</p>'
    + '<p style="color:#888">Sprawdz adres i polaczenie z siecia. Po naprawieniu: F5.</p>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// ================================================================ ustawienia

let oknoUstawien = null;

function pokazUstawienia(w) {
  if (oknoUstawien && !oknoUstawien.isDestroyed()) { oknoUstawien.focus(); return; }

  oknoUstawien = new BrowserWindow({
    parent: w ? w.okno : undefined,
    width: 720,
    height: 620,
    title: NAZWA + ' - ustawienia',
    backgroundColor: '#1b1e22',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(KATALOG, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  oknoUstawien.loadFile(path.join(KATALOG, 'ustawienia.html'));
  oknoUstawien.webContents.on('console-message', (zd) => {
    if (zd.level === 'error') log('ustawienia:', zd.message.slice(0, 200));
  });
  oknoUstawien.on('closed', () => { oknoUstawien = null; });
}

// Electron zaleca sprawdzac nadawce KAZDEJ wiadomosci IPC (zalecenie 17). Preload - a wiec
// `window.geo` - dostaja tylko nasze wlasne strony z katalogu programu, wiec warunkiem jest
// plik z dysku o jednej z czterech nazw. Sito jest drugim zamkiem: pierwszym jest to, ze
// karta startowa nie nawiguje na strony z sieci.
const NASZE_STRONY = ['start.html', 'pasek.html', 'ustawienia.html', 'logowanie.html', 'integracje.html'];

function odNaszejStrony(zdarzenie) {
  const adres = (zdarzenie && zdarzenie.senderFrame && zdarzenie.senderFrame.url) || '';
  if (!/^file:\/\//i.test(adres)) return false;
  try { return NASZE_STRONY.includes(path.basename(new URL(adres).pathname)); } catch (_) { return false; }
}

ipcMain.on('ustawienia-daj', (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  zdarzenie.sender.send('ustawienia-dane', {
    motyw: motyw(),
    ekranow: ekranyOdLewej().length,
    katalogStanow,
    prywatnosc: prywatnosc(),
    edycja: NAZWA,
    strony: aplikacje.map((a) => ({
      nazwa: a.nazwa, url: a.url, monitor: a.monitor || 1,
      skrot: a.skrot || '', www: czyWww(a) ? 1 : 0,
    })),
  });
});

// Zapis listy stron. Okna otwarte na stronie, ktora zmienila adres, zostaja nietkniete -
// uzytkownik sam zdecyduje, kiedy je przeladowac.
ipcMain.on('ustawienia-zapisz', (zdarzenie, dane) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const lista = (dane.strony || [])
    .map((s) => ({
      nazwa: String(s.nazwa || '').trim(),
      url: String(s.url || '').trim(),
      monitor: Math.max(1, parseInt(s.monitor, 10) || 1),
      skrot: String(s.skrot || '').trim(),
      www: s.www ? '1' : '',
    }))
    .filter((s) => s.nazwa && s.url);

  if (dane.prywatnosc) {
    zapiszSesje({ prywatnosc: { ...prywatnosc(), ...dane.prywatnosc } });
    zastosujPrywatnosc();
  }

  if (!lista.length) return;
  zapiszStrony(lista);
  aplikacje = czytajStrony();
  log('zapisano strony:', aplikacje.map((a) => a.nazwa).join(', '));

  // Okna trzymaja wskaznik do starego wpisu - podmieniamy go na nowy o tej samej nazwie.
  for (const w of okna.values()) {
    const nowa = aplikacje.find((a) => a.nazwa === w.aplikacja.nazwa);
    if (nowa) w.aplikacja = nowa;
    odswiezPasek(w);
  }
  odswiezStrony();
});

ipcMain.on('ustawienia-czysc', async (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  await wyczyscDane();
  zdarzenie.sender.send('ustawienia-wyczyszczono');
  for (const o of okna.values()) for (const k of o.karty) {
    if (!k.view.webContents.isDestroyed()) k.view.webContents.reload();
  }
});

ipcMain.on('ustawienia-zamknij', () => { if (oknoUstawien && !oknoUstawien.isDestroyed()) oknoUstawien.close(); });

// Strony startowe maja pokazac swiezy zestaw kafelkow.
function odswiezStrony() {
  for (const w of okna.values()) {
    for (const k of w.karty) {
      if (k.ostatniDobryUrl === START && !k.view.webContents.isDestroyed()) k.view.webContents.reload();
    }
  }
}

// Jedna rozmowa na karte - powtarzanie komunikatu przy kazdym odswiezeniu byloby meczace.
const wyjasnioneKarty = new Set();

async function wyjasnijBlokadeGoogle(w, k) {
  if (wyjasnioneKarty.has(k.id)) return;
  wyjasnioneKarty.add(k.id);

  const powrot = k.ostatniDobryUrl;
  log('Google odmowil logowania w oknie', w.id);

  const odpowiedz = await dialog.showMessageBox(w.okno, {
    type: 'info',
    buttons: ['Otworz w przegladarce systemowej', 'Zostan tutaj'],
    defaultId: 0,
    cancelId: 1,
    message: 'Google nie wpuszcza przegladarek osadzonych w aplikacjach',
    detail: 'Dotyczy to kazdego programu, ktory wyswietla strony we wlasnym oknie - Google broni sie tak przed '
      + 'podejrzeniem hasla. To nie jest usterka ' + NAZWA + '.' + String.fromCharCode(10) + String.fromCharCode(10)
      + 'Zaloguj sie w swojej zwyklej przegladarce albo siegnij po dane przez wlasny serwer '
      + '(np. widok arkuszy w OGARNIETYCH), ktory poda je tutaj bez logowania.',
  });

  if (odpowiedz.response === 0 && /^https?:/i.test(powrot)) shell.openExternal(powrot);
}

// ======================================================= synchronizacja 2D -> 3D

// Mapa 2D trzyma widok w adresie (?bbox=minE,minN,maxE,maxN), a model 3D umie do takiego
// zakresu przeleciec wlasna funkcja flyToBboxFromLink(). Nebu tylko przenosi zakres
// z jednego okna do drugiego - zadna z aplikacji nie musi nic wiedziec o tej drugiej.

// Obrysy budynkow z aMAPy na modelu: rysowane przy kazdym skoku kamery, dla tego samego
// zakresu. Skrypt siedzi w osobnym pliku, zeby dalo sie go poprawiac bez grzebania tutaj.
const PLIK_OBRYSOW = path.join(KATALOG, 'narzedzia', 'obrysy-3d.js');

// Do ilu metrow uznajemy, ze budynki sie stykaja - przybudowka albo sasiad wspolna sciana.
// Pol metra wystarcza: obrysy sasiadujacych budynkow maja wspolne albo bliskie naroznik.
let ostatnieObrysy = ''; // podpis ostatnio narysowanego zestawu

function promienObrysow() {
  const p = czytajSesje().stycznoscObrysow;
  return Number.isFinite(p) && p > 0 ? p : 0.6;
}

function obrysyWlaczone() {
  const w = czytajSesje().obrysy3d;
  return w === undefined ? true : !!w;
}

// Na co dzien wystarczy jeden obrys - ten z EwMapy, metr nad ziemia.
// Drugi, wyprostowany, dochodzi pol metra wyzej dopiero wtedy, gdy w aMAPie
// trwa prostowanie: jest podglad "przed/po" albo otwarty eksplorator obiektow.
// Pobiera z okna mapy 2D obrysy do narysowania: budynek spod kursora w Eksploratorze
// i te, ktore sie z nim stykaja. Wybor robimy PO STRONIE aMAPy, bo podglad prostowania
// potrafi miec tysiac budynkow - przesylanie ich za kazdym ruchem mapy zamulalo wszystko.
async function obrysyDoRysowania() {
  const pusto = { obrysy: [], numer: null, skad: 'brak mapy', wszystkich: 0 };

  const mapa = [...okna.values()].find((w) => rolaOkna(w) === 'mapa2d');
  if (!mapa) return pusto;

  const k = kartaAktywna(mapa);
  if (!k || k.view.webContents.isDestroyed()) return pusto;

  const stycznosc = promienObrysow();

  try {
    return await k.view.webContents.executeJavaScript(`(() => {
      if (typeof _prostPodglad === 'undefined' || !_prostPodglad || !_prostPodglad.length) {
        return { obrysy: [], numer: null, skad: 'brak podgladu', wszystkich: 0 };
      }

      const lista = _prostPodglad.filter((o) => o && Array.isArray(o.nowe) && o.nowe.length);
      const pkt = (o) => [].concat(o.nowe || [], o.stare || []);

      // Prostokat otaczajacy - tanie odsianie par, ktore na pewno sie nie stykaja.
      const ramka = (o) => {
        const p = pkt(o);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [X, Y] of p) {
          if (X < minX) minX = X; if (X > maxX) maxX = X;
          if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
        }
        return { minX, minY, maxX, maxY };
      };

      // Ramki liczymy raz na podglad, nie przy kazdym ruchu mapy. Przy tysiacu budynkow
      // to roznica miedzy setkami tysiecy operacji a zerem.
      if (!window.__nebuRamki || window.__nebuRamkiDla !== _prostPodglad) {
        window.__nebuRamki = new Map(lista.map((o) => [o, ramka(o)]));
        window.__nebuRamkiDla = _prostPodglad;
      }
      const ramki = window.__nebuRamki;
      const S = ${stycznosc};

      const ramkiBlisko = (a, b) => {
        const r1 = ramki.get(a), r2 = ramki.get(b);
        return !(r1.minX - S > r2.maxX || r2.minX - S > r1.maxX
              || r1.minY - S > r2.maxY || r2.minY - S > r1.maxY);
      };
      const styka = (a, b) => {
        if (!ramkiBlisko(a, b)) return false;
        for (const [X1, Y1] of pkt(a)) {
          for (const [X2, Y2] of pkt(b)) {
            if (Math.hypot(X1 - X2, Y1 - Y2) <= S) return true;
          }
        }
        return false;
      };

      // Budynek spod kursora w Eksploratorze.
      const wiersz = document.querySelector('#eksDlg tr.biez');
      const uid = wiersz ? String(wiersz.dataset.uid || '') : null;
      const numer = wiersz && wiersz.children[3] ? wiersz.children[3].textContent.trim() : null;

      let biezacy = uid ? lista.find((o) => o.uid != null && String(o.uid) === uid) : null;
      let skad = biezacy ? 'uid' : null;

      if (!biezacy && typeof state !== 'undefined' && state.view) {
        // Zapas: srodek widoku mapy - Eksplorator i tak na nim pozycjonuje.
        const sx = state.view.x + state.view.width / 2;
        const sy = state.view.maxY - state.view.height / 2;
        let naj = Infinity;
        for (const o of lista) {
          for (const [X, Y] of pkt(o)) {
            const d = Math.hypot(X - sx, Y - sy);
            if (d < naj) { naj = d; biezacy = o; }
          }
        }
        skad = 'srodek widoku';
      }
      if (!biezacy) return { obrysy: [], numer, skad: 'nie znalazlem budynku', wszystkich: lista.length };

      // Przybudowki i sasiedzi ze wspolna sciana - rozrost lawinowy.
      const wybrane = new Set([biezacy]);
      let rosnie = true;
      while (rosnie) {
        rosnie = false;
        for (const o of lista) {
          if (wybrane.has(o)) continue;
          for (const w of wybrane) {
            if (styka(w, o)) { wybrane.add(o); rosnie = true; break; }
          }
        }
      }

      return {
        numer, skad, wszystkich: lista.length,
        obrysy: [...wybrane].map((o) => ({
          stare: (o.stare || []).map((p) => [p[0], p[1]]),
          nowe: o.nowe.map((p) => [p[0], p[1]]),
        })),
      };
    })()`, true);
  } catch (e) {
    return { ...pusto, skad: 'blad: ' + e.message };
  }
}

// Rysowanie obrysow prostowania na modelu. Zrodlem jest podglad z aMAPy, bo wyprostowany
// ksztalt istnieje na razie tylko tam. Rysujemy budynek, przy ktorym stoi kursor
// w eksploratorze, jego przybudowki i sasiadow stykajacych sie z nim scianami.
async function pokazObrysy(cel, bbox) {
  if (!obrysyWlaczone()) return;
  const k = kartaAktywna(cel);
  if (!k || k.view.webContents.isDestroyed()) return;

  const stan = await obrysyDoRysowania();
  const podglad = stan.obrysy || [];

  // Nic sie nie zmienilo od ostatniego razu - nie ma po co rysowac od nowa.
  const podpis = (stan.numer || '') + '|' + podglad.length + '|' + JSON.stringify(podglad[0] || null).length;
  if (podpis === ostatnieObrysy) return;
  ostatnieObrysy = podpis;

  let skrypt;
  try { skrypt = fs.readFileSync(PLIK_OBRYSOW, 'utf8'); }
  catch (e) { log('brak skryptu obrysow:', e.message); return; }

  skrypt = skrypt.replaceAll('__OBRYSY__', JSON.stringify(podglad));

  k.view.webContents.executeJavaScript(skrypt, true)
    .then((wynik) => log('obrysy 3D:', wynik, '| kursor:', stan.numer || '?', '| wybor:', stan.skad, '| z', stan.wszystkich))
    .catch((e) => log('obrysy 3D nie przeszly:', e.message));
}

function synchronizacjaWlaczona() {
  const w = czytajSesje().sync2d3d;
  return w === undefined ? true : !!w;
}

// Czy adres wolno oddac systemowi (shell.openExternal). Tylko strony i poczta: kazdy inny
// schemat (file:, smb:, ms-msdt:, search-ms:, …) system potrafi obsluzyc uruchomieniem programu,
// a adresy przychodza tu ze stron, nie od nas.
function bezpiecznyDoOtwarcia(url) {
  try { return /^(https?|mailto):$/i.test(new URL(String(url)).protocol); } catch (_) { return false; }
}

// Rola okna bierze sie z ustawien strony, a gdy ich brak - z adresu.
//
// Dopasowujemy PORT I SCIEZKE, a nie fragment calego adresu. Wczesniej bylo `includes(':8080/viewer')`,
// czyli rola przyklejala sie takze do obcej strony, ktora miala ten ciag gdziekolwiek - choc by
// w zapytaniu (`https://obca.example/?x=:8080/viewer`). A rola decyduje o WSTRZYKNIECIU mostu:
// obca strona dostawalaby nasz kanal do drugiego okna (window.__nebuWidok) i mogla nim sterowac.
function rolaZAdresu(url) {
  if (!WARIANT.geo) return null; // edycja publiczna: zadnych rol, zadnego wstrzykiwania
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (!/^https?:$/i.test(u.protocol)) return null;
  if (u.port === '8080' && u.pathname.startsWith('/viewer')) return 'mapa2d';
  if (u.port === '5000') return 'model3d';
  if (u.port === '5555') return 'amz';
  return null;
}

function rolaStrony(aplikacja) {
  if (aplikacja && aplikacja.rola2d3d) return aplikacja.rola2d3d;
  return rolaZAdresu(aplikacja && aplikacja.url);
}

// Rola okna wedlug tego, CO W NIM JEST, a nie jak nazywa sie pozycja w ustawieniach.
// Edycja bez wgranych stron (czyste Nebu otwierajace plik *.nebu) podstawia wszedzie
// aplikacje "WWW" - i wtedy rozpoznanie po nazwie nie mialo szans. Adres w karcie
// jest jednoznaczny, wiec pytamy najpierw jego.
function rolaOkna(w) {
  if (!w || !WARIANT.geo) return null;
  const k = kartaAktywna(w);
  if (k) {
    const wc = k.view.webContents;
    const biezacy = !wc.isDestroyed() ? wc.getURL() : '';
    const rola = rolaZAdresu(biezacy) || rolaZAdresu(k.ostatniDobryUrl) || rolaZAdresu(k.url);
    if (rola) return rola;
  }
  return rolaStrony(w.aplikacja);
}

// ------------------------------------------------- ograniczenie AMZ do jednej gminy
// Stanowisko pracuje na jednej gminie, a AMZ pokazuje caly powiat. Zamiast zmieniac
// aplikacje na serwerze, przycinamy liste juz w oknie: wariant wskazuje plik z lista
// obrebow, ktore maja zostac. Bez wskazania nic sie nie dzieje.

let listaObrebow; // undefined = jeszcze nie sprawdzone, null = nie ma czego filtrowac

function obrebyDoPozostawienia() {
  if (listaObrebow !== undefined) return listaObrebow;
  listaObrebow = null;

  const plik = WARIANT.filtrObrebow;
  if (plik) {
    try {
      const dane = JSON.parse(fs.readFileSync(path.join(KATALOG, 'listy', plik), 'utf8'));
      // Obreb bywa zapisany dwojako: w TERYT jako CHARZOWICE, w katalogach operatow
      // jako Charzewice. Zostawiamy oba zapisy, zeby filtr trafil niezaleznie od zrodla.
      const dozwolone = (dane.obreby || [])
        .flatMap((o) => (typeof o === 'string' ? [o] : [o.nazwa, o.nazwaAmz]))
        .filter(Boolean);
      if (dozwolone.length) listaObrebow = { dozwolone, znane: dane.znane || [], opis: dane.gminaNazwa || plik };
    } catch (e) {
      log('filtr obrebow: nie moge wczytac', plik, '-', e.message);
    }
  }
  return listaObrebow;
}

function przytnijObreby(k) {
  const lista = obrebyDoPozostawienia();
  if (!lista || k.view.webContents.isDestroyed()) return;

  let skrypt;
  try {
    skrypt = fs.readFileSync(path.join(KATALOG, 'narzedzia', 'filtr-obrebow.js'), 'utf8');
  } catch (e) {
    log('filtr obrebow: brak skryptu -', e.message);
    return;
  }

  skrypt = skrypt
    .replaceAll('__DOZWOLONE__', JSON.stringify(lista.dozwolone))
    .replaceAll('__ZNANE__', JSON.stringify(lista.znane));

  k.view.webContents.executeJavaScript(skrypt)
    .then((wynik) => log('AMZ', lista.opis + ':', wynik))
    .catch((e) => log('filtr obrebow nie zadzialal:', e.message));
}

function bboxZAdresu(url) {
  try {
    const raw = new URL(url).searchParams.get('bbox');
    if (!raw) return null;
    const liczby = raw.split(',').map(Number);
    return liczby.length === 4 && liczby.every(Number.isFinite) ? liczby : null;
  } catch {
    return null;
  }
}

let ostatniBbox = '';
let timerSync = null;

// Przesuwanie mapy zmienia adres kilkanascie razy na sekunde - lecimy dopiero,
// gdy uzytkownik na chwile przystanie.
function przeniesWidokDo3D(bbox) {
  const podpis = bbox.join(',');
  if (podpis === ostatniBbox) return;
  ostatniBbox = podpis;

  clearTimeout(timerSync);
  timerSync = setTimeout(() => wyslijWidok(bbox, podpis, 0), 600);
}

function wyslijWidok(bbox, podpis, proba) {
  const cele = [...okna.values()].filter((w) => rolaOkna(w) === 'model3d');
  if (!cele.length) return;

  for (const cel of cele) {
    const k = kartaAktywna(cel);
    if (!k || k.view.webContents.isDestroyed()) continue;

    // Cala robota siedzi w oknie modelu (most-3d.js): to ono wie, gdzie stoi kamera,
    // czy uzytkownik wlasnie nia rusza i czy cel jest juz w kadrze. Stad leci tylko zakres.
    const wywolanie = 'window.__nebuWidok ? window.__nebuWidok(' + JSON.stringify(bbox) + ') : "brak-mostu"';

    k.view.webContents.executeJavaScript(wywolanie, true)
      .then((wynik) => {
        const stan = String(wynik);
        log('widok 2D -> 3D:', podpis, '|', stan);

        // Obrysy przerysowujemy tylko wtedy, gdy kamera naprawde sie przestawila.
        if (stan.startsWith('ok')) setTimeout(() => pokazObrysy(cel, bbox), 300);

        // Kafle modelu dochodza kilkanascie sekund po otwarciu okna; bez nich nie znamy
        // poziomu terenu. Tak samo, gdy most jeszcze nie zdazyl sie zainstalowac.
        if ((stan === 'czekam-na-model' || stan === 'brak-mostu') && proba < 12) {
          setTimeout(() => wyslijWidok(bbox, podpis, proba + 1), 2500);
        }

        // Model odmowil, bo uzytkownik wlasnie sam krecil kamera. Widok nie moze jednak
        // przepasc - inaczej po puszczeniu myszy model zostaje w starym miejscu i wyglada
        // to jak zerwana integracja. Wracamy do niego, gdy blokada minie.
        if (stan === 'pomijam-reczny-ruch' && proba < 6) {
          setTimeout(() => wyslijWidok(bbox, podpis, proba + 1), 2000);
        }
      })
      .catch((e) => log('widok 2D -> 3D nie przeszedl:', e.message));
  }
}

// ===================================================================== menu

function menuAplikacji(w) {
  return Menu.buildFromTemplate(aplikacje.map((a) => ({
    label: a.nazwa,
    type: 'radio',
    checked: a.nazwa === w.aplikacja.nazwa,
    click: () => {
      w.aplikacja = a;
      w.okno.setTitle(a.nazwa + ' - ' + NAZWA);
      const k = kartaAktywna(w);
      k.ostatniDobryUrl = a.url;
      nawigujKarte(w, k, a.url);
      ulozWidoki(w);
      zapiszSesjePozniej(500);
    },
  })));
}

function menuEkranow(w) {
  const biezacy = numerEkranu(w);
  return Menu.buildFromTemplate(screen.getAllDisplays().map((e, i) => ({
    label: 'Ekran ' + (i + 1) + '  (' + e.size.width + '\u00d7' + e.size.height + ')'
           + (e.id === screen.getPrimaryDisplay().id ? '  - glowny' : ''),
    type: 'radio',
    checked: i + 1 === biezacy,
    click: () => { przeniesNaEkran(w, e.id); zapiszSesjePozniej(500); },
  })));
}

function menuNowegoOkna(w) {
  const ekrany = ekranyOdLewej();
  const pozycjeStron = (prywatne) => aplikacje.map((a) => ({
    label: a.nazwa,
    submenu: ekrany.map((e, i) => ({
      label: (i + 1) + '. ' + rolaEkranu(i, ekrany.length),
      click: () => {
        otworzOkno({ aplikacja: a.nazwa, url: a.url, displayId: e.id, bounds: null, maximized: true, prywatne });
        zapiszSesjePozniej(500);
      },
    })),
  }));

  return Menu.buildFromTemplate([
    ...pozycjeStron(false),
    { type: 'separator' },
    { label: 'Okno prywatne   Ctrl+Shift+N', submenu: pozycjeStron(true) },
  ]);
}

// Menu prywatnosci - przelaczniki i jednorazowe czyszczenie.
function menuPrywatnosci(w) {
  const p = prywatnosc();
  const przelacz = (klucz) => () => {
    zapiszSesje({ prywatnosc: { ...p, [klucz]: !p[klucz] } });
    zastosujPrywatnosc();
    odswiezPaski();
  };

  return Menu.buildFromTemplate([
    { label: 'Tryb tego okna: ' + (w.prywatne ? 'prywatny (nic nie zostaje)' : 'zwykly (logowania pamietane)'), enabled: false },
    { label: 'Nowe okno prywatne   Ctrl+Shift+N', click: () => {
      otworzOkno({ aplikacja: w.aplikacja.nazwa, url: w.aplikacja.url, displayId: screen.getDisplayMatching(w.okno.getBounds()).id, bounds: null, maximized: true, prywatne: true });
    } },
    { type: 'separator' },
    { label: 'Blokuj skrypty sledzace' + (zablokowane ? '  (odcieto ' + zablokowane + ')' : ''),
      type: 'checkbox', checked: p.blokujSledzace, click: przelacz('blokujSledzace') },
    { label: 'Odmawiaj kamery, mikrofonu i polozenia', type: 'checkbox', checked: p.odmawiajUprawnien, click: przelacz('odmawiajUprawnien') },
    { label: 'Nowe okna zawsze prywatne', type: 'checkbox', checked: p.niePamietaj, click: przelacz('niePamietaj') },
    { type: 'separator' },
    { label: p.proxy ? 'Posrednik sieciowy: ' + p.proxy : 'Posrednik sieciowy: brak (ustaw w Ustawieniach)', enabled: false },
    { label: 'Wyczysc dane przegladania...', click: () => pytajOCzyszczenie(w) },
  ]);
}

async function pytajOCzyszczenie(w) {
  const odpowiedz = await dialog.showMessageBox(w.okno, {
    type: 'question',
    buttons: ['Wyczysc', 'Anuluj'],
    defaultId: 1,
    cancelId: 1,
    message: 'Usunac dane przegladania?',
    detail: 'Znikna ciasteczka, magazyny stron i pamiec podreczna - wszedzie bedzie trzeba zalogowac sie ponownie. '
          + 'Uklady pracy i lista stron zostaja nietkniete.',
  });
  if (odpowiedz.response !== 0) return;
  await wyczyscDane();
  for (const o of okna.values()) for (const k of o.karty) {
    if (!k.view.webContents.isDestroyed()) k.view.webContents.reload();
  }
}

// Data zapisu w formie czytelnej w menu.
function kiedy(znacznik) {
  if (!znacznik) return 'bez daty';
  const d = new Date(znacznik);
  const dwa = (n) => String(n).padStart(2, '0');
  return dwa(d.getDate()) + '.' + dwa(d.getMonth() + 1) + ' ' + dwa(d.getHours()) + ':' + dwa(d.getMinutes());
}

function menuMotywow(w) {
  const teraz = motyw();
  const opisy = {
    klasyczny: 'Klasyczny  - ciemny pasek, jak dotad',
    kafelki:   'Kafelki    - jak BIG_DATA: kwadraty, fiolet',
    matrix:    'Matrix     - czarne tlo, zielony tekst',
  };
  return Menu.buildFromTemplate(MOTYWY.map((n) => ({
    label: opisy[n],
    type: 'radio',
    checked: n === teraz,
    click: () => ustawMotyw(n),
  })));
}

function menuStanow(w) {
  const stany = listaStanow();
  const aktywny = czytajSesje().aktywny;

  const pozycje = stany.length
    ? stany.map((s) => ({
        label: s.nazwa + '   [' + s.okien + ' okien, ' + kiedy(s.zapisano) + ']'
               + (s.sciezka === aktywny ? '  \u2713' : ''),
        click: () => wczytajStanZPliku(s.sciezka),
      }))
    : [{ label: '(brak zapisanych stanow)', enabled: false }];

  pozycje.push({ type: 'separator' });

  if (aktywny && fs.existsSync(aktywny)) {
    pozycje.push({
      label: 'Zapisz "' + path.basename(aktywny, '.' + ROZSZERZENIE) + '"   Ctrl+S',
      click: () => zapiszBiezacy(w),
    });
  }
  pozycje.push({ label: 'Zapisz jako plik...   Ctrl+Shift+S', click: () => zapiszJako(w) });
  const ekranowTeraz = ileEkranow();
  pozycje.push({
    label: 'Obrysy budynkow z aMAPy na modelu',
    type: 'checkbox',
    checked: obrysyWlaczone(),
    click: () => { zapiszSesje({ obrysy3d: !obrysyWlaczone() }); odswiezPaski(); },
  });
  pozycje.push({
    label: 'Widok 2D prowadzi model 3D',
    type: 'checkbox',
    checked: synchronizacjaWlaczona(),
    click: () => { zapiszSesje({ sync2d3d: !synchronizacjaWlaczona() }); odswiezPaski(); },
  });
  pozycje.push({
    label: 'Ile ekranow zajmowac',
    submenu: [
      {
        label: 'Automatycznie (' + ekranyOdLewej().length + ' podlaczonych)',
        type: 'radio',
        checked: !czytajSesje().ekranow,
        click: () => { zapiszSesje({ ekranow: null }); odswiezPaski(); },
      },
      { type: 'separator' },
      ...[1, 2, 3, 4].map((n) => ({
        label: n === 1 ? 'Jeden ekran - wszystko w kartach' : n + ' ekrany',
        type: 'radio',
        checked: czytajSesje().ekranow === n,
        click: () => { zapiszSesje({ ekranow: n }); odswiezPaski(); },
      })),
      { type: 'separator' },
      { label: 'Zmiana dziala przy nastepnym otwarciu ukladu', enabled: false },
    ],
  });
  pozycje.push({
    label: 'Okna ukladu zawsze razem na wierzchu',
    type: 'checkbox',
    checked: razemNaWierzch(),
    click: () => { zapiszSesje({ razemNaWierzch: !razemNaWierzch() }); odswiezPaski(); },
  });
  pozycje.push({
    label: 'Aktualizuj otwarty uklad na biezaco',
    type: 'checkbox',
    checked: autoZapisUkladu(),
    click: () => { zapiszSesje({ autoZapisUkladu: !autoZapisUkladu() }); odswiezPaski(); },
  });
  pozycje.push({ label: 'Otworz plik stanu...   Ctrl+O', click: () => otworzZPliku(w) });
  pozycje.push({ type: 'separator' });
  pozycje.push({ label: 'Pokaz katalog stanow', click: () => shell.openPath(katalogStanow) });

  if (stany.length) {
    pozycje.push({
      label: 'Usun stan',
      submenu: stany.map((s) => ({ label: s.nazwa, click: () => usunStan(w, s) })),
    });
  }
  return Menu.buildFromTemplate(pozycje);
}

// ===================================================================== skroty

function podepnijSkroty(wc, idOkna) {
  wc.on('before-input-event', (zdarzenie, wejscie) => {
    if (wejscie.type !== 'keyDown') return;
    const k = wejscie.key;
    const ctrl = wejscie.control;
    const shift = wejscie.shift;
    const alt = wejscie.alt;

    // F1..F12 - fokus na okno strony majacej taki skrot w ustawieniach
    if (/^F\d{1,2}$/.test(k) && !ctrl && !shift && !alt) {
      const cel = [...okna.values()].find((o) => (o.aplikacja.skrot || '').toUpperCase() === k.toUpperCase());
      if (cel) { cel.okno.focus(); zdarzenie.preventDefault(); return; }
    }

    const w = okna.get(idOkna);
    if (!w) return;

    // Alt+1..9 - przerzuc biezace okno na ten monitor
    if (alt && /^[1-9]$/.test(k)) {
      const ekran = screen.getAllDisplays()[Number(k) - 1];
      if (ekran) { przeniesNaEkran(w, ekran.id); zapiszSesjePozniej(500); zdarzenie.preventDefault(); }
      return;
    }

    // Ctrl+1..9 - skok do karty o tym numerze (9 = ostatnia, jak w przegladarkach)
    if (ctrl && !shift && /^[1-9]$/.test(k)) {
      const n = Number(k);
      const cel = n === 9 ? w.karty[w.karty.length - 1] : w.karty[n - 1];
      if (cel) { aktywujKarte(w, cel.id); zdarzenie.preventDefault(); }
      return;
    }

    const wcAktywny = () => kartaAktywna(w).view.webContents;

    // Ctrl+Shift+1..9 - uruchom integracje o tym numerze z listy. Ctrl+1..9 (bez Shift)
    // zostaje przy kartach, jak w kazdej przegladarce.
    // Z Shiftem klawisz cyfry oddaje znak z gornego rejestru ("!" zamiast "1") i jest to
    // zalezne od ukladu klawiatury - dlatego patrzymy na `code`, ktory od ukladu nie zalezy.
    if (ctrl && shift && /^Digit[1-9]$/.test(wejscie.code || '')) {
      if (integracjaZeSkrotu(Number((wejscie.code || '').slice(-1)))) zdarzenie.preventDefault();
      return;
    }

    if (ctrl && shift && k.toLowerCase() === 'n') {
      otworzOkno({ aplikacja: w.aplikacja.nazwa, url: w.aplikacja.url, displayId: screen.getDisplayMatching(w.okno.getBounds()).id, bounds: null, maximized: true, prywatne: true });
      zdarzenie.preventDefault();
    }
    else if (ctrl && k.toLowerCase() === 't') { utworzKarte(w, { url: motyw() === 'klasyczny' ? w.aplikacja.url : START }, true); zapiszSesjePozniej(800); zdarzenie.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 'w') { zamknijKarte(w, w.aktywna); zdarzenie.preventDefault(); }
    else if (ctrl && k === 'Tab') { przelaczKarte(w, shift ? -1 : 1); zdarzenie.preventDefault(); }
    else if (ctrl && k === 'PageDown') { przelaczKarte(w, 1); zdarzenie.preventDefault(); }
    else if (ctrl && k === 'PageUp') { przelaczKarte(w, -1); zdarzenie.preventDefault(); }
    else if (ctrl && shift && k.toLowerCase() === 's') { zapiszJako(w); zdarzenie.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 's') { zapiszBiezacy(w); zdarzenie.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 'o') { otworzZPliku(w); zdarzenie.preventDefault(); }
    else if (ctrl && k === 'Home') { wczytajStart(w); zdarzenie.preventDefault(); }
    else if (ctrl && shift && k.toLowerCase() === 'o') { if (!WARIANT.ukryjAdres) { const a = kartaAktywna(w).view.webContents.getURL(); if (/^https?:/i.test(a)) shell.openExternal(a); } zdarzenie.preventDefault(); }
    else if (ctrl && k === ',') { if (!WARIANT.ukryjAdres) pokazUstawienia(w); zdarzenie.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 'n') { menuNowegoOkna(w).popup({ window: w.okno }); zdarzenie.preventDefault(); }
    else if (ctrl && k.toLowerCase() === 'r') { wcAktywny().reloadIgnoringCache(); zdarzenie.preventDefault(); }
    else if (k === 'F5') { shift ? wcAktywny().reloadIgnoringCache() : wcAktywny().reload(); zdarzenie.preventDefault(); }
    else if (k === 'F12') { if (!WARIANT.ukryjAdres) wcAktywny().toggleDevTools(); zdarzenie.preventDefault(); }
    else if (ctrl && (k === '+' || k === '=')) { zmienZoom(w, +0.1); zdarzenie.preventDefault(); }
    else if (ctrl && k === '-') { zmienZoom(w, -0.1); zdarzenie.preventDefault(); }
    else if (ctrl && k === '0') { kartaAktywna(w).view.webContents.setZoomFactor(1); zdarzenie.preventDefault(); }
  });
}

function zmienZoom(w, delta) {
  const wc = kartaAktywna(w).view.webContents;
  wc.setZoomFactor(Math.min(3, Math.max(0.3, wc.getZoomFactor() + delta)));
}

// Kafelek aplikacji: karta przejmuje wskazana aplikacje razem z jej adresem startowym.
function otworzZKafelka(w, nazwaAplikacji) {
  const a = aplikacje.find((x) => x.nazwa === nazwaAplikacji);
  if (!a) return;
  w.aplikacja = a;
  w.okno.setTitle(a.nazwa + ' - ' + NAZWA);
  const k = kartaAktywna(w);
  k.ostatniDobryUrl = a.url;
  nawigujKarte(w, k, a.url);
  ulozWidoki(w);
  odswiezPasek(w);
  zapiszSesjePozniej(800);
}

// Powrot na strone startowa w biezacej karcie - karta musi dostac most 'geo',
// wiec zamiast przeladowania podmieniamy ja na nowa.
function wczytajStart(w) {
  const stara = kartaAktywna(w);
  utworzKarte(w, { url: START }, true);
  if (w.karty.length > 1) zamknijKarte(w, stara.id);
}

// ======================================================================== IPC

function oknoZdarzenia(zdarzenie) {
  for (const w of okna.values()) {
    if (w.pasek.webContents.id === zdarzenie.sender.id) return w;
    if (w.karty.some((k) => !k.view.webContents.isDestroyed() && k.view.webContents.id === zdarzenie.sender.id)) return w;
  }
  return null;
}

// Strona startowa prosi o zestaw kafelkow: aplikacje z .ini, zapisane stany i motyw.
ipcMain.on('start-daj-kafelki', (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const w = oknoZdarzenia(zdarzenie);
  log('strona startowa prosi o kafelki | aplikacji:', aplikacje.length, '| stanow:', listaStanow().length, '| motyw:', motyw());
  zdarzenie.sender.send('start-kafelki', {
    motyw: motyw(),
    aplikacje: aplikacje.map((a) => ({ nazwa: a.nazwa, url: a.url, skrot: a.skrot || '' })),
    stany: listaStanow().map((s) => ({ nazwa: s.nazwa, sciezka: s.sciezka, okien: s.okien })),
    biezaca: w ? w.aplikacja.nazwa : '',
  });
});

ipcMain.on('start-otworz-stan', (zdarzenie, sciezka) => {
  if (!odNaszejStrony(zdarzenie)) return;
  wczytajStanZPliku(sciezka);
});
ipcMain.on('start-ustawienia', (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  pokazUstawienia(oknoZdarzenia(zdarzenie));
});

ipcMain.on('akcja', (zdarzenie, akcja, wartosc) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const w = oknoZdarzenia(zdarzenie);
  if (!w) return;
  const k = kartaAktywna(w);
  const wc = k ? k.view.webContents : null;

  // Edycja z ukrytym adresem: nie wpuszczamy akcji, ktore adres pokazuja albo
  // pozwalaja go wpisac - pole adresu, otwarcie w przegladarce systemowej, konsola
  // i lista stron w ustawieniach. Nawigacja po samej aplikacji dziala normalnie.
  if (WARIANT.ukryjAdres && ['idz', 'zewnetrznie', 'narzedzia', 'ustawienia'].includes(akcja)) return;

  switch (akcja) {
    case 'wstecz':      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'naprzod':     if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'odswiez':     wc.reload(); break;
    case 'twardo':      wc.reloadIgnoringCache(); break;
    case 'dom':         nawigujKarte(w, k, w.aplikacja.url); break;
    case 'idz':         nawigujKarte(w, k, normalizujAdres(wartosc)); break;
    case 'idz-kafel':   otworzZKafelka(w, wartosc); break;
    case 'narzedzia':   wc.toggleDevTools(); break;
    case 'karta-nowa':  utworzKarte(w, { url: motyw() === 'klasyczny' ? w.aplikacja.url : START }, true); zapiszSesjePozniej(800); break;
    case 'start':       wczytajStart(w); break;
    case 'menu-motyw':  menuMotywow(w).popup({ window: w.okno }); break;
    case 'ustawienia':  pokazUstawienia(w); break;
    case 'menu-prywatnosc': menuPrywatnosci(w).popup({ window: w.okno }); break;
    case 'karta-wybierz': aktywujKarte(w, Number(wartosc)); zapiszSesjePozniej(800); break;
    case 'karta-zamknij': zamknijKarte(w, Number(wartosc)); break;
    case 'menu-aplikacje': menuAplikacji(w).popup({ window: w.okno }); break;
    case 'menu-ekrany':    menuEkranow(w).popup({ window: w.okno }); break;
    case 'menu-stany':     menuStanow(w).popup({ window: w.okno }); break;
    case 'menu-nowe':      menuNowegoOkna(w).popup({ window: w.okno }); break;
    case 'zewnetrznie': {
      // Uslugi, ktore nie wpuszczaja przegladarek osadzonych (logowanie Google),
      // otwieramy tam, gdzie uzytkownik ma swoja zwykla sesje.
      const adres = wc.getURL();
      if (adres && /^https?:/i.test(adres)) { shell.openExternal(adres); log('otwarte na zewnatrz:', adres.slice(0, 80)); }
      break;
    }
    case 'zamknij':     w.okno.close(); break;
  }
});

// Wpis bez protokolu: adres w sieci lokalnej albo haslo do wyszukiwarki.
function normalizujAdres(tekst) {
  const t = (tekst || '').trim();
  if (!t) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/\s/.test(t) || !/[.:]/.test(t)) return 'https://www.google.com/search?q=' + encodeURIComponent(t);
  return 'http://' + t; // aplikacje chodza po HTTP w sieci lokalnej i przez VPN
}

// ====================================================================== start

// Uklad startowy, gdy nie ma ani sesji, ani stanu. Wersje przygotowane pod konkretne
// stanowisko (np. Czarnocin) niosa gotowy uklad w wariancie - wtedy pierwsze uruchomienie
// od razu rozstawia okna tak, jak trzeba.
function ukladZIni() {
  if (Array.isArray(WARIANT.uklad) && WARIANT.uklad.length) return WARIANT.uklad;
  return ukladZeStron();
}

function ukladZeStron() {
  return aplikacje.map((a) => ({
    aplikacja: a.nazwa,
    url: a.url,
    displayId: ekranNumer(a.monitor).id,
    bounds: null,
    maximized: true,
  }));
}

// Stan podany w wierszu polecen: START.bat "Kijany BDOT500" albo pelna sciezka do pliku.
function stanZWierszaPolecen() {
  const argumenty = process.argv.slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && a !== '.' && a !== KATALOG);
  if (!argumenty.length) return null;

  // Nazwa stanu bywa ze spacja ("Trzy monitory"); zaleznie od tego, co uruchamia program,
  // dociera jako jeden argument albo rozbita na kilka - sprawdzamy obie postacie.
  const sklejone = argumenty.join(' ');
  const podany = argumenty[argumenty.length - 1];
  const kandydaci = [
    sklejone, sciezkaStanu(sklejone), path.join(katalogStanow, sklejone),
    podany, sciezkaStanu(podany), path.join(katalogStanow, podany),
  ];
  return kandydaci.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// Bez tego przedstawialibysmy sie jako "Electron", a czesc uslug (m.in. logowanie Google)
// odmawia wtedy dzialania. Podajemy sie tym, czym naprawde jestesmy w srodku: Chrome
// w tej samej wersji, ktora niesie Electron. Tak samo robi Brave czy Vivaldi.
const WERSJA_CHROME = process.versions.chrome.split('.')[0];

// Model 3D to ciezka grafika - warto puscic ja przez karte graficzna zamiast procesora.
// Rasteryzacja GPU i pominiecie listy zablokowanych sterownikow daja najwiecej przy Cesium.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.userAgentFallback =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/' + WERSJA_CHROME + '.0.0.0 Safari/537.36';


app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // pasek z pasek.html zastepuje menu systemowe
  log('user-agent:', app.userAgentFallback);

  sesja = session.fromPartition(PARTYCJA_BAZA + (PROFIL ? '-' + PROFIL : ''));
  pilnujZapisowModelu(sesja);
  sesjaUlotna = session.fromPartition(PARTYCJA_ULOTNA);
  zastosujPrywatnosc();

  fs.mkdirSync(DANE, { recursive: true });
  aplikacje = czytajStrony();

  // Zapisane uklady pracy leza przy danych uzytkownika; mozna wskazac inny katalog
  // (np. wspolny dysk zespolu) - wtedy zapamietuje go sesja.
  const wskazany = rozwinSciezke(czytajSesje().katalogStanow || path.join(DANE, 'uklady'));
  katalogStanow = path.isAbsolute(wskazany) ? wskazany : path.join(DANE, wskazany);
  fs.mkdirSync(katalogStanow, { recursive: true });

  // Edycja przygotowana pod konkretna robote (np. Czarnocin) przynosi gotowe uklady -
  // po jednym na obreb. Wysiewamy je raz: plik, ktory juz tam lezy, zostaje nietkniety,
  // zeby nie kasowac tego, co uzytkownik sobie poprawil.
  wysiejUklady();

  // Edycja dla klienta zewnetrznego zaczyna sie od logowania. Tym samym kontem
  // i haslem, co AMZ - zeby nie bylo drugiego miejsca, w ktorym trzeba zmieniac haslo.
  // Najpierw tunel, potem haslo - bez VPN nie ma z czym sie logowac.
  const stanVpn = await podniesVpn();
  if (WARIANT.logowanie && !(await zalogujPrzedStartem(stanVpn))) { app.quit(); return; }

  const zWiersza = stanZWierszaPolecen();
  const zapisanaSesja = czytajSesje();
  const stanZPliku = zWiersza ? czytajStanZPliku(zWiersza) : null;

  if (stanZPliku) zapiszSesje({ aktywny: zWiersza });
  const uklad = (stanZPliku && stanZPliku.okna)
    || (zapisanaSesja.okna.length ? zapisanaSesja.okna : null)
    || ukladZIni();

  log('START | profil:', PROFIL || '(domyslny)', '| zrodlo ukladu:', stanZPliku ? ('plik ' + zWiersza) : (zapisanaSesja.okna.length ? 'sesja.json' : 'ustawienia domyslne'), '| okien:', uklad.length);
  for (const wpis of dopasujDoEkranow(uklad)) otworzOkno(wpis);

  // Nebu --ustawienia otwiera od razu okno ustawien (przydatne przy skrocie na pulpicie).
  if (process.argv.includes('--ustawienia')) pokazUstawienia([...okna.values()][0]);
  // Nebu --integracje tak samo dla okna integracji - skrot dla kogos, kto uklada przepisy,
  // i wygodne przy robieniu zrzutow do instrukcji.
  if (process.argv.includes('--integracje')) pokazIntegracje([...okna.values()][0]);

  // Cykliczny zapis ukladu - miejsce w aplikacji (mapa, kamera, przewiniecie) zmienia sie
  // bez zdarzen okna, a po zamknieciu programu nie da sie go juz odczytac.
  setInterval(zapiszSesjeAuto, 15000);

  // Odlaczenie monitora albo zmiana rozdzielczosci - okna wracaja na swoje miejsca.
  for (const zdarzenie of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(zdarzenie, () => {
      zapomnijEkrany();
      setTimeout(przywrocNaEkrany, 400);
    });
  }
});

// Zmienne srodowiskowe w sciezce (%USERNAME%, $USER) - przyda sie przy kontach uzytkownikow.
function rozwinSciezke(sciezka) {
  return String(sciezka)
    .replace(/%([^%]+)%/g, (_, n) => process.env[n] || '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => process.env[n] || '');
}

function przywrocNaEkrany() {
  const uklad = czytajSesje().okna;
  log('zmiana ukladu monitorow | ekranow teraz:', ekranyOdLewej().length);
  for (const w of okna.values()) {
    // Szukamy po trwalym identyfikatorze okna, nie po nazwie aplikacji: w edycji bez
    // wgranych stron wszystkie okna nazywaja sie tak samo ("WWW") i wtedy kazde
    // dostawalo geometrie pierwszego wpisu - czyli wszystkie ladowaly na jednym ekranie.
    const wpis = uklad.find((o) => o.idUkladu && o.idUkladu === w.idUkladu)
      || uklad.find((o) => o.aplikacja === w.aplikacja.nazwa && o.rola === w.rolaEkranu)
      || uklad.find((o) => o.aplikacja === w.aplikacja.nazwa);
    if (!wpis) continue;
    const geom = ustalGeometrie(wpis);
    if (w.okno.isMaximized()) w.okno.unmaximize();
    w.okno.setBounds(geom.bounds);
    if (geom.maximized) w.okno.maximize();
  }
  odswiezPaski();
}

app.on('before-quit', () => {
  konczymyPrace = true;
  const uklad = migawkaSync();
  if (uklad.length) {
    log('koniec programu | zapisuje uklad:', uklad.length, 'okien');
    zapiszSesje({ okna: uklad });
    odswiezAktywnyUklad(uklad);
  }
});

app.on('window-all-closed', () => {
  if (przelaczamyStan) { log('brak okien, ale trwa przelaczanie stanu - nie koncze'); return; }
  log('wszystkie okna zamkniete - koniec programu');
  app.quit();
});

// Uklady dolaczone do edycji - kopiowane do katalogu uzytkownika przy starcie.
function wysiejUklady() {
  if (!WARIANT.ukladyStartowe) return;

  const zrodlo = path.join(KATALOG, 'listy', WARIANT.ukladyStartowe);
  let pliki;
  try {
    pliki = fs.readdirSync(zrodlo).filter((n) => n.toLowerCase().endsWith('.nebu'));
  } catch {
    return; // edycja bez ukladow albo katalog nie wszedl do paczki
  }

  let nowych = 0;
  for (const nazwa of pliki) {
    const cel = path.join(katalogStanow, nazwa);
    if (fs.existsSync(cel)) continue;
    try {
      fs.copyFileSync(path.join(zrodlo, nazwa), cel);
      nowych++;
    } catch (e) {
      log('nie moge wysiac ukladu', nazwa, '-', e.message);
    }
  }
  if (nowych) log('uklady dolaczone do edycji:', nowych, 'z', pliki.length);
}

// ======================================================= logowanie do programu

// Edycja dla klienta zewnetrznego pyta o konto, zanim cokolwiek otworzy. Hasla nie
// trzymamy u siebie: pytamy AMZ, czyli to samo konto i to samo haslo, ktorym Marzena
// loguje sie do operatow. Dzieki temu zmiana hasla jest w jednym miejscu, a blokade
// konta zdejmuje sie tam, gdzie zawsze - w panelu administracyjnym AMZ.

// Adres AMZ bierzemy z wariantu (pole logowanie) albo z pierwszej strony o roli AMZ.
function adresLogowania() {
  const wprost = typeof WARIANT.logowanie === 'string' ? WARIANT.logowanie : '';
  const url = wprost || (WARIANT.strony || []).map((s) => s.url).find((u) => /:5555\//.test(u || '')) || '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// Zwraca { ok } albo { ok: false, komunikat, zablokowany, zostalo }.
async function sprawdzKonto(uzytkownik, haslo) {
  const adres = adresLogowania();
  if (!adres) return { ok: false, komunikat: 'Brak adresu serwera logowania w konfiguracji.' };

  try {
    // Zapytanie idzie ta sama sesja, w ktorej pracuja okna - ciasteczko z odpowiedzi
    // zostaje w niej zapisane, wiec okno AMZ otwiera sie juz zalogowane.
    const odpowiedz = await net.fetch(adres + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ user: uzytkownik, haslo }).toString(),
      session: sesja,
      useSessionCookies: true,
    });

    const dane = await odpowiedz.json();
    if (dane.ok) {
      // Jedno logowanie ma wystarczyc: ciasteczko sesji AMZ przepisujemy do sesji okien,
      // zeby strona operatow otworzyla sie juz zalogowana i nie pytala drugi raz.
      await przepiszCiasteczka(adres, odpowiedz);
      return { ok: true, nazwa: dane.nazwa || uzytkownik };
    }

    return {
      ok: false,
      komunikat: dane.zablokowany
        ? 'Konto zablokowane po trzech bledach. Zdejmuje je wylacznie administrator.'
        : (dane.detail || 'Zly uzytkownik lub haslo.'),
      zablokowany: !!dane.zablokowany,
      zostalo: Number.isFinite(dane.zostalo) ? dane.zostalo : 0,
    };
  } catch (e) {
    log('logowanie: serwer nie odpowiada -', e.message);
    return { ok: false, komunikat: 'Serwer nie odpowiada. Sprawdz polaczenie VPN.' };
  }
}

// Okno logowania. Zwraca true, gdy uzytkownik wszedl; false, gdy zamknal okno.
function zalogujPrzedStartem(stanVpn) {
  return new Promise((zakoncz) => {
    const okno = new BrowserWindow({
      width: 420,
      height: 460,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      title: 'Logowanie - ' + NAZWA,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(KATALOG, 'preload.js'), contextIsolation: true, sandbox: true },
    });

    let wpuszczony = false;

    const sprawdzaj = async (zdarzenie, uzytkownik, haslo) => {
      if (!odNaszejStrony(zdarzenie)) return;
      const wynik = await sprawdzKonto(uzytkownik, haslo);
      if (okno.isDestroyed()) return;

      log('logowanie:', uzytkownik, wynik.ok ? '- wpuszczam' : '- odmowa (' + wynik.komunikat + ')');
      okno.webContents.send('logowanie-wynik', wynik);

      if (wynik.ok) {
        wpuszczony = true;
        zalogowany = { login: uzytkownik, nazwa: wynik.nazwa };
        setTimeout(() => { if (!okno.isDestroyed()) okno.close(); }, 250);
      }
    };

    ipcMain.on('zaloguj', sprawdzaj);

    okno.webContents.on('did-finish-load', () => {
      okno.webContents.send('logowanie-nazwa', NAZWA);
      if (stanVpn && !stanVpn.ok) okno.webContents.send('logowanie-wynik', { ok: false, komunikat: stanVpn.komunikat });
    });
    okno.on('closed', () => {
      ipcMain.removeListener('zaloguj', sprawdzaj);
      zakoncz(wpuszczony);
    });

    okno.loadFile(path.join(KATALOG, 'logowanie.html'));
  });
}

// ============================================================ VPN przy starcie

// Bez tunelu stanowisko nie widzi ani map, ani operatow - wiec program sam go podnosi,
// zanim zapyta o haslo. Tunel jest zwyklym tunelem WireGuarda zainstalowanym jako usluga
// Windows (robi to raz narzedzia\vpn-zainstaluj.ps1); tutaj tylko go wlaczamy i czekamy,
// az serwer odpowie. Gdy VPN juz dziala, nie robimy nic.

const { execFile } = require('child_process');

function polecenie(program, argumenty, limitMs = 15000) {
  return new Promise((gotowe) => {
    execFile(program, argumenty, { timeout: limitMs, windowsHide: true }, (blad, wyjscie, blad2) => {
      gotowe({ ok: !blad, tekst: String(wyjscie || '') + String(blad2 || '') });
    });
  });
}

// Czy serwer odpowiada - po tym poznajemy, ze tunel stoi.
async function serwerOdpowiada(adres, limitMs = 4000) {
  try {
    const kontroler = new AbortController();
    const czasomierz = setTimeout(() => kontroler.abort(), limitMs);
    const odpowiedz = await net.fetch(adres, { session: sesja, signal: kontroler.signal });
    clearTimeout(czasomierz);
    return odpowiedz.ok;
  } catch {
    return false;
  }
}

// Zwraca { ok, komunikat }. Nie przerywa startu - gdy sie nie uda, uzytkownik zobaczy
// to w oknie logowania i bedzie wiedzial, czego szukac.
async function podniesVpn() {
  const vpn = WARIANT.vpn;
  if (!vpn || !vpn.sprawdz) return { ok: true, komunikat: '' };

  if (await serwerOdpowiada(vpn.sprawdz)) {
    log('VPN: polaczenie juz dziala');
    return { ok: true, komunikat: '' };
  }

  log('VPN: brak polaczenia, podnosze tunel', vpn.tunel || '(bez nazwy)');

  // Trzy drogi, od najmniej klopotliwej: usluga tunelu, zadanie przygotowane przy
  // wdrozeniu (dziala bez pytania o uprawnienia), na koncu samo narzedzie WireGuarda.
  const proby = [];
  if (vpn.tunel) proby.push(['net', ['start', 'WireGuardTunnel$' + vpn.tunel]]);
  if (vpn.zadanie) proby.push(['schtasks', ['/run', '/tn', vpn.zadanie]]);
  if (vpn.konfiguracja && vpn.wireguard) proby.push([vpn.wireguard, ['/installtunnelservice', vpn.konfiguracja]]);

  for (const [program, argumenty] of proby) {
    const wynik = await polecenie(program, argumenty);
    log('VPN:', program, argumenty.join(' '), '->', wynik.ok ? 'ok' : wynik.tekst.trim().slice(0, 120));
    if (!wynik.ok) continue;

    // Tunel wstaje przez chwile - dajemy mu okolo 20 sekund.
    for (let proba = 0; proba < 10; proba++) {
      if (await serwerOdpowiada(vpn.sprawdz, 2000)) {
        log('VPN: polaczenie zestawione');
        return { ok: true, komunikat: '' };
      }
    }
  }

  return {
    ok: false,
    komunikat: 'Brak polaczenia VPN. Sprobuj jeszcze raz albo zglos sie do administratora.',
  };
}

// Przepisuje ciasteczka z odpowiedzi serwera do sesji, w ktorej pracuja okna.
// net.fetch nie zawsze zapisuje je sam, a bez tego okno AMZ pytaloby o haslo drugi raz.
async function przepiszCiasteczka(adres, odpowiedz) {
  const naglowki = typeof odpowiedz.headers.getSetCookie === 'function'
    ? odpowiedz.headers.getSetCookie()
    : [odpowiedz.headers.get('set-cookie')].filter(Boolean);

  let zapisanych = 0;

  for (const wpis of naglowki) {
    const czesci = String(wpis).split(';').map((c) => c.trim()).filter(Boolean);
    if (!czesci.length) continue;

    const rownosc = czesci[0].indexOf('=');
    if (rownosc < 1) continue;

    const ciasteczko = {
      url: adres,
      name: czesci[0].slice(0, rownosc),
      value: czesci[0].slice(rownosc + 1),
      path: '/',
    };

    for (const atrybut of czesci.slice(1)) {
      const [nazwa, wartosc = ''] = atrybut.split('=');
      const n = nazwa.trim().toLowerCase();
      if (n === 'path') ciasteczko.path = wartosc.trim() || '/';
      else if (n === 'httponly') ciasteczko.httpOnly = true;
      else if (n === 'secure') ciasteczko.secure = true;
      else if (n === 'samesite') ciasteczko.sameSite = wartosc.trim().toLowerCase();
      else if (n === 'max-age') {
        const sekundy = Number(wartosc);
        if (Number.isFinite(sekundy)) ciasteczko.expirationDate = Math.floor(Date.now() / 1000) + sekundy;
      }
    }

    try {
      await sesja.cookies.set(ciasteczko);
      zapisanych++;
    } catch (e) {
      log('logowanie: nie moge zapisac ciasteczka', ciasteczko.name, '-', e.message);
    }
  }

  log('logowanie: ciasteczek przepisanych do sesji okien:', zapisanych);
}

// Wstrzykuje do okna strony jeden z mostow (most-2d.js / most-3d.js). Raz na zaladowanie:
// same skrypty pilnuja, zeby nie zainstalowac sie drugi raz.
async function wstrzyknijMost(k, nazwa) {
  if (k.view.webContents.isDestroyed()) return;
  try {
    const kod = fs.readFileSync(path.join(KATALOG, 'narzedzia', nazwa), 'utf8');
    const wynik = await k.view.webContents.executeJavaScript(kod, true);
    log('most', nazwa, '->', wynik);
  } catch (e) {
    log('most', nazwa, 'nie wszedl:', e.message);
  }
}

// ============================================ zapis w modelu 3D -> odswiezenie mapy 2D
//
// aMAPA pobiera dane z bazy raz na zakres i trzyma je w pamieci. Gdy w modelu dopiszemy
// pikiete albo przesuniemy istniejaca, baza juz o tym wie, a mapa wciaz pokazuje stara
// kopie - i wyglada to, jakby zapis przepadl. Zamiast zmieniac obie aplikacje, Nebu
// podsluchuje ich ruch sieciowy: zapis idzie POST-em na adres modelu, wiec wystarczy
// zauwazyc odpowiedz i poprosic mape o ponowne pobranie.

const SCIEZKI_ZAPISU = /\/(pikiety-(update|delete|rename|set-z)|save-points|append_point|ewmapa\/)/i;
let odswiezanieMapy = null;

function pilnujZapisowModelu(ses) {
  if (!WARIANT.geo) return; // publiczna edycja nie podslucha ruchu sieciowego stron
  if (!ses || ses.__nebuPilnujeZapisow) return;
  ses.__nebuPilnujeZapisow = true;

  ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, (szczegoly) => {
    if (szczegoly.method !== 'POST') return;
    if (szczegoly.statusCode < 200 || szczegoly.statusCode >= 300) return;
    if (!SCIEZKI_ZAPISU.test(szczegoly.url)) return;

    // Zapisow bywa seria (kilka pikiet pod rzad) - odswiezamy raz, po ostatnim.
    clearTimeout(odswiezanieMapy);
    odswiezanieMapy = setTimeout(() => odswiezMape(szczegoly.url), 900);
  });
}

async function odswiezMape(poCzym) {
  const mapy = [...okna.values()].filter((w) => rolaOkna(w) === 'mapa2d');
  if (!mapy.length) return;

  let kod;
  try {
    kod = fs.readFileSync(path.join(KATALOG, 'narzedzia', 'odswiez-2d.js'), 'utf8');
  } catch (e) {
    log('odswiezanie 2D: brak skryptu -', e.message);
    return;
  }

  for (const w of mapy) {
    const k = kartaAktywna(w);
    if (!k || k.view.webContents.isDestroyed()) continue;
    try {
      const wynik = await k.view.webContents.executeJavaScript(kod, true);
      log('zapis w 3D (' + String(poCzym).replace(/^https?:\/\/[^/]+/, '') + ') -> mapa 2D:', wynik);
    } catch (e) {
      log('odswiezanie 2D nie przeszlo:', e.message);
    }
  }
}

// ============================================================ integracje pisane slowami
//
// Uzytkownik opisuje zdaniem, co ma sie stac miedzy oknami ("wez wspolrzedne z aplikacji
// na srodkowym monitorze i wpisz je w aplikacje na prawym, kamera 50 m"), a model zamienia
// to zdanie na PRZEPIS - kilka pol o ustalonym znaczeniu. Przepis nie jest kodem: Nebu
// czyta z niego, co wziac z adresu zrodla i jaki adres otworzyc w celu. Dlaczego nie
// uruchamiamy kodu od modelu - patrz komentarz w narzedzia/integracje.js.
//
// Klucz do modelu podaje uzytkownik PO instalacji i lezy zaszyfrowany w jego profilu
// (safeStorage - szyfrowanie powiazane z kontem Windows). W paczce do pobrania nie ma
// zadnego klucza i byc nie moze: .asar to zwykle archiwum.

const SILNIK = require('./narzedzia/integracje.js');
const { safeStorage } = require('electron');
const PLIK_INTEGRACJI = path.join(DANE, 'integracje.json');
const PLIK_KLUCZA = path.join(DANE, 'klucz-ai.bin');
const MODEL_AI = 'claude-sonnet-5-5';

let oknoIntegracji = null;
const ostatnieStrzaly = new Map(); // nazwa przepisu -> { adres, czas }
const ODSTEP_INTEGRACJI_MS = 900;

// Nasze wlasne otwarcia, zeby nie wziac ich za ruch uzytkownika. Bez tego dwa przepisy
// w przeciwnych kierunkach (z monitora 2 na 3 i z 3 na 2) odpalalyby sie nawzajem bez konca:
// kazde otwarcie zmienia adres, a zmiana adresu jest wlasnie wyzwalaczem.
const naszeOtwarcia = new Map(); // id karty -> czas
const CISZA_PO_INTEGRACJI_MS = 2500;

function toNaszeOtwarcie(idKarty) {
  const czas = naszeOtwarcia.get(idKarty);
  return !!czas && Date.now() - czas < CISZA_PO_INTEGRACJI_MS;
}

function czytajIntegracje() {
  try {
    const dane = JSON.parse(czytajTekst(PLIK_INTEGRACJI));
    return Array.isArray(dane.integracje) ? dane.integracje.map(SILNIK.uporzadkuj) : [];
  } catch {
    return [];
  }
}

function zapiszIntegracje(lista) {
  const czyste = (Array.isArray(lista) ? lista : []).map(SILNIK.uporzadkuj)
    .filter((p) => SILNIK.sprawdzPrzepis(p).ok);
  fs.mkdirSync(DANE, { recursive: true });
  fs.writeFileSync(PLIK_INTEGRACJI, JSON.stringify({ wersja: 1, integracje: czyste }, null, 2), 'utf8');
  log('integracje zapisane:', czyste.length);
  return czyste;
}

// ---------------------------------------------------------------- klucz do modelu

function szyfrowanieDostepne() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function zapiszKluczAi(tekst) {
  const klucz = String(tekst || '').trim();
  if (!klucz) return { ok: false, powod: 'puste pole' };
  // Bez szyfrowania systemowego nie zapisujemy wcale. Plik tekstowy z kluczem na dysku
  // to dokladnie to, czego uzytkownik nie chce - a klucz do modelu kosztuje pieniadze.
  if (!szyfrowanieDostepne()) {
    return { ok: false, powod: 'system nie udostepnia szyfrowania - klucza nie zapisze' };
  }
  fs.mkdirSync(DANE, { recursive: true });
  fs.writeFileSync(PLIK_KLUCZA, safeStorage.encryptString(klucz));
  log('klucz AI zapisany (zaszyfrowany, znakow w oryginale:', klucz.length + ')');
  return { ok: true };
}

function czytajKluczAi() {
  try {
    return safeStorage.decryptString(fs.readFileSync(PLIK_KLUCZA));
  } catch (_) {
    return null;
  }
}

function usunKluczAi() {
  fs.rmSync(PLIK_KLUCZA, { force: true });
  log('klucz AI usuniety');
}

function stanKluczaAi() {
  return { jest: fs.existsSync(PLIK_KLUCZA), szyfrowanie: szyfrowanieDostepne(), model: MODEL_AI };
}

// ---------------------------------------------------------------- okna a numery monitorow

function monitorOkna(w) {
  try {
    const ekran = screen.getDisplayMatching(w.okno.getBounds());
    const i = ekranyOdLewej().findIndex((e) => e.id === ekran.id);
    return i < 0 ? 0 : i + 1;
  } catch (_) {
    return 0;
  }
}

function oknoNaMonitorze(numer) {
  return [...okna.values()].find((w) => monitorOkna(w) === Number(numer)) || null;
}

// Co widzi model: numer monitora, nazwa strony i jej biezacy adres. Tyle wychodzi na zewnatrz
// przy pisaniu integracji - i tylko wtedy, gdy uzytkownik sam kliknie "Napisz przepis".
function opisOkien() {
  return [...okna.values()].map((w) => {
    const k = kartaAktywna(w);
    const adres = k && !k.view.webContents.isDestroyed() ? k.view.webContents.getURL() : '';
    return { monitor: monitorOkna(w), strona: w.aplikacja.nazwa, adres };
  }).sort((a, b) => a.monitor - b.monitor);
}

// ---------------------------------------------------------------- wykonanie

function otworzWCelu(przepis, adres) {
  const cel = oknoNaMonitorze(przepis.celMonitor);
  if (!cel) return { ok: false, powod: 'nie ma okna na monitorze ' + przepis.celMonitor };
  const k = kartaAktywna(cel);
  if (!k || k.view.webContents.isDestroyed()) return { ok: false, powod: 'okno celu bez karty' };
  if (!bezpiecznyDoOtwarcia(adres)) return { ok: false, powod: 'adres celu odrzucony przez sito' };

  k.ostatniDobryUrl = adres;
  naszeOtwarcia.set(k.id, Date.now());
  nawigujKarte(cel, k, adres);
  return { ok: true };
}

// Wywolywane po kazdej zmianie adresu w oknie. Przepisy pilnuja same, czy to ich zrodlo.
function integracjeZeZrodla(w, adresZrodla) {
  const karta = kartaAktywna(w);
  if (karta && toNaszeOtwarcie(karta.id)) return; // to my tu przed chwila weszlismy

  const lista = czytajIntegracje().filter((p) => p.wlaczona && p.kiedy === 'zmiana');
  if (!lista.length) return;

  const monitor = monitorOkna(w);
  for (const przepis of lista) {
    if (przepis.zrodloMonitor !== monitor) continue;

    const wynik = SILNIK.wykonaj(przepis, adresZrodla);
    if (!wynik.ok) {
      log('integracja "' + przepis.nazwa + '" nie strzela:', wynik.powod);
      continue;
    }

    // Seria zmian adresu (przeciaganie mapy) ma dac jedno otwarcie, nie dziesiec.
    const poprzedni = ostatnieStrzaly.get(przepis.nazwa);
    if (poprzedni && poprzedni.adres === wynik.adres) continue;
    if (poprzedni && Date.now() - poprzedni.czas < ODSTEP_INTEGRACJI_MS) continue;
    ostatnieStrzaly.set(przepis.nazwa, { adres: wynik.adres, czas: Date.now() });

    const otwarcie = otworzWCelu(przepis, wynik.adres);
    log('integracja "' + przepis.nazwa + '":',
      otwarcie.ok ? 'monitor ' + przepis.celMonitor + ' -> ' + wynik.adres : 'blad - ' + otwarcie.powod);
  }
}

// Reczne uruchomienie: ze skrotu albo z przycisku w okienku integracji.
function uruchomIntegracjeRecznie(nazwa) {
  const przepis = czytajIntegracje().find((p) => p.nazwa === nazwa);
  if (!przepis) return { ok: false, powod: 'nie znam takiego przepisu' };

  const zrodlo = oknoNaMonitorze(przepis.zrodloMonitor);
  if (!zrodlo) return { ok: false, powod: 'nie ma okna na monitorze ' + przepis.zrodloMonitor };
  const k = kartaAktywna(zrodlo);
  const adres = k && !k.view.webContents.isDestroyed() ? k.view.webContents.getURL() : '';

  const wynik = SILNIK.wykonaj(przepis, adres);
  if (!wynik.ok) return { ok: false, powod: wynik.powod };

  const otwarcie = otworzWCelu(przepis, wynik.adres);
  log('integracja recznie "' + nazwa + '":', otwarcie.ok ? wynik.adres : otwarcie.powod);
  return otwarcie.ok ? { ok: true, adres: wynik.adres } : otwarcie;
}

// Skrot Ctrl+Shift+1..9 uruchamia przepis o tym numerze z listy (te z "kiedy": "skrot").
function integracjaZeSkrotu(numer) {
  const lista = czytajIntegracje().filter((p) => p.wlaczona);
  const przepis = lista[numer - 1];
  if (!przepis) return false;
  uruchomIntegracjeRecznie(przepis.nazwa);
  return true;
}

// ---------------------------------------------------------------- zdanie -> przepis

const INSTRUKCJA_AI = [
  'Zamieniasz zdanie uzytkownika na PRZEPIS integracji miedzy oknami przegladarki Nebu.',
  'Odpowiadasz WYLACZNIE obiektem JSON, bez komentarza i bez znacznikow kodu.',
  '',
  'Pola przepisu:',
  '  nazwa          - krotka nazwa po polsku',
  '  opis           - jedno zdanie, co ten przepis robi',
  '  zrodloMonitor  - liczba 1-9, monitor liczony OD LEWEJ, z ktorego czytamy',
  '  celMonitor     - liczba 1-9, monitor, w ktorym otwieramy adres (musi byc inny)',
  '  wzorzec        - puste albo wyrazenie regularne z nazwanymi grupami, dopasowywane',
  '                   do calego adresu zrodla. Uzywaj tylko wtedy, gdy wartosci NIE da sie',
  '                   wziac z parametrow adresu.',
  '  szablon        - adres do otwarcia, z miejscami w nawiasach klamrowych na wartosci.',
  '                   Musi zaczynac sie od http:// albo https://',
  '  kiedy          - "zmiana" (samo, po zmianie adresu w zrodle) albo "skrot"',
  '',
  'Skad biora sie wartosci: z parametrow adresu zrodla, z fragmentu po krzyzyku w tym samym',
  'zapisie, oraz z fragmentu sciezkowego, ktorego uzywaja mapy - dla #19/50.2584/19.0275',
  'dostajesz f1=19, f2=50.2584, f3=19.0275. Nazwane grupy wzorca dokladaja reszte.',
  '',
  'Nie wymyslaj pol poza wymienionymi. Nie wstawiaj kodu. Liczby stale (np. wysokosc kamery)',
  'wpisuj wprost w szablon. Adresy okien dostajesz nizej - trzymaj sie ich hostow i portow.',
].join('\n');

async function napiszPrzepis(zdanie) {
  const klucz = czytajKluczAi();
  if (!klucz) return { ok: false, powod: 'nie ma klucza AI - dodaj go wyzej' };

  const tresc = [
    'Okna otwarte teraz:',
    JSON.stringify(opisOkien(), null, 2),
    '',
    'Zdanie uzytkownika:',
    String(zdanie || '').slice(0, 1000),
  ].join('\n');

  let odpowiedz;
  try {
    odpowiedz = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': klucz,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_AI,
        max_tokens: 1024,
        system: INSTRUKCJA_AI,
        messages: [{ role: 'user', content: tresc }],
      }),
    });
  } catch (e) {
    return { ok: false, powod: 'nie moge sie dobic do modelu: ' + e.message };
  }

  if (!odpowiedz.ok) {
    const tekst = await odpowiedz.text().catch(() => '');
    log('AI: odpowiedz', odpowiedz.status, tekst.slice(0, 200));
    return {
      ok: false,
      powod: odpowiedz.status === 401
        ? 'model nie przyjal klucza (401)'
        : 'model odpowiedzial bledem ' + odpowiedz.status,
    };
  }

  let surowy = '';
  try {
    const dane = await odpowiedz.json();
    surowy = (dane.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  } catch (e) {
    return { ok: false, powod: 'nie rozumiem odpowiedzi modelu' };
  }

  // Model bywa uprzejmy i dokleja zdanie albo ogrodzenie kodu - bierzemy pierwszy obiekt JSON.
  const m = surowy.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, powod: 'model nie zwrocil JSON-a', surowy: surowy.slice(0, 300) };

  let przepis;
  try { przepis = SILNIK.uporzadkuj(JSON.parse(m[0])); }
  catch (e) { return { ok: false, powod: 'JSON od modelu jest uszkodzony', surowy: surowy.slice(0, 300) }; }

  const sprawdzenie = SILNIK.sprawdzPrzepis(przepis);
  if (!sprawdzenie.ok) {
    return { ok: false, powod: 'przepis od modelu nie przechodzi sprawdzenia: ' + sprawdzenie.bledy.join('; '), przepis };
  }

  log('AI napisal przepis:', przepis.nazwa);
  return { ok: true, przepis, poPolsku: SILNIK.poPolsku(przepis) };
}

// ---------------------------------------------------------------- okno integracji

function pokazIntegracje(w) {
  if (oknoIntegracji && !oknoIntegracji.isDestroyed()) { oknoIntegracji.focus(); return; }

  oknoIntegracji = new BrowserWindow({
    parent: w ? w.okno : undefined,
    width: 860,
    height: 720,
    title: NAZWA + ' - integracje',
    backgroundColor: '#1b1e22',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(KATALOG, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  oknoIntegracji.loadFile(path.join(KATALOG, 'integracje.html'));
  oknoIntegracji.webContents.on('console-message', (zd) => {
    if (zd.level === 'error') log('integracje:', zd.message.slice(0, 200));
  });
  oknoIntegracji.on('closed', () => { oknoIntegracji = null; });
}

ipcMain.on('integracje-daj', (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  zdarzenie.sender.send('integracje-dane', {
    motyw: motyw(),
    integracje: czytajIntegracje(),
    okna: opisOkien(),
    klucz: stanKluczaAi(),
  });
});

ipcMain.on('integracje-zapisz', (zdarzenie, lista) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const czyste = zapiszIntegracje(lista);
  zdarzenie.sender.send('integracje-zapisane', { integracje: czyste });
});

ipcMain.on('integracje-uruchom', (zdarzenie, nazwa) => {
  if (!odNaszejStrony(zdarzenie)) return;
  zdarzenie.sender.send('integracje-wynik', uruchomIntegracjeRecznie(String(nazwa || '')));
});

ipcMain.on('integracje-napisz', async (zdarzenie, zdanie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const wynik = await napiszPrzepis(zdanie);
  if (!zdarzenie.sender.isDestroyed()) zdarzenie.sender.send('integracje-napisane', wynik);
});

ipcMain.on('integracje-sprawdz', (zdarzenie, przepis) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const p = SILNIK.uporzadkuj(przepis);
  const sprawdzenie = SILNIK.sprawdzPrzepis(p);
  zdarzenie.sender.send('integracje-sprawdzone', {
    ok: sprawdzenie.ok,
    bledy: sprawdzenie.bledy,
    poPolsku: sprawdzenie.ok ? SILNIK.poPolsku(p) : '',
  });
});

ipcMain.on('klucz-ai-zapisz', (zdarzenie, klucz) => {
  if (!odNaszejStrony(zdarzenie)) return;
  const wynik = zapiszKluczAi(klucz);
  zdarzenie.sender.send('klucz-ai-stan', { ...stanKluczaAi(), ...wynik });
});

ipcMain.on('klucz-ai-usun', (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  usunKluczAi();
  zdarzenie.sender.send('klucz-ai-stan', { ...stanKluczaAi(), ok: true });
});

ipcMain.on('integracje-otworz', (zdarzenie) => {
  if (!odNaszejStrony(zdarzenie)) return;
  pokazIntegracje(oknoZdarzenia(zdarzenie));
});
