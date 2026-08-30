//! The main polling loop: streams sysmontap (CPU/RAM/threads) and graphics
//! (CoreAnimation FPS) as two channels multiplexed over a SINGLE instruments
//! connection, and writes one NDJSON measure per sysmontap sample for the
//! target app.
//!
//! One connection is not just an optimization: on iOS 26 real devices,
//! opening several concurrent dtservicehub connections gets them closed by
//! the peer ("remote server connection closed"), so everything must share
//! one DTX connection — the same model pymobiledevice3 uses.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use idevice::dvt::application_listing::ApplicationListingClient;
use idevice::dvt::graphics::{GraphicsClient, GraphicsSample};
use idevice::dvt::message::Message;
use idevice::dvt::sysmontap::{SysmontapClient, SysmontapConfig};
use idevice::IdeviceError;
use plist::{Dictionary, Value};

use crate::connect::{Connection, RemoteServer};
use crate::error;
use crate::measure::{emit, MeasureLine, StatusLine};
use crate::sysmon::{
    executable_name_from_app, find_target, parse_processes, ProcessSample, PROC_ATTRS,
};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Extracts the Processes dictionary out of a raw sysmontap push, mirroring
/// SysmontapClient::next_sample (which we can't use directly because it
/// holds the whole connection mutably borrowed).
fn processes_from_message(msg: &Message) -> Option<&Dictionary> {
    let data = msg.data.as_ref()?;
    let rows: &[Value] = match data {
        Value::Array(arr) => arr,
        Value::Dictionary(_) => std::slice::from_ref(data),
        _ => return None,
    };
    rows.iter()
        .filter_map(|row| row.as_dictionary())
        .find_map(|dict| dict.get("Processes").and_then(|v| v.as_dictionary()))
}

/// Channel codes on the shared connection. make_channel allocates codes
/// deterministically starting at 1, bumping the counter on every attempt
/// (even a failed one), so the codes are known from our creation order.
struct Channels {
    sysmontap: i32,
    graphics: Option<i32>,
}

async fn resolve_executable_name(rs: &mut RemoteServer, bundle_id: &str) -> Option<String> {
    let mut listing = match ApplicationListingClient::new(rs).await {
        Ok(l) => l,
        Err(e) => {
            error::report(error::SERVICE_FAILED, format!("application listing: {e:?}"));
            return None;
        }
    };
    match listing.installed_applications().await {
        Ok(apps) => apps
            .iter()
            .find_map(|app| executable_name_from_app(app, bundle_id)),
        Err(e) => {
            error::report(error::SERVICE_FAILED, format!("application listing: {e:?}"));
            None
        }
    }
}

/// Creates and starts the sysmontap + graphics channels. Returns their codes.
/// `next_channel` must be the code make_channel will hand out next.
async fn start_taps(
    rs: &mut RemoteServer,
    interval_ms: u32,
    mut next_channel: i32,
) -> Result<Channels, IdeviceError> {
    let sysmontap = next_channel;
    next_channel += 1;
    {
        let mut client = SysmontapClient::new(rs).await?;
        client
            .set_config(&SysmontapConfig {
                interval_ms,
                process_attributes: PROC_ATTRS.iter().map(|s| s.to_string()).collect(),
                system_attributes: Vec::new(),
            })
            .await?;
        client.start().await?;
    }

    let graphics = match GraphicsClient::new(rs).await {
        Ok(mut client) => match client.start_sampling(0.0).await {
            Ok(()) => Some(next_channel),
            Err(e) => {
                error::report(error::SERVICE_FAILED, format!("graphics sampling: {e:?}"));
                None
            }
        },
        Err(e) => {
            // FPS is best-effort: measures still flow without it.
            error::report(error::SERVICE_FAILED, format!("graphics channel: {e:?}"));
            None
        }
    };

    Ok(Channels {
        sysmontap,
        graphics,
    })
}

pub async fn poll(
    conn: &mut Connection,
    bundle_id: &str,
    interval_ms: u32,
) -> Result<(), IdeviceError> {
    let mut rs = conn.remote_server().await?;

    // Channel 1: app listing, to resolve the app's executable name for
    // process matching. If anything here fails, the channel counter's state
    // is uncertain, so start over on a fresh connection where the streaming
    // channel codes are deterministic again.
    let executable_name = resolve_executable_name(&mut rs, bundle_id).await;
    let next_channel = if executable_name.is_some() {
        2
    } else {
        emit(&StatusLine {
            detail: Some(format!(
                "executable name for {bundle_id} not found; matching by bundle id"
            )),
            ..StatusLine::event("warning")
        });
        drop(rs);
        rs = conn.remote_server().await?;
        1
    };

    let channels = start_taps(&mut rs, interval_ms, next_channel).await?;

    emit(&StatusLine {
        detail: Some(format!(
            "polling {bundle_id} every {interval_ms}ms (tunnel: {}, fps: {})",
            if conn.uses_core_device_tunnel() {
                "CoreDevice"
            } else {
                "lockdown"
            },
            if channels.graphics.is_some() {
                "on"
            } else {
                "unavailable"
            },
        )),
        ..StatusLine::event("started")
    });

    let debug_raw = std::env::var("FLASHLIGHT_IOS_DEBUG").is_ok();
    let mut first_sample_dumped = false;
    let mut last_fps: Option<f64> = None;
    let mut graphics_alive = channels.graphics;
    let mut target_seen = false;

    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    let result = loop {
        // Wait for the next sysmontap push; it paces the loop at interval_ms.
        let sysmon_msg = tokio::select! {
            biased;
            _ = &mut shutdown => break Ok(()),
            read = tokio::time::timeout(
                Duration::from_millis(u64::from(interval_ms) * 4 + 2000),
                rs.read_message(channels.sysmontap),
            ) => match read {
                Ok(Ok(msg)) => Some(msg),
                Ok(Err(e)) => {
                    error::report(error::STREAM_ENDED, format!("sysmontap: {e:?}"));
                    break Err(e);
                }
                Err(_timeout) => None,
            },
        };

        // Drain any queued graphics frames so fps is fresh for this measure.
        while let Some(code) = graphics_alive {
            match tokio::time::timeout(Duration::from_millis(1), rs.read_message(code)).await {
                Ok(Ok(msg)) => {
                    if let Some(data) = msg.data {
                        if let Ok(sample) = GraphicsSample::from_plist(data) {
                            last_fps = Some(sample.fps);
                        }
                    }
                }
                Ok(Err(e)) => {
                    error::report(error::STREAM_ENDED, format!("graphics: {e:?}"));
                    last_fps = None;
                    graphics_alive = None;
                }
                Err(_empty) => break,
            }
        }

        let Some(msg) = sysmon_msg else { continue };
        let Some(processes) = processes_from_message(&msg) else {
            continue;
        };

        if debug_raw && !first_sample_dumped {
            first_sample_dumped = true;
            let raw = format!("{:?}", msg.data);
            eprintln!(
                "FLASHLIGHT_IOS_DEBUG first sysmontap sample: {}",
                &raw[..raw.len().min(4000)]
            );
        }

        let parsed: Vec<ProcessSample> = parse_processes(processes, &PROC_ATTRS);
        match find_target(&parsed, executable_name.as_deref(), bundle_id) {
            Some(process) => {
                if !target_seen {
                    target_seen = true;
                    emit(&StatusLine {
                        pid: Some(process.pid),
                        name: Some(&process.name),
                        ..StatusLine::event("target")
                    });
                }
                emit(&MeasureLine::new(now_ms(), process, last_fps));
            }
            None => {
                if target_seen {
                    target_seen = false;
                    emit(&StatusLine::event("targetLost"));
                }
            }
        }
    };

    // Best-effort tap teardown; the connection closes when rs drops.
    let _ = rs
        .call_method(
            channels.sysmontap,
            Some(Value::String("stop".into())),
            None,
            false,
        )
        .await;
    if let Some(code) = channels.graphics {
        let _ = rs
            .call_method(
                code,
                Some(Value::String("stopSampling".into())),
                None,
                false,
            )
            .await;
    }

    emit(&StatusLine::event("stopped"));
    result
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! {
            _ = ctrl_c => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = ctrl_c.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use idevice::dvt::message::{MessageHeader, PayloadHeader};

    fn message_with_data(data: Option<Value>) -> Message {
        Message::new(
            MessageHeader::new(0, 1, 1, 0, 1, false),
            PayloadHeader::method_invocation(),
            None,
            data,
        )
    }

    fn sample_row() -> Value {
        let mut processes = Dictionary::new();
        processes.insert("42".into(), Value::Array(vec![Value::Integer(42.into())]));
        let mut row = Dictionary::new();
        row.insert("Processes".into(), Value::Dictionary(processes));
        Value::Dictionary(row)
    }

    #[test]
    fn extracts_processes_from_array_of_rows() {
        let msg = message_with_data(Some(Value::Array(vec![
            Value::String("noise".into()),
            sample_row(),
        ])));
        let processes = processes_from_message(&msg).unwrap();
        assert!(processes.contains_key("42"));
    }

    #[test]
    fn extracts_processes_from_bare_dictionary() {
        let msg = message_with_data(Some(sample_row()));
        assert!(processes_from_message(&msg).is_some());
    }

    #[test]
    fn ignores_messages_without_processes() {
        assert!(processes_from_message(&message_with_data(None)).is_none());
        assert!(
            processes_from_message(&message_with_data(Some(Value::String("ack".into())))).is_none()
        );
    }
}
