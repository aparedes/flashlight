//! Parsing of sysmontap sample payloads into per-process stats.
//!
//! The device pushes a `Processes` dictionary keyed by pid. Each value is
//! either an array whose order matches the `procAttrs` we configured, or (on
//! some builds) a dictionary keyed by attribute name. Both shapes are handled.

use plist::{Dictionary, Value};

/// Attributes requested from sysmontap, in the order the device echoes them
/// back inside each process row.
pub const PROC_ATTRS: [&str; 5] = ["pid", "name", "cpuUsage", "physFootprint", "threadCount"];

#[derive(Debug, Clone, PartialEq)]
pub struct ProcessSample {
    pub pid: u64,
    pub name: String,
    /// Fraction of one core (1.0 = one full core), as reported by the device.
    pub cpu_usage: f64,
    pub phys_footprint_bytes: f64,
    pub thread_count: u64,
}

impl ProcessSample {
    pub fn cpu_percent(&self) -> f64 {
        self.cpu_usage * 100.0
    }

    pub fn ram_mb(&self) -> f64 {
        self.phys_footprint_bytes / (1024.0 * 1024.0)
    }
}

fn value_as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Real(f) => Some(*f),
        Value::Integer(i) => i
            .as_signed()
            .map(|i| i as f64)
            .or_else(|| i.as_unsigned().map(|u| u as f64)),
        _ => None,
    }
}

fn value_as_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Integer(i) => i
            .as_unsigned()
            .or_else(|| i.as_signed().and_then(|s| u64::try_from(s).ok())),
        Value::Real(f) if *f >= 0.0 => Some(*f as u64),
        _ => None,
    }
}

fn row_attr<'v, S: AsRef<str>>(row: &'v Value, attrs: &[S], attr: &str) -> Option<&'v Value> {
    match row {
        Value::Array(values) => {
            let index = attrs.iter().position(|a| a.as_ref() == attr)?;
            values.get(index)
        }
        Value::Dictionary(dict) => dict.get(attr),
        _ => None,
    }
}

fn parse_row<S: AsRef<str>>(pid_key: &str, row: &Value, attrs: &[S]) -> Option<ProcessSample> {
    let pid = row_attr(row, attrs, "pid")
        .and_then(value_as_u64)
        .or_else(|| pid_key.parse().ok())?;
    let name = row_attr(row, attrs, "name")
        .and_then(|v| v.as_string())
        .unwrap_or("")
        .to_string();
    Some(ProcessSample {
        pid,
        name,
        cpu_usage: row_attr(row, attrs, "cpuUsage")
            .and_then(value_as_f64)
            .unwrap_or(0.0),
        phys_footprint_bytes: row_attr(row, attrs, "physFootprint")
            .and_then(value_as_f64)
            .unwrap_or(0.0),
        thread_count: row_attr(row, attrs, "threadCount")
            .and_then(value_as_u64)
            .unwrap_or(0),
    })
}

pub fn parse_processes<S: AsRef<str>>(processes: &Dictionary, attrs: &[S]) -> Vec<ProcessSample> {
    processes
        .iter()
        .filter_map(|(pid_key, row)| parse_row(pid_key, row, attrs))
        .collect()
}

/// Picks the target app's process out of a sample. Matching by name (rather
/// than by a pid captured at startup) makes the poller self-heal across app
/// restarts: a relaunched app gets a new pid but keeps its executable name.
pub fn find_target<'p>(
    processes: &'p [ProcessSample],
    executable_name: Option<&str>,
    bundle_id: &str,
) -> Option<&'p ProcessSample> {
    processes.iter().find(|p| {
        executable_name.is_some_and(|exe| p.name == exe)
            || p.name == bundle_id
            || bundle_id
                .rsplit('.')
                .next()
                .is_some_and(|last| !last.is_empty() && p.name == last)
    })
}

/// Extracts the executable name for `bundle_id` from a DVT application-listing
/// row. Key names vary across iOS versions, so several candidates are tried.
pub fn executable_name_from_app(app: &Dictionary, bundle_id: &str) -> Option<String> {
    let listed_bundle_id = ["CFBundleIdentifier", "BundleIdentifier"]
        .iter()
        .find_map(|key| app.get(key).and_then(|v| v.as_string()))?;
    if listed_bundle_id != bundle_id {
        return None;
    }

    ["ExecutableName", "CFBundleExecutable"]
        .iter()
        .find_map(|key| app.get(key).and_then(|v| v.as_string()))
        .map(|s| s.to_string())
        .or_else(|| {
            // Fall back to the executable path's last component.
            ["ExecutablePath", "Path"].iter().find_map(|key| {
                app.get(key)
                    .and_then(|v| v.as_string())
                    .and_then(|p| p.rsplit('/').next())
                    .map(|s| s.to_string())
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn array_row(pid: i64, name: &str, cpu: f64, footprint: f64, threads: i64) -> Value {
        Value::Array(vec![
            Value::Integer(pid.into()),
            Value::String(name.into()),
            Value::Real(cpu),
            Value::Real(footprint),
            Value::Integer(threads.into()),
        ])
    }

    #[test]
    fn parses_array_rows_in_proc_attrs_order() {
        let mut processes = Dictionary::new();
        processes.insert("42".into(), array_row(42, "MyApp", 0.35, 104_857_600.0, 17));

        let parsed = parse_processes(&processes, &PROC_ATTRS);
        assert_eq!(
            parsed,
            vec![ProcessSample {
                pid: 42,
                name: "MyApp".into(),
                cpu_usage: 0.35,
                phys_footprint_bytes: 104_857_600.0,
                thread_count: 17,
            }]
        );
        assert!((parsed[0].cpu_percent() - 35.0).abs() < 1e-9);
        assert!((parsed[0].ram_mb() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn parses_dictionary_rows_and_integer_valued_reals() {
        let mut row = Dictionary::new();
        row.insert("pid".into(), Value::Integer(7.into()));
        row.insert("name".into(), Value::String("SpringBoard".into()));
        row.insert("cpuUsage".into(), Value::Integer(1.into()));
        row.insert("physFootprint".into(), Value::Integer(2_097_152.into()));
        row.insert("threadCount".into(), Value::Real(9.0));
        let mut processes = Dictionary::new();
        processes.insert("7".into(), Value::Dictionary(row));

        let parsed = parse_processes(&processes, &PROC_ATTRS);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].cpu_usage, 1.0);
        assert_eq!(parsed[0].ram_mb(), 2.0);
        assert_eq!(parsed[0].thread_count, 9);
    }

    #[test]
    fn falls_back_to_pid_key_and_skips_garbage_rows() {
        let mut processes = Dictionary::new();
        // Row without a pid attribute: pid comes from the dictionary key.
        processes.insert(
            "99".into(),
            Value::Dictionary({
                let mut d = Dictionary::new();
                d.insert("name".into(), Value::String("kernel_task".into()));
                d
            }),
        );
        processes.insert("bogus".into(), Value::String("not a row".into()));

        let parsed = parse_processes(&processes, &PROC_ATTRS);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].pid, 99);
        assert_eq!(parsed[0].cpu_usage, 0.0);
    }

    #[test]
    fn finds_target_by_executable_name_bundle_id_or_last_component() {
        let processes = vec![
            ProcessSample {
                pid: 1,
                name: "MyApp".into(),
                cpu_usage: 0.0,
                phys_footprint_bytes: 0.0,
                thread_count: 0,
            },
            ProcessSample {
                pid: 2,
                name: "com.example.other".into(),
                cpu_usage: 0.0,
                phys_footprint_bytes: 0.0,
                thread_count: 0,
            },
        ];

        assert_eq!(
            find_target(&processes, Some("MyApp"), "com.example.myapp")
                .unwrap()
                .pid,
            1
        );
        assert_eq!(
            find_target(&processes, None, "com.example.other")
                .unwrap()
                .pid,
            2
        );
        // Last bundle-id component matching, case-sensitive.
        assert!(find_target(&processes, None, "com.example.myapp").is_none());
        assert_eq!(
            find_target(&processes, None, "com.example.MyApp")
                .unwrap()
                .pid,
            1
        );
    }

    #[test]
    fn extracts_executable_name_across_key_variants() {
        let mut app = Dictionary::new();
        app.insert(
            "CFBundleIdentifier".into(),
            Value::String("com.x.app".into()),
        );
        app.insert("ExecutableName".into(), Value::String("XApp".into()));
        assert_eq!(
            executable_name_from_app(&app, "com.x.app"),
            Some("XApp".into())
        );
        assert_eq!(executable_name_from_app(&app, "com.other"), None);

        let mut app = Dictionary::new();
        app.insert("BundleIdentifier".into(), Value::String("com.x.app".into()));
        app.insert(
            "ExecutablePath".into(),
            Value::String("/private/var/containers/X.app/XBin".into()),
        );
        assert_eq!(
            executable_name_from_app(&app, "com.x.app"),
            Some("XBin".into())
        );
    }
}
