// Budowanie edycji z jednego kodu.
//
//   node narzedzia/buduj.js firma     -> instalator .exe, edycja "Nebu GEO-SYS" z waszymi stronami
//   node narzedzia/buduj.js czarnocin -> instalator .exe, stanowisko Czarnocin (dwa monitory)
//   node narzedzia/buduj.js publiczna -> instalator .exe, edycja pusta pod sklep
//   node narzedzia/buduj.js sklep     -> paczka .appx (wymaga Windows SDK)
//
// Roznica miedzy edycjami sprowadza sie do jednego pliku: wariant.json obok programu.
// Skrypt wklada wlasciwy wariant (wariant.<tryb>.json), buduje i sprzata po sobie,
// zeby katalog zrodlowy zawsze wracal do postaci publicznej.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KATALOG = path.join(__dirname, '..');
const WARIANT = path.join(KATALOG, 'wariant.json');

// Edycje nazwane: wariant bierze sie z pliku, nazwa produktu i appId je rozdzielaja,
// zeby instalatory nie nadpisywaly sie nawzajem.
const EDYCJE = {
  firma:     { plik: 'wariant.firma.json',     produkt: 'Nebu GEO-SYS',   appId: 'pl.geosys.nebu.firma' },
  czarnocin: { plik: 'wariant.czarnocin.json', produkt: 'Nebu Czarnocin', appId: 'pl.geosys.nebu.czarnocin' },
  bejsce:    { plik: 'wariant.bejsce.json',    produkt: 'Nebu Bejsce',    appId: 'pl.geosys.nebu.bejsce' },
};

const tryb = (process.argv[2] || '').toLowerCase();
const TRYBY = [...Object.keys(EDYCJE), 'publiczna', 'sklep'];

if (!TRYBY.includes(tryb)) {
  console.error('Podaj tryb: ' + TRYBY.join(' | '));
  process.exit(1);
}

const edycja = EDYCJE[tryb];

if (edycja) {
  const zrodlo = path.join(KATALOG, edycja.plik);
  if (!fs.existsSync(zrodlo)) {
    console.error('Brak pliku wariantu: ' + edycja.plik);
    process.exit(1);
  }
  fs.copyFileSync(zrodlo, WARIANT);
  console.log('wariant:', edycja.produkt, '(' + edycja.plik + ')');
} else {
  fs.rmSync(WARIANT, { force: true });
  console.log('wariant: publiczny (Nebu, pusta konfiguracja, dane w katalogu uzytkownika)');
}

// Edycje stanowiskowe dostaja tez wersje przenosna - jeden plik, bez instalowania.
// Wersja przenosna powstaje takze dla edycji publicznej - jeden plik .exe da sie
// wskazac Windowsowi jako program domyslny dla plikow .nebu.
const argumenty = tryb === 'sklep'
  ? ['electron-builder', '--win', 'appx']
  : ['electron-builder', '--win', 'nsis', 'portable'];

if (edycja) {
  // Nazwa produktu ma spacje, a polecenie idzie przez powloke - bez cudzyslowow
  // electron-builder dostalby dwa argumenty i odmowil budowania.
  argumenty.push('--config.productName="' + edycja.produkt + '"', '--config.appId=' + edycja.appId);
}

// Drugi argument: katalog wynikowy inny niz dist/. Przydaje sie, gdy w dist lezy paczka,
// ktora juz do kogos pojechala - budowanie nie ma jej ruszac.
const katalogWyjscia = process.argv[3];
if (katalogWyjscia) {
  argumenty.push('--config.directories.output=' + katalogWyjscia);
  console.log('wynik do katalogu:', katalogWyjscia);
}

// Edycja publiczna to zwykla przegladarka wielomonitorowa - nic geodezyjnego do niej nie
// wchodzi. Nie chodzi tylko o wage paczki: w listach ukladow siedza adresy wewnetrzne
// i nazwy obrebow, a skrypty mostow wstrzykuja nasz kod stronom na portach 8080/5000/5555.
// Program i tak ich nie uzywa bez wariantu (WARIANT.geo), ale z paczki do pobrania przez
// kazdego maja po prostu nie istniec. Na czas budowania odkladamy je na bok.
const GEO_PLIKI = [
  'listy',
  path.join('narzedzia', 'most-2d.js'),
  path.join('narzedzia', 'most-3d.js'),
  path.join('narzedzia', 'odswiez-2d.js'),
  path.join('narzedzia', 'obrysy-3d.js'),
  path.join('narzedzia', 'filtr-obrebow.js'),
];
const SCHOWEK = path.join(KATALOG, '.bez-geo');

function przeniesGeo(doSchowka) {
  if (edycja) return; // edycje firmowe i stanowiskowe biora wszystko
  fs.mkdirSync(SCHOWEK, { recursive: true });
  for (const wzgledna of GEO_PLIKI) {
    const wProjekcie = path.join(KATALOG, wzgledna);
    const wSchowku = path.join(SCHOWEK, wzgledna.replace(/[\\/]/g, '__'));
    const [zrodlo, cel] = doSchowka ? [wProjekcie, wSchowku] : [wSchowku, wProjekcie];
    if (fs.existsSync(zrodlo)) fs.renameSync(zrodlo, cel);
  }
  if (!doSchowka) fs.rmSync(SCHOWEK, { recursive: true, force: true });
  console.log(doSchowka ? 'bez geodezji: ' + GEO_PLIKI.join(', ') : 'pliki geodezyjne wrocily do projektu');
}

console.log('buduje:', argumenty.join(' '));
let wynik;
try {
  przeniesGeo(true);
  wynik = spawnSync('npx', argumenty, { cwd: KATALOG, stdio: 'inherit', shell: true });
} finally {
  przeniesGeo(false);
  // Katalog zrodlowy zostaje publiczny - inaczej kolejne uruchomienie "npm start"
  // podnosiloby edycje firmowa przez przypadek.
  fs.rmSync(WARIANT, { force: true });
}

if (wynik.status !== 0) {
  console.error('\nBudowanie nie powiodlo sie.');
  if (tryb === 'sklep') console.error('Paczka .appx wymaga Windows SDK - patrz PUBLIKACJA.md.');
  process.exit(wynik.status || 1);
}

console.log('\nGotowe. Pliki w katalogu dist/');
