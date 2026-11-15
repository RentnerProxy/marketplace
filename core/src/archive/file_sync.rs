//! Bounded durability work for already-written extraction handles. No paths
//! cross this boundary, and no worker may outlive its owning extraction.
use crate::protocol::{CoreError, CoreResult};
use std::io;
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::thread::{Builder, JoinHandle};

const WORKERS: usize = 4;

struct Lane<T> {
    input: Option<SyncSender<T>>,
    result: Receiver<io::Result<()>>,
    handle: JoinHandle<()>,
    pending: bool,
}

impl<T> Lane<T> {
    fn complete(&mut self) -> CoreResult<()> {
        if !self.pending {
            return Ok(());
        }
        // Clear even when receiving fails: teardown must not receive twice.
        self.pending = false;
        self.result.recv().map_err(|_| worker_error())??;
        Ok(())
    }
}

fn worker_error() -> CoreError {
    CoreError::new(
        "CORE_IO_ERROR",
        "Die Synchronisierung der extrahierten Dateien ist fehlgeschlagen.",
    )
}

pub(super) struct FileSync<T> {
    lanes: Vec<Lane<T>>,
    next: usize,
}

impl<T: Send + 'static> FileSync<T> {
    pub(super) fn new(
        sync: impl Fn(T) -> io::Result<()> + Clone + Send + 'static,
    ) -> CoreResult<Self> {
        Self::start_with(|index, input, result| {
            let sync = sync.clone();
            Builder::new()
                .name(format!("archive-sync-{index}"))
                .spawn(move || {
                    while let Ok(file) = input.recv() {
                        // The callback owns (and drops) the handle before its
                        // result is sent. One outstanding job per lane means
                        // this bounded result channel cannot block teardown.
                        if result.send(sync(file)).is_err() {
                            break;
                        }
                    }
                })
        })
    }

    fn start_with(
        mut spawn: impl FnMut(
            usize,
            Receiver<T>,
            SyncSender<io::Result<()>>,
        ) -> io::Result<JoinHandle<()>>,
    ) -> CoreResult<Self> {
        let mut pool = Self {
            lanes: Vec::with_capacity(WORKERS),
            next: 0,
        };
        for index in 0..WORKERS {
            let (sender, input) = sync_channel(0);
            let (result, receiver) = sync_channel(1);
            // On spawn failure the partially constructed pool's Drop joins
            // every worker already started; none is detached.
            let handle = spawn(index, input, result)?;
            pool.lanes.push(Lane {
                input: Some(sender),
                result: receiver,
                handle,
                pending: false,
            });
        }
        Ok(pool)
    }

    pub(super) fn submit(&mut self, file: T) -> CoreResult<()> {
        let lane = &mut self.lanes[self.next];
        lane.complete()?;
        lane.input
            .as_ref()
            .ok_or_else(worker_error)?
            .send(file)
            .map_err(|_| worker_error())?;
        lane.pending = true;
        self.next = (self.next + 1) % WORKERS;
        Ok(())
    }

    pub(super) fn finish(mut self) -> CoreResult<()> {
        self.drain()
    }
}

impl<T> FileSync<T> {
    fn drain(&mut self) -> CoreResult<()> {
        for lane in &mut self.lanes {
            lane.input.take();
        }
        let mut failure = None;
        for mut lane in self.lanes.drain(..) {
            if let Err(error) = lane.complete() {
                failure.get_or_insert(error);
            }
            if lane.handle.join().is_err() {
                failure.get_or_insert_with(worker_error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
}

impl<T> Drop for FileSync<T> {
    fn drop(&mut self) {
        // Early parser/write/cancellation errors still wait for all owned
        // files before caller cleanup. Success always calls finish explicitly.
        let _ = self.drain();
    }
}

#[cfg(test)]
#[path = "../../tests/unit/archive_file_sync.rs"]
mod tests;
