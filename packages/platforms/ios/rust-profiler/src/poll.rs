//! The main polling loop: streams sysmontap (CPU/RAM/threads) and graphics
//! (CoreAnimation FPS) concurrently over separate instruments connections,
//! merges them, and writes one NDJSON measure per sysmontap sample for the
//! target app.

use std::time::{SystemTime, UNIX_EPOCH};

use idevice::dvt::application_listing::ApplicationListingClient;
use idevice::dvt::graphics::GraphicsClient;
use idevice::dvt::sysmontap::{SysmontapClient, SysmontapConfig, SysmontapSample};
use idevice::IdeviceError;
use tokio::sync::{mpsc, watch};

use crate::connect::Connection;
use crate::error;
use crate::measure::{emit, MeasureLine, StatusLine};
use crate::sysmon::{
    executable_name_from_app, find_target, parse_processes, ProcessSample, PROC_ATTRS,
};

enum Event {
    Sysmon(SysmontapSample),
    Fps(f64),
    SysmonEnded(Result<(), IdeviceError>),
    FpsEnded(Result<(), IdeviceError>),
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Resolves the app's executable name so sysmontap rows can be matched by
/// name (which survives app restarts). Failure is non-fatal: matching falls
/// back to the bundle id and its last component.
async fn resolve_executable_name(conn: &mut Connection, bundle_id: &str) -> Option<String> {
    let mut server = match conn.remote_server().await {
        Ok(s) => s,
        Err(e) => {
            error::report(error::SERVICE_FAILED, format!("application listing: {e:?}"));
            return None;
        }
    };
    let mut listing = match ApplicationListingClient::new(&mut server).await {
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

pub async fn poll(
    conn: &mut Connection,
    bundle_id: &str,
    interval_ms: u32,
) -> Result<(), IdeviceError> {
    let executable_name = resolve_executable_name(conn, bundle_id).await;
    if executable_name.is_none() {
        emit(&StatusLine {
            detail: Some(format!(
                "executable name for {bundle_id} not found; matching by bundle id"
            )),
            ..StatusLine::event("warning")
        });
    }

    let sysmon_server = conn.remote_server().await?;
    let graphics_server = conn.remote_server().await?;

    let (tx, mut rx) = mpsc::channel::<Event>(64);
    let (stop_tx, stop_rx) = watch::channel(false);

    let sysmon_tx = tx.clone();
    let mut sysmon_stop = stop_rx.clone();
    let sysmon_task = tokio::spawn(async move {
        let mut server = sysmon_server;
        let result = async {
            let mut client = SysmontapClient::new(&mut server).await?;
            client
                .set_config(&SysmontapConfig {
                    interval_ms,
                    process_attributes: PROC_ATTRS.iter().map(|s| s.to_string()).collect(),
                    system_attributes: Vec::new(),
                })
                .await?;
            client.start().await?;
            loop {
                tokio::select! {
                    sample = client.next_sample() => {
                        if sysmon_tx.send(Event::Sysmon(sample?)).await.is_err() {
                            break;
                        }
                    }
                    _ = sysmon_stop.changed() => {
                        let _ = client.stop().await;
                        break;
                    }
                }
            }
            Ok(())
        }
        .await;
        let _ = sysmon_tx.send(Event::SysmonEnded(result)).await;
    });

    let fps_tx = tx.clone();
    let mut fps_stop = stop_rx.clone();
    let graphics_task = tokio::spawn(async move {
        let mut server = graphics_server;
        let result = async {
            let mut client = GraphicsClient::new(&mut server).await?;
            client.start_sampling(0.0).await?;
            loop {
                tokio::select! {
                    sample = client.sample() => {
                        if fps_tx.send(Event::Fps(sample?.fps)).await.is_err() {
                            break;
                        }
                    }
                    _ = fps_stop.changed() => {
                        let _ = client.stop_sampling().await;
                        break;
                    }
                }
            }
            Ok(())
        }
        .await;
        let _ = fps_tx.send(Event::FpsEnded(result)).await;
    });
    drop(tx);

    emit(&StatusLine {
        detail: Some(format!(
            "polling {bundle_id} every {interval_ms}ms (tunnel: {})",
            if conn.uses_core_device_tunnel() {
                "CoreDevice"
            } else {
                "lockdown"
            }
        )),
        ..StatusLine::event("started")
    });

    let mut last_fps: Option<f64> = None;
    let mut target_seen = false;
    let mut exit: Result<(), IdeviceError> = Ok(());

    loop {
        tokio::select! {
            biased;
            _ = shutdown_signal() => {
                let _ = stop_tx.send(true);
                break;
            }
            event = rx.recv() => {
                let Some(event) = event else { break };
                match event {
                    Event::Fps(fps) => last_fps = Some(fps),
                    Event::Sysmon(sample) => {
                        let Some(processes) = &sample.processes else { continue };
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
                    }
                    Event::SysmonEnded(result) => {
                        // Sysmontap drives measure emission; its end ends the poll.
                        if let Err(e) = result {
                            error::report(error::STREAM_ENDED, format!("sysmontap: {e:?}"));
                            exit = Err(e);
                        }
                        let _ = stop_tx.send(true);
                        break;
                    }
                    Event::FpsEnded(result) => {
                        // FPS is best-effort: keep emitting measures without it.
                        if let Err(e) = result {
                            error::report(error::STREAM_ENDED, format!("graphics: {e:?}"));
                        }
                        last_fps = None;
                    }
                }
            }
        }
    }

    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        let _ = sysmon_task.await;
        let _ = graphics_task.await;
    })
    .await;

    emit(&StatusLine::event("stopped"));
    exit
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
