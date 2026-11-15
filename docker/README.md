# Operating the appliance

Production uses one image and one service. The native Rust process `marketplace-appliance` supervises PostgreSQL, Valkey, the Bun web server, and the Bun worker together. All standard configuration is listed in `.env.example`; the image supplies the database name, internal ports, file paths, Valkey access settings, and sender name. SMTP is still required for the mail queue. Required settings are checked before the database starts; application configuration validation and the existing schema bootstrap remain in the TypeScript application entrypoints. When empty, `MAIL_FROM` falls back to `SMTP_USER`.

## Data and backups

- `/data/postgresql/18/docker`: persistent PostgreSQL 18 cluster, readable only by the PostgreSQL user.
- `/data/storage/public` and `/data/storage/private`: application files, owned by UID 1000.
- `/data/backups`: encrypted application backups containing the database and, optionally, application files; the host path comes from `BACKUP_PATH`, with owner UID 1000 and mode 0700.
- `/run/marketplace`: temporary sockets and hashed Valkey ACL data; not persistent storage.

The integrated backup manager uses `pg_dump` and `pg_restore` from the same PostgreSQL major version. Regularly create a full backup including application files and verify it through the restore feature in a separate installation using the same `AUTH_ENCRYPTION_KEY`. Keep the key and an external backup copy off the host being protected. Copying a running PostgreSQL directory does not replace a consistent backup.

## Maintenance after startup failures

While the service is running, `docker compose exec marketplace appliance-psql` opens a database session using the configured credentials without exposing the password in command arguments. Use `-d postgres` to select the administrative database.

If the application does not start, first inspect `docker compose logs marketplace`. The `maintenance` mode starts only an existing PostgreSQL 18 cluster and the internal readiness check. It does not initialize a database, start the application, synchronize permissions, or run migrations. Stop every other container using this data volume first:

```bash
docker compose stop marketplace
docker compose run -d --no-deps --name rentnerproxy-marketplace-maintenance marketplace maintenance
docker exec -it rentnerproxy-marketplace-maintenance appliance-psql
# After maintenance, stop the container started specifically for this purpose:
docker stop --time 60 rentnerproxy-marketplace-maintenance
docker rm rentnerproxy-marketplace-maintenance
docker compose up -d
```

For maintenance with an earlier release, first select its exact compatible image in Compose. Never start two PostgreSQL servers against the same data directory. Maintenance mode also rejects an invalid or foreign cluster; it does not automatically replace, convert, or change ownership of that cluster. Investigate damaged data only from a protected copy and with the matching PostgreSQL version.

## Migrating from the previous Compose file

Existing database, application, and backup volumes are not automatically moved into `marketplace_data`. Before migrating, create a full encrypted application backup including file storage, save it outside the existing volumes, and verify a restore. Preserve `AUTH_ENCRYPTION_KEY`, database credentials, and SMTP configuration; replace `APP_ORIGIN` with `ORIGIN` and set `BACKUP_PATH` to the intended host path.

Then use the old Compose file to stop all existing services cleanly, retaining the old volumes for a possible rollback. Start the appliance with the new Compose file, create a temporary administrator through the setup link, and import the saved archive through the integrated restore feature. Verify users, permissions, and files afterward. Only then remove the old containers; never use `down --volumes` or volume pruning during this process. This migration is a planned backup and restore operation requiring a maintenance window, not a routine `pull && up` update.

## Updates and failure behavior

For routine updates, retain the same volumes and secrets. Let any running restores finish and create a verified backup first. `docker compose pull && docker compose up -d` replaces only the image. Use a specific release tag or digest for reproducible updates and rollbacks; `latest` is the moving stable channel. The central Compose file pins `v1.0.0-alpha.1`. Any rollback must remain compatible with the database schema and data format.

The `4h10m` stop grace period is an upper bound that protects the existing four-hour backup and restore deadline, not a fixed wait. With no active jobs, consumers exit without an additional grace period. The web server immediately forwards the stop signal to the internal application server. After HTTP and core operations drain, the application closes its queue producers and Valkey connections so open sockets and reconnect timers cannot keep the process alive. Active backup and restore processors and their native helpers may still finish; PostgreSQL and Valkey remain available until this drain completes. The appliance is expected to become unready (`unhealthy`) while stopping.

After the internal drain deadline, the process manager forces a stop; an explicit `docker kill`, a manual stop timeout that is too short, or a host failure can bypass this protection. PostgreSQL major upgrades require a separate upgrade plan, a verified backup, and a tested rollback path; this image remains on PostgreSQL 18.

The log console keeps at most 300 sanitized lines per service in memory for up to one hour. The actual container output includes the complete initial setup link. Configure Docker log rotation on the host through the Docker daemon configuration.

Rust telemetry, bound exclusively to `127.0.0.1:3004`, exposes `/core/health` with the version, PID, uptime, and status of the actual running core process. `/logs?service=core` returns sanitized supervisor history; the `webserver`, `worker`, `postgresql`, and `valkey` services remain available. `/health` checks the services actually required. During shutdown, PostgreSQL receives SIGINT for a fast, orderly shutdown after the web server and worker have finished draining.

For local development, `marketplace-appliance serve` starts only this loopback telemetry, without a database, initialization, or application bootstrap. The isolated `bun run test:deployment` check uses its own named test volume and synthetic application and worker entrypoints. It does not run Drizzle or application migrations.
