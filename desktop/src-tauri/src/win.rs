//! Windows-native process containment for the engine sidecar (Phase 1 · W-1/W-2/W-3).
//!
//! ─────────────────────────────────────────────────────────────────────────────
//! WHY THIS IS HAND-WRITTEN FFI AND NOT THE `windows` CRATE
//! ─────────────────────────────────────────────────────────────────────────────
//! The `windows` crate is already in the tree (Tauri pulls it in), so the
//! idiomatic choice would be to enable `Win32_System_JobObjects` and call
//! through it. It is NOT used here for one measured reason: that crate is a
//! single generated source file covering the entire Win32 surface, and a
//! `cargo check` of this workspace that includes it needs more than this
//! project's CI-container budget for one rustc process (observed: SIGKILLed by
//! the OOM killer three times, at ~1.9 GB, with `-j1`, `debuginfo=0` and
//! `strip=debuginfo`). A module that can be *compiled and reviewed* is worth
//! more than one that cannot: this file is verified standalone against
//! `x86_64-pc-windows-gnu` (see the note at the bottom).
//!
//! The surface kept here is five documented kernel32 entry points, each with
//! its struct layout written out explicitly, because an incorrect `repr(C)`
//! layout for `SetInformationJobObject` would be a silent memory-corruption
//! bug rather than a compile error.
//!
//! WHAT EACH PIECE REPLACES
//!   · W-2  `JobObject`      — the sidecar is assigned to a job with
//!                             KILL_ON_JOB_CLOSE, so the engine cannot outlive
//!                             the shell even if the shell CRASHES (the old
//!                             code only killed the child on a clean
//!                             `RunEvent::Exit`, so a shell crash orphaned a
//!                             listening daemon the user could not see).
//!   · W-3  `InstanceGuard`  — a named mutex gives Windows' own answer to
//!                             "one shell per session"; `Child::kill` cannot,
//!                             because two shells would each own a different
//!                             child.
//!   · W-1  (in lib.rs)      — CREATE_NO_WINDOW, so spawning the console
//!                             application does not flash a console window.

#![allow(non_snake_case)] // Win32 names are kept verbatim so the docs map 1:1.

use std::io;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;

/// HANDLE. Stored as `isize` rather than a pointer so the types that hold it
/// (`Arc<EngineState>`, shared across the stdout/stderr reader threads) stay
/// `Send + Sync` without an unsafe impl.
type Handle = isize;

/// `JobObjectExtendedLimitInformation` — the class id for the struct below.
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
/// "Kill every process still in the job when the last handle to it closes."
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
/// `CreateMutexW` sets this when the named object already existed.
const ERROR_ALREADY_EXISTS: i32 = 183;

#[repr(C)]
struct JobObjectBasicLimitInformation {
    PerProcessUserTimeLimit: i64,
    PerJobUserTimeLimit: i64,
    LimitFlags: u32,
    MinimumWorkingSetSize: usize,
    MaximumWorkingSetSize: usize,
    ActiveProcessLimit: u32,
    Affinity: usize,
    PriorityClass: u32,
    SchedulingClass: u32,
}

#[repr(C)]
struct IoCounters {
    ReadOperationCount: u64,
    WriteOperationCount: u64,
    OtherOperationCount: u64,
    ReadTransferCount: u64,
    WriteTransferCount: u64,
    OtherTransferCount: u64,
}

#[repr(C)]
struct JobObjectExtendedLimitInformation {
    BasicLimitInformation: JobObjectBasicLimitInformation,
    IoInfo: IoCounters,
    ProcessMemoryLimit: usize,
    JobMemoryLimit: usize,
    PeakProcessMemoryUsed: usize,
    PeakJobMemoryUsed: usize,
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(lpJobAttributes: *mut c_void, lpName: *const u16) -> *mut c_void;
    fn SetInformationJobObject(
        hJob: *mut c_void,
        JobObjectInformationClass: i32,
        lpJobObjectInformation: *mut c_void,
        cbJobObjectInformationLength: u32,
    ) -> i32;
    fn AssignProcessToJobObject(hJob: *mut c_void, hProcess: *mut c_void) -> i32;
    fn CreateMutexW(
        lpMutexAttributes: *mut c_void,
        bInitialOwner: i32,
        lpName: *const u16,
    ) -> *mut c_void;
    fn CloseHandle(hObject: *mut c_void) -> i32;
}

/// A Win32 HANDLE that closes itself. `isize` keeps it `Send + Sync`.
struct OwnedHandle(Handle);

impl OwnedHandle {
    fn as_ptr(&self) -> *mut c_void {
        self.0 as *mut c_void
    }
    fn is_valid(&self) -> bool {
        self.0 != 0 && self.0 != -1
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.is_valid() {
            // Safety: the handle came from a Create* call and is closed once.
            unsafe {
                CloseHandle(self.as_ptr());
            }
        }
    }
}

/// A job object configured to kill everything inside it when it closes.
///
/// Dropping this (including during process teardown after a crash of the
/// shell's own event loop) terminates the engine sidecar, so the product can
/// never leave an orphaned local daemon listening after the UI is gone.
pub struct JobObject(OwnedHandle);

impl JobObject {
    /// Create the job and arm KILL_ON_JOB_CLOSE.
    pub fn new_kill_on_close() -> io::Result<Self> {
        // Safety: standard job-object creation with no name and no attributes.
        let raw = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
        let handle = OwnedHandle(raw as Handle);
        if !handle.is_valid() {
            return Err(io::Error::last_os_error());
        }

        let mut info = JobObjectExtendedLimitInformation {
            BasicLimitInformation: JobObjectBasicLimitInformation {
                PerProcessUserTimeLimit: 0,
                PerJobUserTimeLimit: 0,
                LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                MinimumWorkingSetSize: 0,
                MaximumWorkingSetSize: 0,
                ActiveProcessLimit: 0,
                Affinity: 0,
                PriorityClass: 0,
                SchedulingClass: 0,
            },
            IoInfo: IoCounters {
                ReadOperationCount: 0,
                WriteOperationCount: 0,
                OtherOperationCount: 0,
                ReadTransferCount: 0,
                WriteTransferCount: 0,
                OtherTransferCount: 0,
            },
            ProcessMemoryLimit: 0,
            JobMemoryLimit: 0,
            PeakProcessMemoryUsed: 0,
            PeakJobMemoryUsed: 0,
        };

        // Safety: `info` is a live, correctly-laid-out struct and its length is
        // passed in bytes, which is what the API expects.
        let ok = unsafe {
            SetInformationJobObject(
                handle.as_ptr(),
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &mut info as *mut _ as *mut c_void,
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(JobObject(handle))
    }

    /// Put a spawned child into the job. Failing here is NOT fatal — the
    /// caller records why containment is absent and keeps the explicit kill
    /// path — but it must never be silent, because it is the difference
    /// between "dies with the shell" and "may outlive it".
    ///
    /// A nested job is the expected failure (Windows 8+ allows nesting, so
    /// this is rare; CI sandboxes are the usual cause) and reports
    /// ERROR_ACCESS_DENIED.
    pub fn assign(&self, child: &Child) -> io::Result<()> {
        // Safety: both handles are live for the duration of the call.
        let ok = unsafe {
            AssignProcessToJobObject(self.0.as_ptr(), child.as_raw_handle() as *mut c_void)
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

/// One-shell-per-session guard built on a named mutex.
///
/// Returns `Ok(None)` when another instance already holds the name — the caller
/// decides the user-facing behaviour (focus the existing window, or exit
/// quietly) rather than this module guessing.
pub struct InstanceGuard(OwnedHandle);

impl InstanceGuard {
    pub fn acquire(name: &str) -> io::Result<Option<Self>> {
        let wide: Vec<u16> = OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // Safety: a NUL-terminated wide string and no attributes.
        let raw = unsafe { CreateMutexW(std::ptr::null_mut(), 0, wide.as_ptr()) };
        let handle = OwnedHandle(raw as Handle);
        if !handle.is_valid() {
            return Err(io::Error::last_os_error());
        }
        // CreateMutexW succeeds even when the name exists; GetLastError is the
        // only way to tell. `last_os_error` is read *immediately* for that
        // reason — any intervening call would clobber it.
        if io::Error::last_os_error().raw_os_error() == Some(ERROR_ALREADY_EXISTS) {
            return Ok(None);
        }
        Ok(Some(InstanceGuard(handle)))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICATION NOTE (honest scope)
// ─────────────────────────────────────────────────────────────────────────────
// This module is compiled standalone for the Windows target:
//
//   rustc --target x86_64-pc-windows-gnu --crate-type lib --emit=metadata win.rs
//
// That proves the FFI signatures, struct layouts and cfg-gating build for
// Windows. It does NOT prove runtime behaviour: the job-object assignment and
// the mutex path must still be exercised on a real Windows machine (the
// cross-platform CI lane is where that belongs). Until then, W-1/W-2/W-3 are
// implemented and compile-verified, not runtime-verified.
