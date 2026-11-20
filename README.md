# Paleta

Aplikacja na telefon dla naszej ekipy: grupki, czaty, wspólne notatniki, dzwonienie, kamerka i udostępnianie ekranu.

## Jak odpalić

```bash
python3 -m http.server 8000
```

Wejdź na `http://localhost:8000`. Na telefonie (w tej samej sieci Wi‑Fi) wpisz adres IP komputera, np. `http://192.168.1.10:8000`,
i wybierz „Dodaj do ekranu głównego”.

**Test „na żywo”:** otwórz drugą kartę z adresem `?jako=Kuba` i napisz coś w notatniku. Pierwsza karta zobaczy to od razu.

## Co już jest
- Panel po lewej: grupki, czaty, kontakty (dodawanie, szukanie)
- Górny pasek: dzwonienie, kamerka, udostępnianie ekranu, ustawienia
- Ustawienia: nick, 5 stylów (Noc, Dzień, Neon, Pastel, Ocean), dźwięk
- Notatniki grupki (kilka na grupkę) + reakcje emoji
- Czat grupowy i prywatny

## Co dalej
- Serwer (np. Supabase/Firebase), żeby wpisy szły między telefonami, a nie tylko między kartami
- Logowanie i dodawanie znajomych po nicku/kodzie
- Prawdziwe rozmowy przez WebRTC (teraz jest tylko podgląd własnej kamerki/ekranu)
