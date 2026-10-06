//! Unix half of the sidecar containment story (SEC-12).
//!
//! Windows has the Job Object (`win.rs`, W-2): the kernel kills the engine
//! when the last job handle closes, however the shell died. This module is
//! the equivalent where Unix offers one, and the honest fallback where it
//! does not:
//!
//! * **Linux** — `PR_SET_PDEATHSIG`: the kernel delivers SIGKILL to the child
//!   the moment the thread that created it exits. Armed in the child between
//!   fork and exec (`pre_exec`), so it is in force before the engine runs a
//!   single instruction. Kernel-enforced: a SIGKILLed or segfaulted shell
//!   still takes its engine with it.
//! * **macOS** — no parent-death signal exists. Crash containment there is
//!   the engine's own parent watch (`xr serve --parent-pid <shell pid>`,
//!   `src/daemon/parent-watch.ts`): the engine polls once per second and
//!   stops itself when the shell is gone. The shell passes `--parent-pid` on
//!   every platform, so Linux and Windows get it as defence in depth.
//! * **clean shutdown (all Unix)** — `terminate_gracefully` sends SIGTERM
//!   first so the engine runs its own stop path (server close, trigger loop,
//!   observability flush), and escalates to SIGKILL only after a bounded
//!   grace. Previously the clean path was `Child::kill` = SIGKILL, i.e. every
//!   quit was a crash from the engine's point of view.
//!
//! Two invariants worth stating in code, not just in prose:
//!
//! 1. The death signal is bound to the **spawning thread**, not the process.
//!    `spawn_sidecar` therefore runs on the main thread (Tauri's `setup`
//!    hook), which lives exactly as long as the shell. Spawning from a
//!    thread-pool worker would kill the engine when that worker retired.
//!    The test `pdeathsig_is_bound_to_the_spawning_thread` pins this fact.
//! 2. There is a race between `fork` and `prctl`: if the parent dies in that
//!    window the signal is never delivered. The child re-checks `getppid()`
//!    after arming and refuses to exec if the parent is already gone.

#[cfg(target_os = "linux")]
pub fn arm_parent_death_signal(cmd: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;
    let parent = std::process::id() as libc::pid_t;
    // SAFETY: the closure runs in the child between fork and exec and calls
    // only async-signal-safe functions (prctl, getppid); it captures a plain
    // integer and allocates nothing.
    unsafe {
        cmd.pre_exec(move || {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong, 0, 0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            // Fork→prctl race: a parent that died in between will never
            // trigger the signal. Do not exec an orphan.
            if libc::getppid() != parent {
                return Err(std::io::Error::other("parent exited before the death signal was armed"));
            }
            Ok(())
        });
    }
}

/// SIGTERM, wait up to `grace`, then SIGKILL. Always reaps the child.
///
/// Returns `true` when the engine exited on its own within the grace period
/// (a real clean shutdown), `false` when it had to be killed.
pub fn terminate_gracefully(child: &mut std::process::Child, grace: std::time::Duration) -> bool {
    use std::time::Instant;
    let pid = child.id() as libc::pid_t;
    // SAFETY: plain syscall on a pid we own; the child is unreaped (we hold
    // the handle), so the pid cannot have been recycled.
    let sent = unsafe { libc::kill(pid, libc::SIGTERM) } == 0;
    if sent {
        let deadline = Instant::now() + grace;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) => {}
                Err(_) => break,
            }
            if Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    use std::os::unix::process::ExitStatusExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    fn wait_up_to(child: &mut std::process::Child, limit: Duration) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + limit;
        while Instant::now() < deadline {
            if let Ok(Some(status)) = child.try_wait() {
                return Some(status);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }

    fn sleeper(arm: bool) -> Command {
        let mut cmd = Command::new("sleep");
        cmd.arg("30").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(target_os = "linux")]
        if arm {
            arm_parent_death_signal(&mut cmd);
        }
        #[cfg(not(target_os = "linux"))]
        let _ = arm;
        cmd
    }

    /// The crash case, reproduced at its true granularity: the spawning
    /// thread dies (that is what the kernel watches) and the child must be
    /// SIGKILLed without anyone calling `kill`.
    #[cfg(target_os = "linux")]
    #[test]
    fn pdeathsig_is_bound_to_the_spawning_thread() {
        let handle = std::thread::spawn(|| sleeper(true).spawn().expect("spawn sleep"));
        let mut child = handle.join().expect("spawning thread finished");
        // The thread is gone. The kernel owes the child a SIGKILL.
        let status = wait_up_to(&mut child, Duration::from_secs(3)).expect("child must die when its spawning thread exits");
        assert_eq!(status.signal(), Some(libc::SIGKILL), "died by SIGKILL, not by exiting");
    }

    /// Control: without the death signal, the same child outlives the thread
    /// that spawned it — the orphan SEC-12 is about.
    #[test]
    fn control_without_pdeathsig_the_child_outlives_the_spawning_thread() {
        let handle = std::thread::spawn(|| sleeper(false).spawn().expect("spawn sleep"));
        let mut child = handle.join().expect("spawning thread finished");
        assert!(wait_up_to(&mut child, Duration::from_millis(300)).is_none(), "an unarmed child keeps running");
        let _ = child.kill();
        let _ = child.wait();
    }

    /// A cooperative engine stops on SIGTERM and is reported as clean.
    #[test]
    fn terminate_gracefully_lets_a_cooperative_child_exit_cleanly() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("trap 'exit 0' TERM; while :; do sleep 0.02; done")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sh");
        // Let the trap install before we signal.
        std::thread::sleep(Duration::from_millis(150));
        let clean = terminate_gracefully(&mut child, Duration::from_secs(3));
        assert!(clean, "the child exited on SIGTERM within the grace period");
    }

    /// A stuck engine is still gone after the grace period, and the call
    /// reports that it had to be killed.
    #[test]
    fn terminate_gracefully_escalates_to_sigkill_after_the_grace_period() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 0.02; done")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sh");
        std::thread::sleep(Duration::from_millis(150));
        let started = Instant::now();
        let clean = terminate_gracefully(&mut child, Duration::from_millis(400));
        assert!(!clean, "a child that ignores SIGTERM is reported as killed");
        assert!(started.elapsed() < Duration::from_secs(3), "escalation is bounded by the grace period");
        assert!(child.try_wait().map(|s| s.is_some()).unwrap_or(true), "the child is reaped");
    }
}
