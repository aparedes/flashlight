//! NDJSON wire protocol written to stdout.
//!
//! One JSON object per line. `{"type":"measure",...}` lines carry a Measure
//! matching `@lantern/types` (cpu.perName/perCore, ram in MB, fps,
//! time in epoch ms). `{"type":"status",...}` lines carry lifecycle events.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::sysmon::ProcessSample;

#[derive(Debug, Serialize, PartialEq)]
pub struct CpuMeasure {
    #[serde(rename = "perName")]
    pub per_name: BTreeMap<String, f64>,
    #[serde(rename = "perCore")]
    pub per_core: BTreeMap<String, f64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "type", rename = "measure")]
pub struct MeasureLine {
    pub time: u64,
    pub cpu: CpuMeasure,
    pub ram: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(rename = "threadCount")]
    pub thread_count: u64,
    pub pid: u64,
}

impl MeasureLine {
    pub fn new(time_ms: u64, process: &ProcessSample, fps: Option<f64>) -> Self {
        let mut per_name = BTreeMap::new();
        // Sysmontap reports whole-process CPU only; per-thread breakdown is not
        // available from this service, so everything lands under "Total".
        per_name.insert("Total".to_string(), process.cpu_percent());
        Self {
            time: time_ms,
            cpu: CpuMeasure {
                per_name,
                per_core: BTreeMap::new(),
            },
            ram: process.ram_mb(),
            fps,
            thread_count: process.thread_count,
            pid: process.pid,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename = "status")]
pub struct StatusLine<'a> {
    pub event: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl<'a> StatusLine<'a> {
    pub fn event(event: &'a str) -> Self {
        Self {
            event,
            pid: None,
            name: None,
            detail: None,
        }
    }
}

pub fn emit(line: &impl Serialize) {
    // stdout is the wire; a serialization failure here is a programming error.
    println!(
        "{}",
        serde_json::to_string(line).expect("serialize NDJSON line")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ProcessSample {
        ProcessSample {
            pid: 42,
            name: "MyApp".into(),
            cpu_usage: 25.5,
            phys_footprint_bytes: 3.0 * 1024.0 * 1024.0,
            thread_count: 12,
        }
    }

    #[test]
    fn measure_line_matches_perf_profiler_types_shape() {
        let line = MeasureLine::new(1_700_000_000_000, &sample(), Some(59.5));
        let json = serde_json::to_value(&line).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "type": "measure",
                "time": 1_700_000_000_000u64,
                "cpu": { "perName": { "Total": 25.5 }, "perCore": {} },
                "ram": 3.0,
                "fps": 59.5,
                "threadCount": 12,
                "pid": 42,
            })
        );
    }

    #[test]
    fn fps_is_omitted_until_known() {
        let line = MeasureLine::new(1, &sample(), None);
        let json = serde_json::to_string(&line).unwrap();
        assert!(!json.contains("fps"));
    }

    #[test]
    fn status_line_omits_empty_fields() {
        let json = serde_json::to_string(&StatusLine::event("targetLost")).unwrap();
        assert_eq!(json, r#"{"type":"status","event":"targetLost"}"#);
    }
}
