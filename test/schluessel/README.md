# Test-Schlüssel (öffentlich bekannt)

Dieses minisign-Schlüsselpaar ist **öffentlich** und nur für Tests: die CI signiert damit die
Manifeste der Beispiel-App zur Testzeit und Release-Kandidaten (docs/plan.md, „Signaturen in
Tests“). Ein Build für ein Release und der Agent außerhalb von Tests lehnen diesen Schlüssel ab.
Erzeugt mit `minisign -G -W` (ohne Passwort), Schlüssel-ID `3D1586A2B972C948`.
