# Rust-Core

Der Core bündelt technische Arbeiten mit umfangreichen Dateisystem-, Stream-
und Prozessgrenzen. TanStack, React, Authentifizierung, Berechtigungen,
Drizzle-Schema, SQL-Transaktionen, Queues und fachliche Abläufe bleiben in
`web/src`. JavaScript-Manifest, Lockfile und Web-Konfiguration liegen im Root.

## Zuständigkeiten

| Bisher TypeScript                           | Jetzt Rust                                                                                           | TypeScript bleibt zuständig für                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Archivverschlüsselung und Integrität        | Inkrementelles AES-256-GCM, HKDF, HMAC, Schlüssel- und Dateiprüfung                                  | Autorisierung, Schlüsselübergabe und Download-Antwort          |
| TAR/PAX und Archivvalidierung               | Begrenztes Schreiben, Parsen, Manifestprüfung, sichere Pfade und Extraktion                          | Backup- und Restore-Aufträge, Fortschrittsanzeige              |
| Archivimport und Dateisammlung              | Quarantäne, Kapazitätsreservierung, Dateisperren, Hintergrundbild-Overlay                            | HTTP-Uploadgrenzen und fachliche Admission                     |
| Private Dateien und Hintergrundbilder       | Private Verzeichnisse, atomare Veröffentlichung, Größenlimits, Dateiidentitäten und Legacy-Migration | Benutzerzuordnung, Bildbearbeitung mit Sharp und Audit-Log     |
| Storage-Admission und Dateisperren          | Admission-Gate, Shared-/Exclusive-Leases, Besitzprüfung, Freigabe und Drain                          | SQL-Barrieren, Verbindungsgesundheit und Request-Scope         |
| Physische Storage-Wiederherstellung         | Vorbereitung, persistentes Recovery-Journal, Commit und Rollback                                     | SQL-Barrieren und fachlicher Restore-Ablauf                    |
| Restore-Journal und persistenter Status     | HKDF/HMAC-Kette, gehaltener Journal-Handle, begrenztes Lesen und atomare Statusdatei                 | Fachliche Zustandsentscheidungen und Fortschrittsanzeige       |
| Backup-Dateien und System-Branding          | Root-/Pfadprüfung, gebündelte Archivveröffentlichung und atomare Veröffentlichung der Bildvarianten  | Autorisierung, SQL, Audit-Log und Bildbearbeitung mit Sharp    |
| PostgreSQL-Werkzeugprozesse                 | Versionsprüfung, begrenzte Laufzeit, Abbruch, private Verbindungsdaten und gehaltene Datei-Handles   | Datenbankkonfiguration, SQL und Berechtigungen                 |
| Appliance-Prozessmanager und Prozesskonsole | Prozessstart, Bereitschaft, geordneter Shutdown, Rollenwechsel, begrenzte und bereinigte Logs        | Geschütztes Admin-Dashboard und bestehende App-Initialisierung |

Die Bibliothek hat drei dünne Programme: `marketplace-archive`, `marketplace-storage`
und `marketplace-appliance`. Archiv- und Storage-Aufträge verwenden JSON über
stdin und begrenzte NDJSON-Antworten mit Fortschritt, Ergebnis oder Fehler.
Argumente werden ohne Shell übergeben. Ein privater Abbruchmarker ermöglicht
kooperativen Abbruch auch unter Windows. Unbestätigte Mutationen halten die
bestehende TypeScript-Storage-Barriere geschlossen; ein bereits bestätigtes
Recovery-Ergebnis bleibt bei einem verspäteten Abbruch erhalten.

Zusammengehörige Dateischritte bilden einen Core-Auftrag. Storage-Admission
und Freigabe benötigen jeweils einen Aufruf; Statusdateien werden mit einem
Aufruf geschrieben und synchronisiert. `backupPublishFile` bündelt Datei-Sync,
Umbenennen und Verzeichnis-Sync. Nach einer möglicherweise erfolgten
Veröffentlichung gilt ein fehlender Nachweis als `CORE_OPERATION_UNCERTAIN`.

Ein Restore öffnet `marketplace-storage journal-session` über private
stdin/stdout-Pipes. Rust hält den ursprünglichen Datei-Handle, die
Verzeichnisidentität, die erwarteten kanonischen Bytes und den abgeleiteten
Schlüssel bis zum geprüften Abschluss. Fortlaufende `requestId`-Werte ordnen
Bestätigungen eindeutig zu; fehlende, doppelte oder veraltete Antworten
beenden die Sitzung ohne Wiederholung einer Mutation. Die Sitzung ist auf
32 Anfragen mit je 64 KiB begrenzt. Die Web-Seite begrenzt zusätzlich die
Warteschlange, Antwortzeit und Gesamtlaufzeit. Der Schlüssel wird weder in
Argumenten noch in Logs übertragen. Journalformat und HKDF/HMAC bleiben zu
den unabhängigen Node-Referenzdaten kompatibel.

Branding veröffentlicht alle drei vorbereiteten Bildvarianten in einem
Auftrag und ersetzt jede Datei atomar. Die drei Dateiersetzungen bilden
keine gemeinsame Dateisystemtransaktion; Sharp, SQL und Audit bleiben im
bestehenden fachlichen Ablauf.

Der Appliance-Prozess stellt auf Loopback `/core/health` und ausschließlich
lesbare Log-Snapshots bereit. Das Dashboard fragt den tatsächlichen Prozess
ab und bietet eine zusätzliche Rust-Core-Card mit Konsole. Die Konsole
erfordert auch in der Entwicklung Superuser-Rechte. Im Entwicklungsbetrieb
startet `bun run dev` den Core im reinen Telemetrie-Modus; dieser startet keine
Produktionsdatenbank.

## Dependencies und Laufzeit

- `std` übernimmt Prozesse, Threads, Streams und native Dateisperren. Der Core
  besitzt keinen asynchronen Tokio-Server. Eine zusätzliche Runtime würde für
  diese begrenzten CLI-Aufträge und den kleinen Loopback-Endpunkt keinen
  konkreten Vorteil bringen. Deshalb bleiben `ctrlc` und synchrone I/O passend;
  `tokio::signal`, `tokio::fs`, `CancellationToken` und `TaskTracker` werden
  erst bei einem echten asynchronen Dienst benötigt.
- Die Archivkryptografie verwendet RustCrypto (`hkdf` 0.13, `hmac` 0.13,
  `sha2` 0.11) und `aead-gcm-stream` 0.4 mit dessen kompatibler `aes`-Generation
  0.8. Das bisherige einzelne GCM-Tag und das Archivformat bleiben kompatibel.
  Unabhängige Node-Referenzarchive prüfen beide Richtungen. Der Core benötigt
  weder OpenSSL noch Perl; Rustls wäre hier keine passende Datei-Krypto-API.
- `fs2` entfällt. Sperren verwenden `std::fs::File`; `fs4` mit ausschließlich
  dem `sync`-Feature liefert die plattformübergreifende freie Kapazität.
- `time` vereinheitlicht Zeitformate; `chrono` entfällt. `base64` 0.23 und
  `getrandom` 0.4 sind aktualisiert. `Serde`, `cap-std` und `cap-fs-ext` bleiben
  für explizite Verträge und handle-relative Dateisystemgrenzen erhalten.
- PostgreSQL erhält keine Zugangsdaten über Prozessargumente. Private
  Service-Dateien und `PGPASSWORD` transportieren die Verbindungseinstellungen;
  ein konstanter `--dbname`-Parameter erzwingt bei `pg_restore` die direkte
  Wiederherstellung. Rohes Tool-stderr wird nicht an die Weboberfläche gegeben.

## Prüfung

Alle Rust-Testimplementierungen und Test-Helfer liegen unter `core/tests/`.
Öffentliche Integrationssuiten stehen direkt dort, Tests privater Funktionen
unter `core/tests/unit/`. In `core/src/` bleiben dafür ausschließlich bedingte
Modulverweise; Produktivdateien enthalten keine eingebetteten Testfunktionen.

Rust 1.100.0 ist in `rust-toolchain.toml` festgelegt. Die Root-Kommandos wählen
diese Toolchain auch dann, wenn lokal eine andere Standardversion aktiv ist.
Für lokale Coverage werden zusätzlich `cargo-llvm-cov` und die Rust-Komponente
`llvm-tools-preview` benötigt; die Forgejo-Prüfung ergänzt fehlende Werkzeuge.

```bash
bun run core:build
bun run core:format:check
bun run core:lint
bun run core:test
bun run core:coverage
bun run test
bun run test:core-integration
```

Rust-Prüfungen berücksichtigen alle Targets und Features; Clippy läuft mit
`-D warnings`. `core:coverage` und der dedizierte Forgejo-Runner `rust` erzwingen
mindestens 90 % Zeilen- und Funktionsabdeckung. Zusätzliche LLVM-Werkzeuge
werden nur installiert, wenn sie fehlen. Die vorhandenen Cargo-, rustfmt-
und Clippy-Werkzeuge des Runners werden verwendet.

Zusätzlich prüft `cargo-audit` das aufgelöste Lockfile gegen die aktuelle
RustSec-Datenbank: bei Änderungen, vor Releases und im geplanten
Sicherheitsworkflow. Das Werkzeug wird nur ergänzt, wenn es fehlt; ein
fehlgeschlagener Datenbankabruf gilt als fehlgeschlagene Prüfung.

Reine TypeScript-Tests laufen ohne native Programme. Tests mit tatsächlichen
Rust-Prozessen heißen `*.core.test.ts` und laufen zusätzlich im Docker-Target
`core-integration`; dort sind die Produktionsprogramme verfügbar. Isolierte
Appliance-Fixtures prüfen Startup, Bereitschaft, Datenerhalt und Shutdown
ohne Anwendungsmigrationen. Der Drizzle-Ordner wurde ausschließlich unverändert
nach `web/drizzle` verschoben; `drizzle.config.ts` bleibt im Root.
