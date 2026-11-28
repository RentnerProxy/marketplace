# Rust core

The core handles technical work involving extensive filesystem, stream,
and process boundaries. TanStack, React, authentication, permissions,
the Drizzle schema, SQL transactions, queues, and application workflows remain
in `web/src`. The JavaScript manifest, lockfile, and web configuration live at the repository root.

## Responsibilities

| Previously in TypeScript | Now in Rust | TypeScript remains responsible for |
| --- | --- | --- |
| Archive encryption and integrity | Incremental AES-256-GCM, HKDF, HMAC, key and file validation | Authorization, key handoff, and download responses |
| TAR/PAX and archive validation | Bounded writing, parsing, manifest validation, safe paths, and extraction | Backup and restore jobs, progress display |
| Archive import and file collection | Quarantine, capacity reservations, file locks, background-image overlays | HTTP upload limits and application admission decisions |
| Private files and background images | Private directories, atomic publication, size limits, file identities, and legacy migration | User assignment, image processing with Sharp, and audit logging |
| Storage admission and file locks | Admission gate, shared and exclusive leases, ownership checks, release, and draining | SQL barriers, connection health, and request scope |
| Physical storage restoration | Preparation, persistent recovery journal, commit, and rollback | SQL barriers and the application restore workflow |
| Restore journal and persistent status | HKDF/HMAC chain, retained journal handle, bounded reads, and atomic status file | Application state decisions and progress display |
| Backup files and system branding | Root and path validation, bundled archive publication, and atomic publication of image variants | Authorization, SQL, audit logging, and image processing with Sharp |
| PostgreSQL tool processes | Version checks, bounded execution time, cancellation, private connection settings, and retained file handles | Database configuration, SQL, and permissions |
| Appliance process manager and process console | Process startup, readiness, orderly shutdown, role transitions, and bounded sanitized logs | Protected administrator dashboard and existing application initialization |

The library has three thin executables: `marketplace-archive`, `marketplace-storage`,
and `marketplace-appliance`. Archive and storage jobs use JSON over
stdin and bounded NDJSON responses containing progress, a result, or an error.
Arguments are passed without a shell. A private cancellation marker enables
cooperative cancellation on Windows as well. Unacknowledged mutations keep the
existing TypeScript storage barrier closed; a recovery result that has already
been acknowledged is preserved if cancellation arrives late.

Related file operations form one core job. Storage admission and release
each require one call; status files are written and synchronized in one
call. `backupPublishFile` combines file synchronization, renaming, and
directory synchronization. After publication may have occurred,
missing confirmation is treated as `CORE_OPERATION_UNCERTAIN`.

A restore opens `marketplace-storage journal-session` through private
stdin/stdout pipes. Rust retains the original file handle, directory identity,
expected canonical bytes, and derived key until completion has been verified.
Sequential `requestId` values correlate acknowledgments unambiguously;
missing, duplicate, or stale responses end the session without retrying a
mutation. The session is limited to 32 requests of 64 KiB each. The web side
also bounds the queue, response time, and total execution time. The key is
never passed in arguments or logs. The journal format and HKDF/HMAC remain
compatible with the independent Node reference fixtures.

Branding publishes all three prepared image variants in one job and replaces
each file atomically. The three file replacements do not form a single
filesystem transaction; Sharp, SQL, and audit logging remain in the existing
application workflow.

The appliance process exposes `/core/health` and read-only log snapshots over
loopback. The dashboard queries the actual process and provides an additional
Rust core card with a console. The console requires superuser privileges,
including in development. During development, `bun run dev` starts the core
in telemetry-only mode; it does not start a production database.

## Dependencies and runtime

- `std` handles processes, threads, streams, and native file locks. The core
  has no asynchronous Tokio server. An additional runtime would provide no
  concrete benefit for these bounded CLI jobs and the small loopback endpoint.
  Therefore, `ctrlc` and synchronous I/O remain suitable; `tokio::signal`,
  `tokio::fs`, `CancellationToken`, and `TaskTracker` would only be needed for
  an actual asynchronous service.
- Archive cryptography uses RustCrypto (`hkdf` 0.13, `hmac` 0.13,
  `sha2` 0.11) and `aead-gcm-stream` 0.4 with its compatible `aes` generation
  0.8. The existing single GCM tag and archive format remain compatible.
  Independent Node reference archives verify both directions. The core needs
  neither OpenSSL nor Perl; Rustls would not be a suitable file-cryptography API here.
- `fs2` is no longer used. Locks use `std::fs::File`; `fs4`, with only its
  `sync` feature enabled, provides cross-platform free-capacity queries.
- `time` standardizes time formats; `chrono` is no longer used. `base64` 0.23
  and `getrandom` 0.4 have been updated. `Serde`, `cap-std`, and `cap-fs-ext`
  remain for explicit contracts and handle-relative filesystem boundaries.
- App contracts, catalog verification and the package pipeline come from the
  published `rentnerproxy-app-contracts`, `rentnerproxy-app-catalog`,
  `rentnerproxy-app-pipeline` and `rentnerproxy-artifacts` crates of
  [RentnerProxy/app-sdk](https://github.com/RentnerProxy/app-sdk).
  `app-catalog` and `app-pipeline` contain only the `marketplace-app-catalog`,
  `marketplace-app-pipeline` and `candidate-smoke` executables.
- PostgreSQL receives no credentials through process arguments. Private
  service files and `PGPASSWORD` carry connection settings; a constant
  `--dbname` argument forces `pg_restore` to perform a direct restore.
  Raw tool stderr is not exposed to the web interface.

## Verification

All Rust test implementations and helpers live under `core/tests/`.
Public integration suites live directly in that directory; tests of private
functions live under `core/tests/unit/`. Only conditional module references
remain in `core/src/`; production files contain no embedded test functions.

Rust 1.100.0 is pinned in `rust-toolchain.toml`. Commands run from the repository
root select this toolchain even if a different default version is active locally.
Local coverage additionally requires `cargo-llvm-cov` and the Rust component
`llvm-tools-preview`; GitHub CI installs the required coverage tools.

```bash
bun run core:build
bun run core:format:check
bun run core:lint
bun run core:test
bun run core:coverage
bun run test
bun run test:core-integration
```

Rust checks cover all targets and features; Clippy runs with
`-D warnings`. `core:coverage` and the GitHub CI Rust job enforce at least
90% line and function coverage. Local commands use the installed Cargo,
rustfmt, Clippy, and coverage tools with the pinned Rust toolchain.

The Dependency Security workflow also checks the resolved lockfile against
the current RustSec database using `cargo-audit` on pull requests, pushes to
`main`, and its scheduled security run. It installs a checksum-verified
`cargo-audit` binary; failure to fetch the advisory database fails the check.

Pure TypeScript tests run without native executables. Tests using actual Rust
processes are named `*.core.test.ts` and also run in the Docker target
`core-integration`, where the production executables are available. Isolated
appliance fixtures check startup, readiness, data retention, and shutdown
without application migrations. The Drizzle directory was moved unchanged
to `web/drizzle`; `drizzle.config.ts` remains at the repository root.
