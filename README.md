# Paleta

Aplikacja na telefon dla ekipy: grupki, czaty, wspólne notatniki, rozmowy głosowe i wideo, udostępnianie ekranu.

Działa jak strona (PWA): otwierasz w przeglądarce i dodajesz do ekranu głównego. Nie ma kont ani własnego serwera.
Telefony łączą się ze sobą bezpośrednio (WebRTC przez PeerJS), a **nick jest adresem**.

## Jak działa
- Wybierasz nick (pierwszy kto go zajmie, ma go). Znajomych dodajesz po nicku, od razu, jak w WhatsAppie.
- Grupkę tworzysz z kilku osób naraz (zaznaczasz albo wpisujesz nicki po przecinku), a później dopisujesz kolejne w informacjach o grupce.
- Po lewej stała kolumna z grupkami i znajomymi, u góry pasek z dzwonieniem, wideo i ustawieniami.
- W grupce każdy ma swój notatnik (pisze tylko właściciel, reszta czyta i reaguje emoji) oraz wspólny czat. Wpisy lecą od razu do wszystkich online.
- Wiadomości do osób offline czekają w kolejce i są ponawiane, aż druga strona potwierdzi odbiór.
- Rozmowy 1:1 i grupowe (każdy łączy się z każdym, najlepiej do ok. 4–5 osób): głos, wideo, przełączanie kamery, udostępnianie ekranu tam, gdzie przeglądarka to umie.

## Uruchomienie lokalne
```bash
python3 -m http.server 8000
```
Test na jednym komputerze: otwórz dwie karty w osobnych profilach/oknach prywatnych i załóż dwa nicki.

## Dzwonienie
- Dzwonisz także do osób offline: jeśli mają włączony dzwonek (ntfy), dostają powiadomienie „dzwoni”, a po otwarciu Palety rozmowa łączy się sama.
- W czacie zostają wpisy o rozmowach: wychodzące, przychodzące, nieodebrane (z czasem trwania). Stuknięcie wpisu oddzwania.

## Ograniczenia
- Dane są tylko na telefonie (localStorage). Wylogowanie = utrata historii.
- Gdy obie strony są za restrykcyjną siecią komórkową, rozmowa może się nie połączyć (korzysta z darmowych serwerów STUN/TURN).
- Udostępnianie ekranu z telefonu z poziomu przeglądarki zwykle nie działa. Oglądać cudzy ekran można zawsze.
- Dzwonek i powiadomienia przy zamkniętej aplikacji idą przez darmową aplikację ntfy (ntfy.sh). Każdy włącza to raz w Ustawieniach. Powiadomienia zawierają tylko nick i nazwę grupki, nigdy treść.
