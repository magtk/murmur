# Security / Bezpieczeństwo

## Zgłaszanie podatności / Reporting a vulnerability

**PL:** Jeśli znajdziesz podatność, **nie zgłaszaj jej w publicznym Issue**. Użyj prywatnego zgłoszenia:
[github.com/magtk/murmur/security/advisories/new](https://github.com/magtk/murmur/security/advisories/new)
(albo zakładka *Security → Report a vulnerability*). Jeśli nie masz konta GitHub — e-mail: [magtk@duck.com](mailto:magtk@duck.com?subject=murmur%20%E2%80%93%20security) (tylko opis, bez szczegółów wykorzystania; dogadamy bezpieczny kanał).

**EN:** If you find a vulnerability, **please don't open a public issue**. Use a private report:
[github.com/magtk/murmur/security/advisories/new](https://github.com/magtk/murmur/security/advisories/new)
(or *Security → Report a vulnerability*). No GitHub account? E-mail [magtk@duck.com](mailto:magtk@duck.com?subject=murmur%20%E2%80%93%20security) (a short description only, no exploit details; we'll agree on a secure channel).

Opisz, co i jak można wykorzystać, kroki do odtworzenia i wersję (stopka strony głównej).
Describe the issue, how it can be exploited, steps to reproduce and the version (start-page footer).

## Wspierane wersje / Supported versions

Poprawki trafiają tylko do najnowszej wersji na `main` (to ona jest na GitHub Pages).
Fixes go to the latest version on `main` only (the one served on GitHub Pages).

## Zakres / Scope

Interesują mnie zwłaszcza / Especially relevant:
- wykonanie kodu przez treść kartki, tytuł, pseudonim lub plik `.json` (XSS) / code execution via card text, titles, pseudonyms or imported `.json` (XSS);
- podszycie się pod prowadzącego lub obejście weryfikacji odcisku klucza / impersonating the instructor or bypassing the key-fingerprint check;
- obejście uprawnień (edycja cudzych kartek, wielokrotne głosy, odpowiedzi po zamknięciu quizu) / permission bypass (editing others' cards, multiple votes, answering a closed quiz);
- wyciek treści ukrytych kartek lub podpisów w trybie anonimowym / leaking hidden cards or names in anonymous mode.

Poza zakresem (znane i opisane w README) / Out of scope (known and documented):
- widoczność adresów IP między uczestnikami P2P, dla przekaźników Nostr i serwerów STUN / IP visibility between P2P peers, to Nostr relays and STUN servers;
- dostęp osoby, która zna link lub kod tablicy / access by anyone who has the board link or code;
- dostępność publicznych przekaźników Nostr / availability of public Nostr relays.

murmur to projekt rozwijany po godzinach: odpowiadam najszybciej, jak mogę, bez gwarantowanego terminu.
murmur is a spare-time project: I respond as soon as I can, without a guaranteed timeline.
