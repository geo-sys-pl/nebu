// Test silnika integracji Nebu - bez Electrona, bez uruchamiania programu.
//
//   node scripts/test-integracje-nebu.cjs
//
// Sprawdzamy trzy rzeczy, kazda z innego powodu:
//   1. czy przyklad Lukasza dziala (wspolrzedne ze srodkowego monitora -> prawy, kamera 50 m),
//   2. czy przepis NIE strzela, gdy brakuje danych - polowiczny adres w oknie roboczym
//      jest gorszy niz brak akcji,
//   3. czy przez przepis nie da sie wyjsc poza podstawienie tekstu: zadnego javascript:,
//      file:, dopisywania parametrow przez wartosc, ani wzorca, ktory zawiesi dopasowanie.

const S = require('C:\\APLIKACJA_3D\\Nebu\\narzedzia\\integracje.js');

let zle = 0;
let razem = 0;

function sprawdz(opis, warunek, szczegol) {
  razem++;
  if (!warunek) zle++;
  console.log((warunek ? 'OK  ' : 'BLAD') + '  ' + opis + (szczegol ? '  | ' + szczegol : ''));
}

// ============================================================ 1. przyklad z zycia
//
// Na srodkowym monitorze aMAPA z kadrem w adresie, na prawym model 3D.

const PRZYKLAD = {
  nazwa: 'Wspolrzedne ze srodkowego do prawego',
  zrodloMonitor: 2,
  celMonitor: 3,
  szablon: 'http://model.example.org:5000/?x={x}&y={y}&h=50',
  kiedy: 'zmiana',
};

let w = S.wykonaj(PRZYKLAD, 'http://mapa.example.org:8080/viewer/?user=GEO-SYS&x=6543210.12&y=5678901.34&z=15');
sprawdz('przyklad: sklada adres', w.ok, w.ok ? w.adres : w.powod);
sprawdz('przyklad: kamera 50 m w adresie', !!w.ok && w.adres.includes('h=50'));
sprawdz('przyklad: wspolrzedne przepisane', !!w.ok && w.adres.includes('x=6543210.12') && w.adres.includes('y=5678901.34'));

// Mapy trzymaja kadr we fragmencie: #zoom/lat/lon -> f1, f2, f3.
w = S.wykonaj(
  { ...PRZYKLAD, szablon: 'https://example.org/3d?lat={f2}&lon={f3}&h=50' },
  'https://mapa.example.org/#19/50.2584/19.0275',
);
sprawdz('fragment mapowy #zoom/lat/lon', !!w.ok && w.adres.includes('lat=50.2584') && w.adres.includes('lon=19.0275'), w.ok ? '' : w.powod);

// Wzorzec wlasny: numer dzialki ze sciezki.
w = S.wykonaj(
  { ...PRZYKLAD, wzorzec: '/dzialka/(?<dzialka>[0-9/]+)$', szablon: 'https://example.org/szukaj?id={dzialka}' },
  'https://geoportal.example.org/dzialka/121/7',
);
sprawdz('wzorzec wlasny: nazwana grupa', !!w.ok && w.adres.includes('id=121%2F7'), w.ok ? w.adres : w.powod);

// ============================================================ 2. kiedy NIE strzelamy

w = S.wykonaj(PRZYKLAD, 'http://mapa.example.org:8080/viewer/?user=GEO-SYS');
sprawdz('brak wspolrzednych - nie strzela', !w.ok, w.powod);
sprawdz('brak wspolrzednych - mowi czego brakuje', !w.ok && /x/.test(w.powod) && /y/.test(w.powod), w.powod);

w = S.wykonaj({ ...PRZYKLAD, wlaczona: false }, 'http://a.example/?x=1&y=2');
sprawdz('przepis wylaczony - nie strzela', !w.ok);

w = S.wykonaj({ ...PRZYKLAD, zrodloMonitor: 3 }, 'http://a.example/?x=1&y=2');
sprawdz('zrodlo = cel - odrzucone', !w.ok, w.powod);

w = S.wykonaj({ ...PRZYKLAD, zrodloMonitor: 0 }, 'http://a.example/?x=1&y=2');
sprawdz('monitor 0 - odrzucone', !w.ok, w.powod);

// Pusty adres zrodla (nowa karta, about:blank) - nie ma skad brac.
w = S.wykonaj(PRZYKLAD, 'about:blank');
sprawdz('about:blank - nie strzela', !w.ok);

// ============================================================ 3. proby wyjscia poza podstawienie

for (const zly of [
  'javascript:alert(1)?x={x}',
  'file:///C:/Windows/System32/calc.exe?x={x}',
  'smb://obcy/udzial/zly.exe?x={x}',
  'ms-msdt:/id PCWDiagnostic?x={x}',
  'model.example.org:5000/?x={x}',
]) {
  const wynik = S.wykonaj({ ...PRZYKLAD, szablon: zly }, 'http://a.example/?x=1&y=2');
  sprawdz('szablon odrzucony: ' + zly.slice(0, 34), !wynik.ok);
}

// Wartosc ze zrodla NIE moze dopisac parametru ani zmienic adresu - jest kodowana.
w = S.wykonaj(
  { ...PRZYKLAD, szablon: 'http://cel.example/?x={x}&h=50' },
  'http://a.example/?x=' + encodeURIComponent('1&h=9999&admin=1') + '&y=2',
);
sprawdz('wartosc nie dopisze parametru', !!w.ok && !/h=9999/.test(w.adres) && /h=50/.test(w.adres), w.ok ? w.adres : w.powod);

w = S.wykonaj(
  { ...PRZYKLAD, szablon: 'http://cel.example/?x={x}' },
  'http://a.example/?x=' + encodeURIComponent('../../../etc/passwd') + '&y=2',
);
sprawdz('wartosc nie wyjdzie ze sciezki', !!w.ok && !w.adres.includes('../'), w.ok ? w.adres : '');

// Wzorzec, ktory potrafi zawiesic dopasowanie (katastrofalny nawrot).
sprawdz('wzorzec (a+)+ odrzucony', !S.wzorzecBezpieczny('(a+)+$').ok, S.wzorzecBezpieczny('(a+)+$').powod);
sprawdz('wzorzec dlugi odrzucony', !S.wzorzecBezpieczny('a'.repeat(500)).ok);
sprawdz('wzorzec niepoprawny odrzucony', !S.wzorzecBezpieczny('(?<x>[').ok);

// Pola, ktorych nie znamy, nie wchodza do silnika.
const u = S.uporzadkuj({ ...PRZYKLAD, kod: 'require("fs").rmSync("C:/", {recursive:true})', wlaczona: true });
sprawdz('obce pole wyciete', u.kod === undefined);
sprawdz('nieznane "kiedy" wraca do domyslnego', S.uporzadkuj({ ...PRZYKLAD, kiedy: 'cokolwiek' }).kiedy === 'zmiana');

// Opis po polsku - uzytkownik zatwierdza to, co rozumiemy, nie swoje zdanie.
const opis = S.poPolsku(PRZYKLAD);
sprawdz('opis mowi o monitorach', opis.includes('monitora 2') && opis.includes('monitorze 3'));
sprawdz('opis wymienia czytane pola', opis.includes('x, y'), opis.split('\n')[0]);

console.log(zle
  ? '\n' + zle + ' z ' + razem + ' PRZYPADKOW NIE PRZESZLO'
  : '\nWSZYSTKIE ' + razem + ' PRZYPADKOW OK');
process.exitCode = zle ? 1 : 0;
