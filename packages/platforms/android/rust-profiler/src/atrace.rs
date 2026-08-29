use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;

/// Lines read from the atrace pipe by the reader thread, drained by the
/// main thread on every measure.
static ATRACE_LINES: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

/// Run from the atrace reader thread.
fn add_atrace_line(line: Vec<u8>) {
    ATRACE_LINES.lock().unwrap().push(line);
}

/// Run from the main thread: print buffered lines and clear the buffer.
pub fn print_atrace_lines(out: &mut impl Write) {
    let mut lines = ATRACE_LINES.lock().unwrap();
    for line in lines.iter() {
        let _ = out.write_all(line);
        let _ = out.write_all(b"\n");
    }
    lines.clear();
}

/// Run from the main thread while waiting for the app to start.
pub fn clear_atrace_lines() {
    ATRACE_LINES.lock().unwrap().clear();
}

fn open_trace_stream() -> File {
    // Second path is an alternative location on certain devices
    let paths = [
        "/sys/kernel/debug/tracing/trace_pipe",
        "/sys/kernel/tracing/trace_pipe",
    ];

    for path in paths {
        if let Ok(file) = File::open(path) {
            return file;
        }
    }

    // TODO handle ATrace not available on OS
    // (mirrors the C++ profiler, which aborted the whole process here)
    eprintln!("Unable to find Atrace output file");
    std::process::exit(1);
}

/// Body of the atrace reader thread: block on the trace pipe and buffer
/// every line. `trace_pipe` is a stream, so reads block until data arrives.
pub fn read_atrace_thread() {
    let mut reader = BufReader::new(open_trace_stream());
    let mut line = Vec::new();

    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if line.last() == Some(&b'\n') {
                    line.pop();
                }
                add_atrace_line(line.clone());
            }
        }
    }
}
