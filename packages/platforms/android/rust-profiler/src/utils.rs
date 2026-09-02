use std::io::{self, Write};
use std::time::{SystemTime, UNIX_EPOCH};

/// Write `msg` followed by a newline, like the C++ `log()` helper did.
pub fn log(out: &mut impl Write, msg: &str) {
    let _ = out.write_all(msg.as_bytes());
    let _ = out.write_all(b"\n");
}

/// `Timestamp: <ms since epoch>` — parsed by `parseCppMeasure` on the
/// TypeScript side, so the label must not change.
pub fn log_timestamp(out: &mut impl Write) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let _ = writeln!(out, "Timestamp: {timestamp}");
}

/// Print the whole content of a file followed by a newline.
///
/// On failure, emit the `CPP_ERROR_CANNOT_OPEN_FILE` marker on stderr: the
/// TypeScript side matches on it to ignore threads that died mid-measure.
pub fn print_file(out: &mut impl Write, path: &str) {
    match std::fs::read(path) {
        Ok(content) => {
            let _ = out.write_all(&content);
            let _ = out.write_all(b"\n");
        }
        Err(_) => {
            eprintln!("CPP_ERROR_CANNOT_OPEN_FILE {path}");
        }
    }
}

/// Flush `out`, exiting quietly when the reader is gone.
///
/// Rust ignores SIGPIPE, so once `adb shell` (and the TypeScript side behind
/// it) has gone away every write fails with `BrokenPipe` instead of killing
/// us — and the poll loop would keep scanning /proc on the device forever.
/// Any other flush error is ignored, as before.
pub fn flush_or_exit(out: &mut impl Write) {
    if let Err(error) = out.flush() {
        if error.kind() == io::ErrorKind::BrokenPipe {
            std::process::exit(0);
        }
    }
}
