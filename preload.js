// Most miedzy wlasnymi stronami Nebu (pasek, ekran startowy, ustawienia) a programem.
// Strony z internetu go nie dostaja.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('geo', {
  // pasek narzedzi
  akcja: (nazwa, wartosc) => ipcRenderer.send('akcja', nazwa, wartosc),
  naStan: (fn) => ipcRenderer.on('stan', (_zdarzenie, stan) => fn(stan)),

  // ekran startowy
  dajKafelki: () => ipcRenderer.send('start-daj-kafelki'),
  naKafelki: (fn) => ipcRenderer.on('start-kafelki', (_zdarzenie, dane) => fn(dane)),
  otworzStan: (sciezka) => ipcRenderer.send('start-otworz-stan', sciezka),
  otworzUstawienia: () => ipcRenderer.send('start-ustawienia'),

  // okno logowania
  zaloguj: (uzytkownik, haslo) => ipcRenderer.send('zaloguj', uzytkownik, haslo),
  naLogowanie: (fn) => ipcRenderer.on('logowanie-wynik', (_zdarzenie, wynik) => fn(wynik)),
  naNazweEdycji: (fn) => ipcRenderer.on('logowanie-nazwa', (_zdarzenie, nazwa) => fn(nazwa)),

  // okno integracji pisanych slowami
  otworzIntegracje: () => ipcRenderer.send('integracje-otworz'),
  dajIntegracje: () => ipcRenderer.send('integracje-daj'),
  naIntegracje: (fn) => ipcRenderer.on('integracje-dane', (_zdarzenie, dane) => fn(dane)),
  zapiszIntegracje: (lista) => ipcRenderer.send('integracje-zapisz', lista),
  poZapisieIntegracji: (fn) => ipcRenderer.on('integracje-zapisane', (_zdarzenie, dane) => fn(dane)),
  napiszIntegracje: (zdanie) => ipcRenderer.send('integracje-napisz', zdanie),
  naPrzepisOdAi: (fn) => ipcRenderer.on('integracje-napisane', (_zdarzenie, wynik) => fn(wynik)),
  sprawdzIntegracje: (przepis) => ipcRenderer.send('integracje-sprawdz', przepis),
  naSprawdzeniu: (fn) => ipcRenderer.on('integracje-sprawdzone', (_zdarzenie, wynik) => fn(wynik)),
  uruchomIntegracje: (nazwa) => ipcRenderer.send('integracje-uruchom', nazwa),
  naUruchomieniu: (fn) => ipcRenderer.on('integracje-wynik', (_zdarzenie, wynik) => fn(wynik)),
  zapiszKluczAi: (klucz) => ipcRenderer.send('klucz-ai-zapisz', klucz),
  usunKluczAi: () => ipcRenderer.send('klucz-ai-usun'),
  naKluczuAi: (fn) => ipcRenderer.on('klucz-ai-stan', (_zdarzenie, stan) => fn(stan)),

  // okno ustawien
  dajUstawienia: () => ipcRenderer.send('ustawienia-daj'),
  naUstawienia: (fn) => ipcRenderer.on('ustawienia-dane', (_zdarzenie, dane) => fn(dane)),
  zapiszUstawienia: (dane) => ipcRenderer.send('ustawienia-zapisz', dane),
  zamknijUstawienia: () => ipcRenderer.send('ustawienia-zamknij'),
  wyczyscDane: () => ipcRenderer.send('ustawienia-czysc'),
  poCzyszczeniu: (fn) => ipcRenderer.on('ustawienia-wyczyszczono', () => fn()),
});
