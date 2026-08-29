mod atrace;
mod pidof;
mod utils;

use std::fmt;
use std::io::{BufWriter, Write};
use std::time::{Duration, Instant};

use atrace::{clear_atrace_lines, print_atrace_lines, read_atrace_thread};
use pidof::pid_of;
use utils::{log, log_timestamp, print_file};

/// The app's /proc/<pid>/task directory disappeared: the process is gone.
struct PidClosedError(String);

impl fmt::Display for PidClosedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Directory does not exist: {}", self.0)
    }
}

fn print_cpu_stats(out: &mut impl Write, pids: &[String]) -> Result<(), PidClosedError> {
    for pid in pids {
        let path = format!("/proc/{pid}/task");

        let entries = std::fs::read_dir(&path).map_err(|_| PidClosedError(path.clone()))?;

        for entry in entries.flatten() {
            let sub_process_path = entry.path().join("stat");
            print_file(out, &sub_process_path.to_string_lossy());
        }
    }
    Ok(())
}

fn print_memory_stats(out: &mut impl Write, pids: &[String]) {
    for pid in pids {
        let memory_file_path = format!("/proc/{pid}/statm");
        print_file(out, &memory_file_path);
    }
}

#[derive(Default)]
struct MeasureStats {
    total_duration_sum_ms: u128,
    measure_count: u128,
}

/// Emit one measure block. The exact layout (`=START MEASURE=`, `=SEPARATOR=`
/// sections, `Timestamp:` line, `=STOP MEASURE=`) is a wire protocol parsed
/// by `parseCppMeasure` and `executeLongRunningProcess` on the TypeScript
/// side — do not change it.
fn print_performance_measure(
    out: &mut impl Write,
    pids: &[String],
    stats: &mut MeasureStats,
) -> Result<u128, PidClosedError> {
    let start = Instant::now();

    let separator = "=SEPARATOR=";
    log(out, "=START MEASURE=");
    // Log the first pid as the main pid
    log(out, &pids[0]);
    log(out, separator);
    let cpu_result = print_cpu_stats(out, pids);
    let cpu_end = start.elapsed();
    // Flush partial output before bailing out, like the C++ version's
    // exception path did: the parser recovers via the last =START MEASURE=
    if let Err(error) = cpu_result {
        let _ = out.flush();
        return Err(error);
    }
    log(out, separator);
    print_memory_stats(out, pids);
    let memory_end = start.elapsed();
    log(out, separator);
    // TODO handle ATrace not available on OS
    print_atrace_lines(out);
    let atrace_end = start.elapsed();
    log(out, separator);

    log_timestamp(out);

    let total_duration = start.elapsed();

    let total_duration_ms = total_duration.as_millis();

    let _ = write!(out, "TOTAL EXEC TIME: {}|", total_duration_ms);
    let _ = write!(out, "CPU TIME: {}|", cpu_end.as_millis());
    let _ = write!(out, "MEMORY TIME: {}|", (memory_end - cpu_end).as_millis());
    let _ = writeln!(out, "ATRACE TIME: {}", (atrace_end - memory_end).as_millis());

    stats.measure_count += 1;
    stats.total_duration_sum_ms += total_duration_ms;

    log(out, separator);
    let _ = writeln!(
        out,
        "AVERAGE TOTAL EXEC TIME: {}",
        stats.total_duration_sum_ms / stats.measure_count
    );

    log(out, "=STOP MEASURE=");

    let _ = out.flush();

    Ok(total_duration_ms)
}

fn poll_performance_measures(out: &mut impl Write, bundle_id: &str, interval_ms: u128) {
    set_current_thread_name("FL-Main");

    // We read atrace lines before the app is started
    // since it can take a bit of time to start and clear the traceOutputPath
    // but we'll clear them out periodically while the app isn't started
    // TODO handle ATrace not available on OS
    // The thread is never joined: polling loops forever until killed
    std::thread::Builder::new()
        .name("FL-Atrace".into())
        .spawn(read_atrace_thread)
        .expect("failed to spawn atrace thread");

    // Unlike the C++ version, which recursed and spawned a fresh atrace
    // thread on every pid change, restart via a loop over the same thread.
    loop {
        log(out, "Waiting for process to start...");
        let _ = out.flush();

        let mut pids: Vec<String> = Vec::new();
        while pids.is_empty() {
            clear_atrace_lines();
            pids = pid_of(bundle_id);
            std::thread::sleep(Duration::from_millis(50));
        }

        let mut stats = MeasureStats::default();
        loop {
            match print_performance_measure(out, &pids, &mut stats) {
                Ok(duration_ms) => {
                    let remaining = interval_ms.saturating_sub(duration_ms);
                    std::thread::sleep(Duration::from_millis(remaining as u64));
                }
                Err(error) => {
                    // Marker matched by the TypeScript side to reset its
                    // aggregation state when the app process is replaced
                    eprintln!("CPP_ERROR_MAIN_PID_CLOSED {error}");
                    break;
                }
            }
        }
    }
}

fn set_current_thread_name(name: &str) {
    let mut bytes = name.as_bytes().to_vec();
    bytes.push(0);
    unsafe {
        libc::prctl(libc::PR_SET_NAME, bytes.as_ptr());
    }
}

fn print_cpu_clock_tick(out: &mut impl Write) {
    let _ = writeln!(out, "{}", unsafe { libc::sysconf(libc::_SC_CLK_TCK) });
}

fn print_ram_page_size(out: &mut impl Write) {
    let _ = writeln!(out, "{}", unsafe { libc::sysconf(libc::_SC_PAGESIZE) });
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());

    let usage = "Usage: BAMPerfProfiler pollPerformanceMeasures <bundleId> <intervalMs> | printPerformanceMeasure <pid> | printCpuClockTick | printRAMPageSize";

    let Some(method_name) = args.get(1) else {
        eprintln!("{usage}");
        std::process::exit(1);
    };

    match method_name.as_str() {
        "pollPerformanceMeasures" => {
            let (Some(bundle_id), Some(interval)) = (args.get(2), args.get(3)) else {
                eprintln!("{usage}");
                std::process::exit(1);
            };
            let interval_ms: u128 = interval.parse().unwrap_or_else(|_| {
                eprintln!("Invalid interval: {interval}");
                std::process::exit(1);
            });

            poll_performance_measures(&mut out, bundle_id, interval_ms);
        }
        "printPerformanceMeasure" => {
            let Some(pid) = args.get(2) else {
                eprintln!("{usage}");
                std::process::exit(1);
            };
            let pids = vec![pid.clone()];
            let mut stats = MeasureStats::default();
            if let Err(error) = print_performance_measure(&mut out, &pids, &mut stats) {
                eprintln!("CPP_ERROR_MAIN_PID_CLOSED {error}");
                drop(out);
                std::process::exit(1);
            }
        }
        "printCpuClockTick" => print_cpu_clock_tick(&mut out),
        "printRAMPageSize" => print_ram_page_size(&mut out),
        other => {
            log(&mut out, &format!("Unknown method name: {other}"));
            let _ = out.flush();
            std::process::exit(1);
        }
    }
}
