# data/

Laufzeitverzeichnis des Flat-File-Speichers. Inhalte gehören **nicht** ins
Repository (siehe `.gitignore`); versioniert sind nur `.htaccess` und diese
Notiz.

```
data/
├── .htaccess      Sperrt den HTTP-Zugriff (Apache)
├── .salt          Installationsspezifisches Salz für Ratenbegrenzungs-Hashes
├── lists/         Verschlüsselte Listen, nach den ersten zwei ID-Zeichen verteilt
│   └── ab/ab12….json
└── throttle/      Zähler pro gehashter IP-Adresse
```

Der Webserver-Benutzer (z. B. `www-data`) benötigt Schreibrechte auf `data/`.
Klartext wird hier nie abgelegt: Jede Listendatei enthält ausschließlich
AES-GCM-Chiffrat, eine Revisionsnummer und den Hash des Schreibnachweises.
