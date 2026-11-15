<p align="center">
    <img src="banner.png" alt="RentnerProxy Marketplace" width="800">
</p>

<div align="center">

[![CI: GitHub Actions](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?style=flat-square&logo=github&logoColor=white)](.github/workflows/ci.yml)
[![Security: Scans](https://img.shields.io/badge/Security-Scans-22C55E?style=flat-square)](.github/workflows/dependency-security.yml)
[![Release: Docker](https://img.shields.io/badge/Release-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)](.github/workflows/release.yml)

[![Bun 1.4.4](https://img.shields.io/badge/Bun-1.4.4-000000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![MIT License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)

</div>

# <!-- project:defaultName -->RentnerProxy Marketplace<!-- /project -->

The foundation of the official RentnerProxy Marketplace, built with TanStack Start, React, TypeScript, Tailwind CSS and a Rust core.

The first alpha provides a public preview of the planned official apps, their development and approval workflow, and a versioned blog. Public registration remains closed. App downloads, installation and submissions are not available yet; the first operator account uses the private initial-admin setup flow.

Project identity is configured in `web/src/config/app.config.ts` and synchronized with `bun run project:sync`. Volume names are derived from the last segment of `imageRepository`; keep that segment unchanged for existing installations.

## Requirements

- Bun 1.4.4 or later; the project version is declared in `package.json`. `bun run format` and `bun run format:check` use the native `bun fmt` formatter with the settings in `bunfig.toml`.
- Rust 1.100.0 with Cargo, rustfmt and Clippy for local development. The production image already includes the compiled core.
- PostgreSQL and Valkey, preferably current stable versions.
- PostgreSQL `pg_dump` and `pg_restore` tools matching the database major version for backups. They are included in the production image.
- SMTP access for system email.

## Local development

Start PostgreSQL and Valkey, then install the dependencies and create your local environment file:

```bash
bun install
cp .env.dev.example .env.local
```

Configure the database, Valkey, encryption key and SMTP settings in `.env.local`. Use `VALKEY_URL` with the `redis://` or `rediss://` protocol; set `VALKEY_PASSWORD` when cache authentication is enabled. Then run:

```bash
bun run db:migrate
bun run dev
```

The app runs at `http://localhost:3000`. On a fresh installation, the development processes print the private initial-admin setup link. You can also run `bun run setup:url` in a second terminal and open the generated link.

## Production deployment

Production requires Docker Compose, `docker-compose.yml` and `.env`. The complete image bundles the web server, worker, PostgreSQL 18 and Valkey. The current Compose file selects `ghcr.io/rentnerproxy/marketplace:v1.0.0-alpha.1`; the commands below apply after that verified release image has been published. Configure registry pull access if the image requires authentication.

Copy `.env.example` to `.env` and configure `ORIGIN`, the database password, encryption key and SMTP credentials. The application port and backup path already have defaults. Use `ORIGIN=https://market.rentner.dev` for the centrally hosted Marketplace. Generate `AUTH_ENCRYPTION_KEY` with `openssl rand -base64 32` and keep it unchanged across updates. The mail worker requires complete SMTP configuration even while public registration is disabled.

```bash
docker compose pull
docker compose up -d
docker compose logs -f marketplace
```

The <!-- project:applianceService -->`marketplace`<!-- /project --> service publishes only `${APP_PORT:-6600}`. Point an HTTPS reverse proxy at this port and set `ORIGIN` to its public address. PostgreSQL, Valkey and the process console listen only on loopback. Forwarded client-IP headers are ignored unless trust is configured; IP limits and logs use the direct peer otherwise.

The process manager starts PostgreSQL and Valkey first, waits for readiness, then starts the web server and worker. The existing application initialization applies pending migrations and synchronizes default permissions before the web server starts; the worker starts only after the app is ready. Health checks cover all four services. If a required process fails, the complete image exits with an error and Docker restarts it under `unless-stopped`. During shutdown, the web server and worker stop first, while PostgreSQL and Valkey remain available as jobs drain. The fixed `4h10m` stop grace period protects running backups and restores.

To create the first admin, open the latest complete setup link from the container logs in your browser. The link is valid for ten minutes and is renewed until the first user has been created. Setup links are no longer generated once an account exists.

The <!-- project:dataVolume -->`marketplace_data`<!-- /project --> volume contains PostgreSQL at `/data/postgresql/18/docker` and public/private application files under `/data/storage`. Backups live at `/data/backups`, mounted on the host through `BACKUP_PATH=./backups`. The container initializes only its fixed subdirectories; it does not recursively change permissions on existing files. The app and worker run as `bun` (UID 1000), while PostgreSQL and Valkey use their own users. `root` supervises startup and delegates services to those users. Keep an additional copy of the backup directory and encryption key outside the host.

For updates, retain `.env`, keys and volumes, verify a complete backup, select the intended verified image version, and run `docker compose pull && docker compose up -d`. Rolling back an image does not undo schema changes. PostgreSQL remains on major version 18; other major versions and incomplete data directories are rejected. Valkey is ephemeral: outstanding setup and verification flows restart after data loss, while queues and schedules are reconciled from durable application data. See [docker/README.md](docker/README.md) for operating and migration procedures.

## Manual development images

The [Dev Image workflow](.github/workflows/dev-image.yml) can be started manually on `main` in the official repository. It builds `linux/amd64` only and publishes `ghcr.io/rentnerproxy/marketplace:dev` plus a unique `dev-<12-character-commit>-<run-id>-<attempt>` tag. These are testing images, separate from Alpha, Beta and Stable releases. Starting this workflow publishes an image; merging a pull request does not start it.

The workflow runs the existing TypeScript, Rust and appliance CI, Bun/Cargo advisory audits, and the dev candidate's vulnerability, isolated lifecycle and native integration checks. A separate publisher verifies the sealed OCI archive and image identity, rescans its contents without executing the candidate, and copies the assessed digest without rebuilding. If `main` advances before publication, start a new run.

Publication uses the `container-publishing` environment, restricted to the `main` branch. The run retains `dependency-publish-evidence-<run-id>-<attempt>` for 30 days. Its `identity.json` and `assessment.json` identify the tested revision, immutable digest, actual platform and Marketplace checks. Only a completed `publication.json` confirms that both remote tags resolved to that digest. The workflow creates no Git tag or GitHub Release and does not deploy the Marketplace.

## Capabilities

- Public Marketplace preview, planned official apps and an interactive development workflow.
- Versioned blog with Alpha, Beta and Stable filters and bundled release posts.
- Login, logout and password reset; public self-registration remains disabled.
- Two-factor authentication, passkeys and trusted devices.
- Administrative user management, invitations and permissions.
- Admin dashboard with grouped service status and read-only live consoles for the web server, WebSocket server, worker, PostgreSQL, Valkey and Rust core.
- Automated backups and restoration.
- Audit logs, mail queue and background jobs.
- Realtime updates over WebSockets.
- Public/authentication navigation in English, German, Spanish, French, Italian, Portuguese, Dutch and Polish. Some inherited administration labels fall back to English; legal pages provide German/English content with English fallback.

Dashboard consoles retain up to 300 stdout/stderr lines and verified status checks per service, refreshing every two seconds. While the dashboard is open, verified state is logged immediately, on changes, and at least once per minute even if the service produces no output. The process manager exposes container output through an internal read-only loopback interface; no Docker socket or additional container is needed. Superuser checks, fixed service selection and redaction of known secret fields, setup tokens and sensitive PostgreSQL continuation lines remain in place. The bounded in-memory buffer resets on container restart. In development, the console displays local application and status events.

## Rust core

Short core operations use private reusable stdin/stdout workers, with at most four processes per executable and a bounded queue. Limits and allowed operations are defined in `web/src/config/core.config.ts`. Each operation rechecks its filesystem boundaries and has its own cancellation control.

Legacy background images use bounded binary responses of up to 8 MiB over the worker channel; reading and legacy migration remain in the Rust core. A `binaryResult` header contains the operation ID and exact byte count, followed by the unchanged file bytes. An empty file is distinct from a missing file (`null`). Only the complete payload confirms completion. Fragmented, contradictory or incomplete responses are rejected without automatic retries. Existing JSON/Base64 operations remain compatible.

Branding transfers the logo, small logo and favicon in one binary operation with three validated lengths: at most 8 MiB per variant and 24 MiB in total, within the shared pool memory limit. Rust validates every variant before publishing any file and uses the same protected staging flow as the JSON interface. The private worker extension is additive to protocol 1; web and core are built and delivered together.

The core deletes backup files through freshly opened, non-symlink-following directory handles, inode checks and directory synchronization. Retention groups catalog references to the same archive; SQL, permissions and auditing remain in TypeScript. An exclusive [PostgreSQL table lock](https://www.postgresql.org/docs/18/explicit-locking.html) protects reference checks against concurrent changes until commit. Each transaction deletes at most one physical file. A subsequent database commit failure cannot undo an already confirmed unlink. Incompletely confirmed deletion is never retried automatically. Private backup directories assume cooperating services running as the same operating-system user; the filesystem API cannot atomically combine inode comparison and unlink.

On Linux x64/arm64, Bun writes individual private files from 4 MiB up to the 8 MiB limit directly. Smaller files retain the measured faster core path; the threshold is configured in `web/src/config/private-storage.config.ts`. A descriptor adapter anchors every path operation to open directories through the real `/proc/self/fd`; symlink protection, private permissions, atomic replacement and file/directory synchronization remain intact. At most four direct writes run concurrently. Active and queued direct operations share limits of 32 jobs and 64 MiB including metadata, separate from the core pools. Inputs are copied before the first await and cleared after completion. Cancellation is cooperative before publication; running file I/O is fully awaited before returning and has no separately terminable process. On other platforms, or when procfs is unavailable before the first mutation, the Rust core handles the binary data. Errors after mutation begins are not retried.

Long operations, blocking locks and explicit process environments retain dedicated processes. The restore-journal session remains separate. Unsafe mutations are never retried automatically. During shutdown, Nitro and the background worker await direct writes before closing their core pools; short-lived Bun processes close core pools on natural exit.

When comparing performance with the historical TypeScript-only baseline (`8e81ff6`), account for different durability guarantees: that write path synchronized the file but not its destination directory after rename. The current implementation synchronizes both. Directory synchronization remains necessary because [file `fsync` does not automatically persist its directory entry](https://man7.org/linux/man-pages/man2/fsync.2.html), and is retained during performance optimization.

Large binary payloads are read directly into the clearable destination buffer when the read buffer is empty. Existing directories are opened without following symlinks and created only when absent. Archive extraction synchronizes written files with at most four concurrent threads, while at most one current payload file remains open. Every return path waits for all started synchronization work and closes its handles before callers clean up. Success still requires `sync_all` for every payload file and the final integrity, source-identity and cancellation checks.

`bun run core:format:check`, `bun run core:lint` and `bun run core:coverage` validate Rust, including its 90% coverage gate. `bun run test:core-integration` tests the actual web/core boundary. Rust tests live exclusively under `core/tests/`.

## Project structure

`web/` contains TypeScript source, public assets and the relocated Drizzle directory. `core/` contains Cargo and native programs for archives, storage, PostgreSQL tools and the appliance process manager. The manifest, Bun lockfile, web configuration and `drizzle.config.ts` remain at the root. Responsibilities, dependency decisions and verification commands are described in [core/README.md](core/README.md).

```text
web/src/features/<Area>/<Feature>/
├── Components/    # UI components
├── Types/         # Types and contracts
├── Hooks/         # use...Logic: state, handler, optional setter/refs/form/table
├── index.tsx      # Page
├── middleware.ts  # Validation, authorization and service delegation
└── validation.ts  # Zod validation
```

Create directories and files only when needed. Larger components keep their own hooks and types under `Components/<Name>/`. Views contain JSX, with logic in hooks. Backend logic lives in `web/src/server`, UI-free helpers in `web/src/lib`, shared UI in `web/src/shared`, and tests mirror those paths under `web/src/tests`. Public pages use `PublicLayout`; protected pages use `AuthenticatedLayout`. See `web/src/features/Admin/PermissionManagement` for an example.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) for development, verification, pull requests and general questions. Use the [bug and feature forms](https://github.com/RentnerProxy/marketplace/issues/new/choose) for actionable requests. Participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Report vulnerabilities privately through the route in [SECURITY.md](SECURITY.md). Do not include credentials, private setup links or production data in public reports.

## License

MIT
