use super::*;
use std::collections::BTreeSet;
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy)]
enum Outcome {
    Success,
    Error,
    Panic,
}

struct Job {
    id: usize,
    gate: Receiver<()>,
    entered: Sender<usize>,
    dropped: Sender<usize>,
    outcome: Outcome,
}

impl Drop for Job {
    fn drop(&mut self) {
        let _ = self.dropped.send(self.id);
    }
}

fn sync(job: Job) -> io::Result<()> {
    job.entered.send(job.id).unwrap();
    // Closing a test gate also releases the worker during assertion unwinding.
    let _ = job.gate.recv();
    match job.outcome {
        Outcome::Success => Ok(()),
        Outcome::Error => Err(io::ErrorKind::PermissionDenied.into()),
        Outcome::Panic => panic!("injected synchronization panic"),
    }
}

fn job(
    id: usize,
    entered: &Sender<usize>,
    dropped: &Sender<usize>,
    outcome: Outcome,
) -> (Job, Sender<()>) {
    let (release, gate) = channel();
    (
        Job {
            id,
            gate,
            entered: entered.clone(),
            dropped: dropped.clone(),
            outcome,
        },
        release,
    )
}

fn blocked_pool(outcome: Outcome) -> (FileSync<Job>, Vec<Sender<()>>, Receiver<usize>) {
    let mut pool = FileSync::new(sync).unwrap();
    let (entered, starts) = channel();
    let (dropped, drops) = channel();
    let gates = (0..WORKERS)
        .map(|id| {
            let (job, gate) = job(
                id,
                &entered,
                &dropped,
                if id == 0 { outcome } else { Outcome::Success },
            );
            pool.submit(job).unwrap();
            gate
        })
        .collect();
    let started: BTreeSet<_> = (0..WORKERS)
        .map(|_| starts.recv_timeout(TIMEOUT).unwrap())
        .collect();
    assert_eq!(started, (0..WORKERS).collect());
    assert!(drops.try_recv().is_err());
    (pool, gates, drops)
}

#[test]
fn four_jobs_run_in_parallel_and_the_fifth_waits_for_its_previous_lane() {
    let (mut pool, gates, drops) = blocked_pool(Outcome::Success);
    let (entered, starts) = channel();
    let (dropped, fifth_drop) = channel();
    let (fifth, release_fifth) = job(4, &entered, &dropped, Outcome::Success);
    let (attempt, attempted) = channel();
    let (submitted, received) = channel();
    let handle = std::thread::spawn(move || {
        attempt.send(()).unwrap();
        pool.submit(fifth).unwrap();
        submitted.send(()).unwrap();
        pool.finish()
    });
    attempted.recv_timeout(TIMEOUT).unwrap();
    assert!(received.try_recv().is_err());
    assert!(starts.try_recv().is_err());
    gates[1].send(()).unwrap();
    assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), 1);
    assert!(received.try_recv().is_err());
    assert!(starts.try_recv().is_err());
    gates[0].send(()).unwrap();
    assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), 0);
    assert_eq!(starts.recv_timeout(TIMEOUT).unwrap(), 4);
    received.recv_timeout(TIMEOUT).unwrap();
    assert!(drops.try_recv().is_err());
    assert!(fifth_drop.try_recv().is_err());
    release_fifth.send(()).unwrap();
    assert_eq!(fifth_drop.recv_timeout(TIMEOUT).unwrap(), 4);
    for (id, gate) in gates.iter().enumerate().skip(2) {
        gate.send(()).unwrap();
        assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), id);
    }
    handle.join().unwrap().unwrap();
}

#[test]
fn finish_waits_for_every_handle_and_empty_finish_succeeds() {
    FileSync::new(sync).unwrap().finish().unwrap();
    let (pool, gates, drops) = blocked_pool(Outcome::Success);
    let (finishing, started) = channel();
    let (finished, result) = channel();
    let handle = std::thread::spawn(move || {
        finishing.send(()).unwrap();
        finished.send(pool.finish()).unwrap();
    });
    started.recv_timeout(TIMEOUT).unwrap();
    for (id, gate) in gates.iter().enumerate() {
        assert!(result.try_recv().is_err());
        gate.send(()).unwrap();
        assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), id);
    }
    result.recv_timeout(TIMEOUT).unwrap().unwrap();
    handle.join().unwrap();
}

#[test]
fn sync_errors_and_worker_panics_still_wait_for_all_siblings() {
    for outcome in [Outcome::Error, Outcome::Panic] {
        let (pool, gates, drops) = blocked_pool(outcome);
        let (finished, result) = channel();
        let handle = std::thread::spawn(move || finished.send(pool.finish()).unwrap());
        gates[0].send(()).unwrap();
        assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), 0);
        for (id, gate) in gates.iter().enumerate().skip(1) {
            assert!(result.try_recv().is_err());
            gate.send(()).unwrap();
            assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), id);
        }
        assert!(result.recv_timeout(TIMEOUT).unwrap().is_err());
        handle.join().unwrap();
    }
}

fn return_early(pool: FileSync<Job>, reason: &str) -> Result<(), &str> {
    let _owned_pool = pool;
    Err(reason)
}

#[test]
fn drop_waits_on_error_cancellation_and_unwind() {
    for reason in ["error", "cancelled", "panic"] {
        let (pool, gates, drops) = blocked_pool(Outcome::Success);
        let (dropping, started) = channel();
        let (finished, result) = channel();
        let handle = std::thread::spawn(move || {
            dropping.send(()).unwrap();
            let failed = if reason == "panic" {
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                    let _owned_pool = pool;
                    panic!("injected extraction unwind");
                }))
                .is_err()
            } else {
                return_early(pool, reason).is_err()
            };
            finished.send(failed).unwrap();
        });
        started.recv_timeout(TIMEOUT).unwrap();
        for (id, gate) in gates.iter().enumerate() {
            assert!(result.try_recv().is_err());
            gate.send(()).unwrap();
            assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), id);
        }
        assert!(result.recv_timeout(TIMEOUT).unwrap());
        handle.join().unwrap();
    }
}

#[test]
fn submit_reports_missing_or_disconnected_input_and_drops_the_owned_job() {
    for missing in [false, true] {
        let mut pool = FileSync::<Job>::start_with(|_, input, _| {
            // Exit before submit to exercise the rendezvous send failure.
            drop(input);
            Builder::new().spawn(|| {})
        })
        .unwrap();
        if missing {
            pool.lanes[0].input.take();
        }
        let (entered, starts) = channel();
        let (dropped, drops) = channel();
        let (job, _release) = job(0, &entered, &dropped, Outcome::Success);
        assert!(pool.submit(job).is_err());
        assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), 0);
        assert!(starts.try_recv().is_err());
        assert!(!pool.lanes[0].pending);
        pool.finish().unwrap();
    }
}

#[test]
fn disconnected_results_fail_without_a_second_receive_during_drop() {
    let mut pool = FileSync::<Job>::start_with(|_, input, result| {
        Builder::new().spawn(move || {
            drop(result);
            // Receive the job but exit without acknowledging it.
            if let Ok(job) = input.recv() {
                drop(job);
            }
        })
    })
    .unwrap();
    let (entered, _starts) = channel();
    let (dropped, drops) = channel();
    let (job, _release) = job(0, &entered, &dropped, Outcome::Success);
    pool.submit(job).unwrap();
    assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), 0);
    assert!(pool.lanes[0].complete().is_err());
    assert!(!pool.lanes[0].pending);
    pool.finish().unwrap();
}

#[test]
fn a_worker_exits_and_is_joined_when_its_result_receiver_is_gone() {
    let mut pool = FileSync::new(sync).unwrap();
    let (sender, receiver) = sync_channel(1);
    drop(sender);
    // Disconnect the real worker's output before its callback returns.
    pool.lanes[0].result = receiver;
    let (entered, starts) = channel();
    let (dropped, drops) = channel();
    let (job, release) = job(0, &entered, &dropped, Outcome::Success);
    pool.submit(job).unwrap();
    assert_eq!(starts.recv_timeout(TIMEOUT).unwrap(), 0);
    release.send(()).unwrap();
    assert_eq!(drops.recv_timeout(TIMEOUT).unwrap(), 0);
    assert!(pool.finish().is_err());
}

#[test]
fn partial_spawn_failure_closes_and_joins_all_previously_started_workers() {
    for fail_at in 0..WORKERS {
        let (exited, exits) = channel();
        let result = FileSync::<Job>::start_with(|index, input, _result| {
            if index == fail_at {
                return Err(io::ErrorKind::Other.into());
            }
            let exited = exited.clone();
            Builder::new().spawn(move || {
                assert!(input.recv().is_err());
                exited.send(index).unwrap();
            })
        });
        assert!(result.is_err());
        let joined: BTreeSet<_> = (0..fail_at).map(|_| exits.try_recv().unwrap()).collect();
        assert_eq!(joined, (0..fail_at).collect());
    }
}
