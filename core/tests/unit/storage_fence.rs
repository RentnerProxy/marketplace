use super::*;
use std::{cell::RefCell, fs};

type Hook = Box<dyn FnMut(&str) -> CoreResult<()>>;
thread_local! { static HOOK: RefCell<Option<Hook>> = RefCell::new(None); }
pub(super) fn hook(point: &str) -> CoreResult<()> {
    HOOK.with(|slot| match slot.borrow_mut().as_mut() {
        Some(callback) => callback(point),
        None => Ok(()),
    })
}
struct Reset;
impl Drop for Reset {
    fn drop(&mut self) {
        HOOK.with(|slot| *slot.borrow_mut() = None);
    }
}
fn inject(callback: impl FnMut(&str) -> CoreResult<()> + 'static) -> Reset {
    HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(callback)));
    Reset
}
fn fixture() -> (tempfile::TempDir, PathBuf) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("fence");
    (temporary, root)
}
fn run(request: Value) -> Value {
    execute_inner(&request, &OperationContext::cleanup()).unwrap()
}
fn shared(root: &Path) -> Value {
    run(json!({"operation":"fenceAdmitShared","rootDirectory":root}))
}
fn exclusive(root: &Path, try_only: bool) -> Value {
    run(json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":try_only}))
}
fn release(lease: &Value) {
    run(json!({"operation":"fenceRelease","lease":lease}));
}
fn path(lease: &Value) -> &Path {
    Path::new(lease["file"]["path"].as_str().unwrap())
}
fn error(request: Value) -> String {
    execute(&request, &OperationContext::cleanup())
        .unwrap_err()
        .code
}

#[test]
fn canonical_metadata_rejects_every_noncanonical_representation() {
    let valid = br#"{"version":1,"kind":"shared","owner":"00000000-0000-4000-8000-000000000001"}"#;
    assert!(parse_record(valid, SHARED).is_ok());
    for bytes in [b"{}".as_slice(), b"not-json", b"\xff", br#"{"version":1,"kind":"shared","owner":"invalid"}"#,
        br#"{"version":2,"kind":"shared","owner":"00000000-0000-4000-8000-000000000001"}"#,
        br#"{"kind":"shared","version":1,"owner":"00000000-0000-4000-8000-000000000001"}"#,
        br#"{"version":1,"kind":"shared","owner":"00000000-0000-4000-8000-000000000001","extra":true}"#] {
        assert!(parse_record(bytes, SHARED).is_err());
    }
    assert!(parse_record(valid, "exclusive").is_err());
    for owner in [
        "00000000-0000-1000-8000-000000000001",
        "00000000-0000-4000-0000-000000000001",
        "00000000-0000-4000-8000-00000000000A",
        "urn:uuid:00000000-0000-4000-8000-000000000001",
    ] {
        assert!(!owner_valid(owner));
    }
}

#[test]
fn shared_reuse_revalidates_ownership_without_publishing_or_syncing_a_gate() {
    let (_temporary, root) = fixture();
    let lease = shared(&root);
    let revalidate =
        json!({"operation":"fenceAdmitShared","rootDirectory":root,"currentLease":lease});
    let guard = inject(|point| {
        assert!(!matches!(
            point,
            "beforeCreate" | "write" | "fileSync" | "directorySync" | "gateUnlink" | "gateRemove"
        ));
        Ok(())
    });
    assert_eq!(run(revalidate.clone()), lease);
    drop(guard);
    let admission = root.join(ADMISSION);
    let fence = Fence::open(&root, Some(&lease["context"])).unwrap();
    files::create_directory(&fence.root.handle, Path::new(ADMISSION)).unwrap();
    assert_eq!(error(revalidate.clone()), "STORAGE_MUTATION_ADMISSION_BUSY");
    fs::remove_dir(admission).unwrap();
    fs::remove_file(path(&lease)).unwrap();
    assert_eq!(error(revalidate), "STORAGE_MUTATION_FENCE_UNAVAILABLE");
}

#[test]
fn only_disappearance_of_the_admission_entry_is_retryable() {
    let missing = || std::io::Error::from(std::io::ErrorKind::NotFound);
    assert_eq!(
        assert_entry_type(ADMISSION, Err(missing()))
            .unwrap_err()
            .code,
        "STORAGE_MUTATION_ADMISSION_BUSY"
    );
    assert_eq!(
        assert_entry_type(SHARED, Err(missing())).unwrap_err().code,
        "ENOENT"
    );
    assert_eq!(
        assert_entry_type(ADMISSION, Err(std::io::ErrorKind::PermissionDenied.into()))
            .unwrap_err()
            .code,
        "EACCES"
    );
}

#[test]
fn uncertain_publications_preserve_gate_and_any_created_lease() {
    for kind in [SHARED, "exclusive"] {
        for phase in [
            "write",
            "fileSync",
            "close",
            "directorySync",
            "gateUnlink",
            "gateRemove",
        ] {
            let (_temporary, root) = fixture();
            let phase = phase.to_owned();
            // Fault the lease publication, after admission was fully secured,
            // or fault the terminal gate cleanup itself.
            let mut creates = 0;
            let guard = inject(move |point| {
                if point == "beforeCreate" {
                    creates += 1;
                }
                if point == phase && (creates >= 2 || phase.starts_with("gate")) {
                    return Err(invalid());
                }
                Ok(())
            });
            let request = if kind == SHARED {
                json!({"operation":"fenceAdmitShared","rootDirectory":root})
            } else {
                json!({"operation":"fenceAcquireExclusive","rootDirectory":root,"tryOnly":false})
            };
            assert_eq!(error(request), "STORAGE_MUTATION_FENCE_UNAVAILABLE");
            drop(guard);
            assert!(root.join(ADMISSION).is_dir());
            assert!(exclusive(&root, true).is_null());
        }
    }
    for phase in ["write", "fileSync", "close", "directorySync"] {
        let (_temporary, root) = fixture();
        let guard = inject(move |point| {
            if point == phase {
                Err(invalid())
            } else {
                Ok(())
            }
        });
        assert_eq!(
            error(json!({"operation":"fenceAdmitShared","rootDirectory":root})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
        drop(guard);
        assert!(root.join(ADMISSION).is_dir());
        assert!(exclusive(&root, true).is_null());
    }
}

#[test]
fn existing_owner_and_partial_bytes_are_never_cleaned_as_our_publication() {
    for replace in [false, true] {
        let (_temporary, root) = fixture();
        let target = root.join(ADMISSION).join(OWNER_FILE);
        let injected_target = target.clone();
        let guard = inject(move |point| {
            if point == if replace { "beforeCreate" } else { "fileSync" } {
                if replace {
                    fs::write(&injected_target, b"foreign owner").unwrap();
                } else {
                    fs::write(&injected_target, b"{").unwrap();
                }
                return if replace { Ok(()) } else { Err(invalid()) };
            }
            Ok(())
        });
        assert_eq!(
            error(json!({"operation":"fenceAdmitShared","rootDirectory":root})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
        drop(guard);
        assert_eq!(
            fs::read(target).unwrap(),
            if replace {
                b"foreign owner".as_slice()
            } else {
                b"{"
            }
        );
    }
}

#[test]
fn release_close_unlink_and_sync_errors_never_report_success() {
    for kind in [SHARED, "exclusive"] {
        for phase in ["close", "leaseUnlink", "directorySync"] {
            let (_temporary, root) = fixture();
            let lease = if kind == SHARED {
                shared(&root)
            } else {
                exclusive(&root, false)
            };
            let guard = inject(move |point| {
                if point == phase {
                    Err(invalid())
                } else {
                    Ok(())
                }
            });
            assert_eq!(
                error(json!({"operation":"fenceRelease","lease":lease})),
                "STORAGE_MUTATION_FENCE_UNAVAILABLE"
            );
            drop(guard);
            assert_eq!(path(&lease).exists(), phase != "directorySync");
        }
    }
}

#[test]
fn gate_disappearing_after_eexist_is_busy_without_takeover() {
    let (_temporary, root) = fixture();
    let lease = shared(&root);
    let gate = root.join(ADMISSION);
    fs::create_dir(&gate).unwrap();
    let guard = inject(move |point| {
        if point == "gateExists" {
            fs::remove_dir(&gate).unwrap();
        }
        Ok(())
    });
    assert_eq!(
        error(json!({"operation":"fenceAdmitShared","rootDirectory":root})),
        "STORAGE_MUTATION_ADMISSION_BUSY"
    );
    drop(guard);
    release(&lease);
    release(&shared(&root));
}

#[cfg(windows)]
#[test]
fn restored_mtime_and_identical_bytes_cannot_hide_a_windows_status_change() {
    let (_temporary, root) = fixture();
    let lease = shared(&root);
    let target = path(&lease).to_owned();
    let original = fs::read(&target).unwrap();
    let modified = fs::metadata(&target).unwrap().modified().unwrap();
    let mut injected = false;
    let guard = inject(move |point| {
        if point == "openedRead" && !injected {
            injected = true;
            let mut file = fs::OpenOptions::new().write(true).open(&target).unwrap();
            file.write_all(&original).unwrap();
            file.sync_all().unwrap();
            file.set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
        }
        Ok(())
    });
    assert_eq!(
        error(json!({"operation":"fenceRelease","lease":lease})),
        "STORAGE_MUTATION_FENCE_UNAVAILABLE"
    );
    drop(guard);
    assert!(path(&lease).exists());
    release(&lease);
}

#[cfg(unix)]
#[test]
fn unlinked_path_stat_is_ignorable_only_without_replacement() {
    for replace in [false, true] {
        let (_temporary, root) = fixture();
        let lease = shared(&root);
        let fence = Fence::open(&root, Some(&lease["context"])).unwrap();
        let target = path(&lease);
        let name = target.file_name().unwrap().to_str().unwrap();
        let opened = fence.shared.handle.open(name).unwrap();
        fs::remove_file(target).unwrap();
        // Linux path stat can resolve the inode before unlink, then collect
        // this same zero-link snapshot after unlink. Retain the descriptor
        // to reproduce that metadata deterministically at both path checks.
        let removed = opened.metadata().unwrap();
        assert_eq!(removed.nlink(), 0);
        if replace {
            fs::write(target, b"replacement").unwrap();
        }
        assert_eq!(
            check_unlinked(&fence.shared, name, &removed)
                .unwrap_err()
                .code,
            if replace { "STORAGE_INVALID" } else { "ENOENT" }
        );
        if replace {
            assert_eq!(fs::read(target).unwrap(), b"replacement");
        }
    }
}

#[cfg(unix)]
#[test]
fn unlinked_scan_descriptor_is_ignorable_only_without_replacement() {
    for replace in [false, true] {
        let (_temporary, root) = fixture();
        let lease = shared(&root);
        let owner = exclusive(&root, false);
        let target = path(&lease).to_owned();
        let bytes = fs::read(&target).unwrap();
        let mut reads = 0;
        let guard = inject(move |point| {
            if point == "openedRead" {
                reads += 1;
                if reads == 2 {
                    fs::remove_file(&target).unwrap();
                    if replace {
                        fs::write(&target, &bytes).unwrap();
                    }
                }
            }
            Ok(())
        });
        let result = execute(
            &json!({"operation":"fenceDrain","lease":owner}),
            &OperationContext::cleanup(),
        );
        assert_eq!(result.is_err(), replace);
        drop(guard);
        release(&owner);
    }
}

#[cfg(unix)]
#[test]
fn root_and_gate_replacements_fail_closed_with_pinned_handles() {
    for gate in [false, true] {
        let (temporary, root) = fixture();
        let moved = temporary.path().join("moved");
        let original = if gate {
            root.join(ADMISSION)
        } else {
            root.clone()
        };
        let mut once = false;
        let guard = inject(move |point| {
            if point == "beforeCreate" && !once {
                once = true;
                fs::rename(&original, &moved).unwrap();
                fs::create_dir(&original).unwrap();
                fs::write(original.join("sentinel"), b"keep").unwrap();
            }
            Ok(())
        });
        assert_eq!(
            error(json!({"operation":"fenceAdmitShared","rootDirectory":root})),
            "STORAGE_MUTATION_FENCE_UNAVAILABLE"
        );
        drop(guard);
        assert_eq!(
            fs::read(
                if gate {
                    root.join(ADMISSION)
                } else {
                    root.clone()
                }
                .join("sentinel")
            )
            .unwrap(),
            b"keep"
        );
    }
}
