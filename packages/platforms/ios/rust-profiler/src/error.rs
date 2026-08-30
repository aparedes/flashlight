use std::fmt::Display;

// Mirrors the Android profiler's CPP_ERROR_* convention: machine-matchable
// markers on stderr that the TypeScript side surfaces to the user.
pub const NO_DEVICE: &str = "NO_DEVICE";
pub const TUNNEL_FAILED: &str = "TUNNEL_FAILED";
pub const SERVICE_FAILED: &str = "SERVICE_FAILED";
pub const APP_NOT_FOUND: &str = "APP_NOT_FOUND";
pub const STREAM_ENDED: &str = "STREAM_ENDED";
pub const USAGE: &str = "USAGE";

pub fn report(code: &str, msg: impl Display) {
    eprintln!("IOS_PROFILER_ERROR_{code}: {msg}");
}

pub fn fail(code: &str, msg: impl Display) -> ! {
    report(code, msg);
    std::process::exit(1);
}
