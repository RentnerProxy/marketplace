# Appliance betreiben

Die Produktion besteht aus einem Image und einem Dienst. Der native Rust-Prozess `marketplace-appliance` überwacht PostgreSQL, Valkey, Bun-Webserver und Bun-Worker gemeinsam. Die normale Konfiguration steht vollständig in `.env.example`; Datenbankname, interne Ports, Dateipfade, Valkey-Zugang und Absendername werden mit dem Image ausgeliefert. SMTP bleibt für die Mail-Queue erforderlich. Erforderliche Einstellungen werden vor dem Datenbankstart geprüft; die fachliche Konfigurationsprüfung und das vorhandene Schema-Bootstrap bleiben in den TypeScript-App-Einstiegspunkten. `MAIL_FROM` fällt bei leerem Wert auf `SMTP_USER` zurück.

## Daten und Sicherungen

- `/data/postgresql/18/docker`: dauerhafter PostgreSQL-18-Cluster, ausschließlich vom PostgreSQL-Benutzer lesbar.
- `/data/storage/public` und `/data/storage/private`: App-Dateien, Eigentümer UID 1000.
- `/data/backups`: verschlüsselte App-Backups einschließlich Datenbank und optionaler App-Dateien; Hostpfad aus `BACKUP_PATH`, Eigentümer UID 1000, Modus 0700.
- `/run/marketplace`: kurzlebige Sockets und gehashte Valkey-ACL, keine dauerhafte Ablage.

Die integrierte Backup-Verwaltung verwendet `pg_dump` und `pg_restore` aus derselben PostgreSQL-Hauptversion. Regelmäßig ein vollständiges Backup mit App-Dateien erstellen und in einer getrennten Installation mit demselben `AUTH_ENCRYPTION_KEY` über die Wiederherstellungsfunktion prüfen. Schlüssel und externe Backup-Kopie gehören außerhalb des ausgefallenen Hosts aufbewahrt. Ein Kopieren eines laufenden PostgreSQL-Verzeichnisses ersetzt kein konsistentes Backup.

## Wartung bei Startfehlern

Im laufenden Dienst öffnet `docker compose exec rentnerproxy-marketplace appliance-psql` eine Datenbanksitzung mit den konfigurierten Zugangsdaten, ohne das Passwort in Argumenten auszugeben. Mit `-d postgres` lässt sich die Verwaltungsdatenbank wählen.

Wenn die App nicht startet, zunächst `docker compose logs rentnerproxy-marketplace` prüfen. Der Modus `maintenance` startet ausschließlich einen vorhandenen PostgreSQL-18-Cluster und die interne Bereitschaftsprüfung. Er initialisiert keine Datenbank, startet keine App, synchronisiert keine Rechte und führt keine Migrationen aus. Vorher sämtliche anderen Container stoppen, die dieses Datenvolume verwenden:

```bash
docker compose stop rentnerproxy-marketplace
docker compose run -d --no-deps --name rentnerproxy-marketplace-maintenance rentnerproxy-marketplace maintenance
docker exec -it rentnerproxy-marketplace-maintenance appliance-psql
# Nach der Wartung den ausschließlich dafür gestarteten Container beenden:
docker stop --time 60 rentnerproxy-marketplace-maintenance
docker rm rentnerproxy-marketplace-maintenance
docker compose up -d
```

Für Wartung mit einem früheren Release zuerst dessen exaktes kompatibles Image in Compose wählen. Niemals zwei PostgreSQL-Server mit demselben Datenverzeichnis starten. Ein ungültiger oder fremder Cluster wird auch im Wartungsmodus abgewiesen; er wird nicht automatisch ersetzt, konvertiert oder umberechtigt. Beschädigte Daten nur anhand einer geschützten Kopie und mit passender PostgreSQL-Version untersuchen.

## Umstieg von der bisherigen Compose-Datei

Die alten Datenbank-, App- und Backup-Volumes werden nicht automatisch in `tanstackdummy_data` verschoben. Vor dem Umstieg ein vollständiges verschlüsseltes App-Backup mit Dateispeicher erzeugen, außerhalb der bisherigen Volumes sichern und eine Wiederherstellung prüfen. `AUTH_ENCRYPTION_KEY`, Datenbankzugang und SMTP-Konfiguration unverändert übernehmen; `APP_ORIGIN` wird zu `ORIGIN` und `BACKUP_PATH` auf den gewünschten Hostpfad gesetzt.

Danach mit der alten Compose-Datei alle bisherigen Dienste geordnet stoppen und die alten Volumes für einen möglichen Rückweg behalten. Anschließend mit der neuen Compose-Datei die Appliance starten, über den Setup-Link einen vorläufigen Admin anlegen und das gesicherte Archiv über die integrierte Wiederherstellung importieren. Benutzer, Berechtigungen und Dateien anschließend prüfen. Die alten Container erst danach entfernen; dabei niemals `down --volumes` oder Volume-Pruning verwenden. Dieser Umstieg ist ein geplanter Backup-/Restore-Schritt mit Wartungsfenster, kein gewöhnliches `pull && up`.

## Updates und Fehlerverhalten

Für reguläre Updates dieselben Volumes und Secrets verwenden. Vorher laufende Wiederherstellungen abschließen lassen und ein geprüftes Backup anlegen. `docker compose pull && docker compose up -d` ersetzt ausschließlich das Image. Für reproduzierbare Updates und Rollbacks einen konkreten Release-Tag oder Digest verwenden; `latest` ist nur der bewegliche Standardkanal. Der Rückweg muss zu Datenbankschema und Datenformat passen.

Die Stoppschonfrist von `4h10m` ist eine Obergrenze zum Schutz der bestehenden vierstündigen Backup-/Restore-Frist und keine feste Wartezeit. Ohne laufende Jobs beenden sich die Verbraucher ohne zusätzliche Schonfrist. Der Webserver reicht das Stoppsignal sofort an den internen App-Server weiter. Nach dem HTTP- und Core-Drain schließt die App ihre Queue-Produzenten und Valkey-Verbindungen, damit offene Sockets und Reconnect-Timer den Prozess nicht am Leben halten. Laufende Backup-/Restore-Prozessoren und ihre nativen Helfer dürfen weiterhin abschließen; PostgreSQL und Valkey bleiben bis zum Ende dieses Drains verfügbar. Während des Stopps ist die Appliance erwartungsgemäß nicht mehr bereit (`unhealthy`).

Nach der internen Drain-Frist erzwingt der Prozessmanager einen Stop; ein explizites `docker kill`, zu kurze manuelle Stop-Timeouts oder Hostausfall können diesen Schutz umgehen. Bei PostgreSQL-Major-Upgrades sind ein eigener Upgradeplan, verifiziertes Backup und ein geprüfter Rückweg erforderlich; dieses Image bleibt bei PostgreSQL 18.

Die Logkonsole hält maximal 300 bereinigte Zeilen je Dienst für höchstens eine Stunde im Arbeitsspeicher. Die echte Containerausgabe enthält den vollständigen ersten Setup-Link. Docker-Logrotation wird auf dem Host über die Docker-Daemon-Konfiguration eingerichtet.

Die ausschließlich an `127.0.0.1:3004` gebundene Rust-Telemetrie liefert `/core/health` mit Version, PID, Laufzeit und Status des tatsächlich laufenden Core-Prozesses. `/logs?service=core` liefert den bereinigten Supervisor-Verlauf; die Dienste `webserver`, `worker`, `postgresql` und `valkey` bleiben verfügbar. `/health` prüft die tatsächlich benötigten Dienste. PostgreSQL wird beim Stoppen mit SIGINT für einen schnellen geordneten Shutdown beendet, nachdem Webserver und Worker ihren Drain abgeschlossen haben.

Für lokale Entwicklung startet `marketplace-appliance serve` ausschließlich diese Loopback-Telemetrie, ohne Datenbank, Initialisierung oder App-Bootstrap. Die isolierte Prüfung `bun run test:deployment` verwendet einen eigenen benannten Testdatenträger und synthetische App-/Worker-Einstiegspunkte. Sie führt keine Drizzle- oder Anwendungsmigration aus.
