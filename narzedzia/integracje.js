// Integracje miedzy oknami, pisane slowami przez uzytkownika.
//
// Przyklad, od ktorego to sie zaczelo: "wez wspolrzedne z aplikacji na srodkowym monitorze
// i wpisz je w aplikacje na prawym, z kamera na wysokosci 50 m".
//
// ============================================================ dlaczego tak, a nie "AI pisze kod"
//
// Nasuwa sie rozwiazanie proste: niech model napisze JavaScript i niech Nebu go uruchomi.
// Nie robimy tego. Program ma byc do pobrania przez kazdego, a kod z modelu uruchomiony
// w oknie strony to dokladnie ta sama dziura, ktora zalatalismy w audycie - tylko tym razem
// wpuszczona glownym wejsciem. Zamiast tego model wypelnia PRZEPIS: kilka pol o ustalonym
// znaczeniu. Przepis nie jest kodem i nic nie wykonuje; Nebu czyta go i robi jedna rzecz -
// sklada adres i otwiera go w drugim oknie.
//
// Konsekwencja, ktora trzeba znac: to dziala z aplikacjami, ktore trzymaja swoj stan
// w adresie (wspolrzedne, zoom, numer dzialki, wysokosc kamery - jak nasza aMAPA, model 3D,
// Google Maps, OSM, geoportal). Dla aplikacji, ktora stanu w adresie nie trzyma, przepis
// nie ma skad go wziac i trzeba mostu pisanego recznie.
//
// ============================================================ przepis
//
// {
//   "nazwa": "Wspolrzedne ze srodkowego do prawego",
//   "zrodloMonitor": 2,            // numer monitora liczony od lewej
//   "wzorzec": "",                 // puste = czytamy parametry z adresu (?x=..&y=.. oraz #..)
//   "celMonitor": 3,
//   "szablon": "http://localhost:5000/?x={x}&y={y}&h=50",
//   "kiedy": "zmiana" | "skrot",
//   "wlaczona": true
// }

'use strict';

const DOZWOLONE_POLA = [
  'nazwa', 'zrodloMonitor', 'wzorzec', 'celMonitor', 'szablon', 'kiedy', 'wlaczona', 'opis',
];

const KIEDY = ['zmiana', 'skrot'];

// Nazwy wartosci: litery, cyfry i podkreslenie. Bez kropek i nawiasow - zeby szablon nie
// udawal niczego wiecej niz podstawienie tekstu.
const NAZWA_WARTOSCI = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ------------------------------------------------------------------ czytanie wartosci z adresu

// Parametry z zapytania (?x=1&y=2), z fragmentu w tym samym zapisie (#x=1&y=2) oraz
// z fragmentu "sciezkowego", ktorego uzywaja mapy: #19/50.123/19.456 -> f1, f2, f3.
function wartosciZAdresu(adres) {
  const wartosci = {};
  let u;
  try { u = new URL(String(adres)); } catch (_) { return wartosci; }
  if (!/^https?:$/i.test(u.protocol)) return wartosci;

  for (const [k, v] of u.searchParams) if (NAZWA_WARTOSCI.test(k)) wartosci[k] = v;

  const fragment = u.hash.replace(/^#/, '');
  if (fragment.includes('=')) {
    for (const [k, v] of new URLSearchParams(fragment)) {
      if (NAZWA_WARTOSCI.test(k) && wartosci[k] === undefined) wartosci[k] = v;
    }
  } else if (fragment) {
    fragment.split('/').forEach((czesc, i) => {
      if (czesc !== '') wartosci['f' + (i + 1)] = czesc;
    });
  }
  return wartosci;
}

// Wzorzec uzupelnia to, czego w parametrach nie ma: nazwane grupy wyrazenia regularnego
// dopasowanego do calego adresu. Wzorzec pochodzi od uzytkownika albo od modelu, wiec
// traktujemy go jak dane: ograniczamy dlugosc i tniemy dopasowanie po czasie nie da sie
// w JS, dlatego odrzucamy zapisy, ktore potrafia sie zapetlic wykladniczo.
const WZORZEC_MAKS = 400;
const WZORZEC_GROZNY = /(\([^)]*[+*][^)]*\)|\[[^\]]*\][+*])[+*]/; // (a+)+ , [a-z]*+ itp.

function wzorzecBezpieczny(wzorzec) {
  if (!wzorzec) return { ok: true };
  if (wzorzec.length > WZORZEC_MAKS) return { ok: false, powod: 'wzorzec dluzszy niz ' + WZORZEC_MAKS + ' znakow' };
  if (WZORZEC_GROZNY.test(wzorzec)) return { ok: false, powod: 'wzorzec z zagniezdzonym powtorzeniem - moze zawiesic dopasowanie' };
  try { new RegExp(wzorzec); } catch (e) { return { ok: false, powod: 'wzorzec nie jest poprawnym wyrazeniem: ' + e.message }; }
  return { ok: true };
}

function wartosciZWzorca(adres, wzorzec) {
  if (!wzorzec) return {};
  if (!wzorzecBezpieczny(wzorzec).ok) return {};
  const m = String(adres).match(new RegExp(wzorzec));
  if (!m || !m.groups) return {};
  const wartosci = {};
  for (const [k, v] of Object.entries(m.groups)) {
    if (v !== undefined && NAZWA_WARTOSCI.test(k)) wartosci[k] = v;
  }
  return wartosci;
}

function czytajZrodlo(adres, wzorzec) {
  return { ...wartosciZAdresu(adres), ...wartosciZWzorca(adres, wzorzec) };
}

// ------------------------------------------------------------------ skladanie adresu celu

// Podstawienie {nazwa} -> wartosc. Wartosci sa kodowane, wiec nie da sie nimi dopisac
// kolejnego parametru ani wyjsc z adresu. Brak choc jednej wartosci = nie strzelamy wcale:
// polowiczny adres otwarty w oknie roboczym jest gorszy niz nic.
function zbudujAdres(szablon, wartosci) {
  const potrzebne = [...String(szablon).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
  const brakuje = [...new Set(potrzebne)].filter((n) => wartosci[n] === undefined || wartosci[n] === '');
  if (brakuje.length) return { ok: false, brakuje };

  const adres = String(szablon).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, n) => encodeURIComponent(String(wartosci[n])));

  if (!/^https?:\/\//i.test(adres)) return { ok: false, powod: 'adres celu musi zaczynac sie od http:// albo https://' };
  try { new URL(adres); } catch (_) { return { ok: false, powod: 'po podstawieniu wyszedl niepoprawny adres' }; }
  return { ok: true, adres, uzyte: [...new Set(potrzebne)] };
}

// ------------------------------------------------------------------ sprawdzenie przepisu

function sprawdzPrzepis(przepis) {
  const bledy = [];
  if (!przepis || typeof przepis !== 'object') return { ok: false, bledy: ['przepis nie jest obiektem'] };

  const obce = Object.keys(przepis).filter((k) => !DOZWOLONE_POLA.includes(k));
  if (obce.length) bledy.push('nieznane pola: ' + obce.join(', '));

  if (!String(przepis.nazwa || '').trim()) bledy.push('brak nazwy');

  for (const pole of ['zrodloMonitor', 'celMonitor']) {
    const n = przepis[pole];
    if (!Number.isInteger(n) || n < 1 || n > 9) bledy.push(pole + ': numer monitora musi byc liczba 1-9');
  }
  if (przepis.zrodloMonitor === przepis.celMonitor) bledy.push('zrodlo i cel to ten sam monitor');

  const szablon = String(przepis.szablon || '');
  if (!/^https?:\/\//i.test(szablon)) bledy.push('szablon adresu musi zaczynac sie od http:// albo https://');
  if (/\{\s*\}/.test(szablon)) bledy.push('szablon ma puste {}');

  const w = wzorzecBezpieczny(String(przepis.wzorzec || ''));
  if (!w.ok) bledy.push(w.powod);

  if (przepis.kiedy !== undefined && !KIEDY.includes(przepis.kiedy)) {
    bledy.push('kiedy: dozwolone ' + KIEDY.join(' albo '));
  }

  return { ok: bledy.length === 0, bledy };
}

// Przepis od modelu albo z pliku - obcinamy do znanych pol i domyslnych wartosci,
// zeby do silnika nie weszlo nic, czego nie rozumiemy.
function uporzadkuj(przepis) {
  const p = przepis && typeof przepis === 'object' ? przepis : {};
  return {
    nazwa: String(p.nazwa || '').trim().slice(0, 80),
    opis: String(p.opis || '').trim().slice(0, 300),
    zrodloMonitor: Number.parseInt(p.zrodloMonitor, 10) || 0,
    wzorzec: String(p.wzorzec || '').slice(0, WZORZEC_MAKS),
    celMonitor: Number.parseInt(p.celMonitor, 10) || 0,
    szablon: String(p.szablon || '').trim().slice(0, 600),
    kiedy: KIEDY.includes(p.kiedy) ? p.kiedy : 'zmiana',
    wlaczona: p.wlaczona !== false,
  };
}

// Jedno przejscie: adres zrodla + przepis -> adres do otwarcia w celu (albo powod, czemu nie).
function wykonaj(przepis, adresZrodla) {
  const p = uporzadkuj(przepis);
  const sprawdzenie = sprawdzPrzepis(p);
  if (!sprawdzenie.ok) return { ok: false, powod: sprawdzenie.bledy.join('; ') };
  if (!p.wlaczona) return { ok: false, powod: 'przepis wylaczony' };

  const wartosci = czytajZrodlo(adresZrodla, p.wzorzec);
  const wynik = zbudujAdres(p.szablon, wartosci);
  if (!wynik.ok) {
    return {
      ok: false,
      powod: wynik.brakuje
        ? 'w adresie zrodla nie ma: ' + wynik.brakuje.join(', ')
        : wynik.powod,
      wartosci,
    };
  }
  return { ok: true, adres: wynik.adres, wartosci, uzyte: wynik.uzyte };
}

// Opis przepisu po polsku - do pokazania uzytkownikowi PRZED zapisaniem. Zatwierdza to,
// co rozumie, a nie zdanie, ktore wpisal.
function poPolsku(przepis) {
  const p = uporzadkuj(przepis);
  const pola = [...new Set([...p.szablon.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))];
  const skad = p.wzorzec ? 'adresu (wzorzec wlasny)' : 'adresu';
  return [
    'Z monitora ' + p.zrodloMonitor + ' czytam z ' + skad + ': ' + (pola.length ? pola.join(', ') : '(nic)') + '.',
    'Na monitorze ' + p.celMonitor + ' otwieram: ' + p.szablon,
    p.kiedy === 'zmiana'
      ? 'Dzieje sie samo, gdy adres na monitorze ' + p.zrodloMonitor + ' sie zmieni.'
      : 'Dzieje sie po nacisnieciu skrotu.',
  ].join('\n');
}

module.exports = {
  DOZWOLONE_POLA, KIEDY,
  wartosciZAdresu, wartosciZWzorca, czytajZrodlo,
  zbudujAdres, sprawdzPrzepis, uporzadkuj, wykonaj, poPolsku, wzorzecBezpieczny,
};
