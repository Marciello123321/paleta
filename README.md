# Paleta

Aplikacja na telefon dla ekipy: grupki, czaty, wspólne notatniki, rozmowy głosowe i wideo, udostępnianie ekranu.

Działa jak strona (PWA): otwierasz w przeglądarce i dodajesz do ekranu głównego. Nie ma kont ani własnego serwera.
Telefony łączą się ze sobą bezpośrednio (WebRTC przez PeerJS), a **nick jest adresem**.

## Jak działa
- Wybierasz nick (pierwszy kto go zajmie, ma go). Znajomych dodajesz po nicku, druga osoba przyjmuje prośbę.
- Grupki mają wspólne notatniki z reakcjami oraz czat. Wpisy lecą od razu do wszystkich online.
- Wiadomości do osób offline czekają w kolejce i są ponawiane, aż druga strona potwierdzi odbiór.
- Rozmowy 1:1: głos, wideo, przełączanie kamery, udostępnianie ekranu (tam, gdzie przeglądarka to umie).

## Uruchomienie lokalne
```bash
python3 -m http.server 8000
```
Test na jednym komputerze: otwórz dwie karty w osobnych profilach/oknach prywatnych i załóż dwa nicki.

## Ograniczenia
- Dane są tylko na telefonie (localStorage). Wylogowanie = utrata historii.
- Gdy obie strony są za restrykcyjną siecią komórkową, rozmowa może się nie połączyć (korzysta z darmowych serwerów STUN/TURN).
- Udostępnianie ekranu z telefonu z poziomu przeglądarki zwykle nie działa. Oglądać cudzy ekran można zawsze.
- Powiadomienia, gdy aplikacja jest zamknięta, wymagałyby własnego serwera.
