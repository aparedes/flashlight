//! flashlight-ios-profiler: host-side performance profiler for iOS devices.
//!
//! Talks to a USB-connected iOS device through usbmuxd and the instruments
//! services (CoreDevice tunnel on iOS 17+, lockdown service before that) and
//! streams NDJSON measures to stdout. See README.md for the wire protocol.

mod connect;
mod convert;
mod error;
mod measure;
mod poll;
mod sysmon;

use idevice::dvt::application_listing::ApplicationListingClient;
use idevice::dvt::device_info::DeviceInfoClient;
use idevice::dvt::process_control::ProcessControlClient;
use plist::Value;

use crate::connect::Connection;
use crate::convert::plist_to_json;

const USAGE: &str = "\
flashlight-ios-profiler <command> [options]

Commands:
  devices                                   List connected iOS devices (JSON)
  apps       [--udid <udid>]                List installed apps (JSON)
  info       [--udid <udid>]                Device hardware information (JSON)
  launch     --bundle-id <id> [--udid ...]  Launch an app, print {\"pid\": n}
  kill       --bundle-id <id> | --pid <n>   Kill an app
  poll       --bundle-id <id> [--interval-ms <n=500>] [--udid ...]
                                            Stream NDJSON measures to stdout
";

#[derive(Default)]
struct Args {
    command: String,
    bundle_id: Option<String>,
    udid: Option<String>,
    pid: Option<u64>,
    interval_ms: u32,
}

fn parse_args() -> Args {
    let mut args = Args {
        interval_ms: 500,
        ..Args::default()
    };
    let mut iter = std::env::args().skip(1);
    args.command = iter.next().unwrap_or_default();

    while let Some(flag) = iter.next() {
        let mut value = |name: &str| {
            iter.next()
                .unwrap_or_else(|| error::fail(error::USAGE, format!("{name} requires a value")))
        };
        match flag.as_str() {
            "--bundle-id" => args.bundle_id = Some(value("--bundle-id")),
            "--udid" => args.udid = Some(value("--udid")),
            "--pid" => {
                args.pid = Some(
                    value("--pid")
                        .parse()
                        .unwrap_or_else(|_| error::fail(error::USAGE, "--pid must be a number")),
                )
            }
            "--interval-ms" => {
                args.interval_ms = value("--interval-ms")
                    .parse()
                    .unwrap_or_else(|_| error::fail(error::USAGE, "--interval-ms must be a number"))
            }
            other => error::fail(error::USAGE, format!("unknown flag {other}\n{USAGE}")),
        }
    }
    args
}

fn require_bundle_id(args: &Args) -> &str {
    args.bundle_id
        .as_deref()
        .unwrap_or_else(|| error::fail(error::USAGE, "--bundle-id is required"))
}

async fn open_connection(args: &Args) -> Connection {
    Connection::open(args.udid.as_deref())
        .await
        .unwrap_or_else(|e| {
            error::fail(
                error::NO_DEVICE,
                format!("could not connect to device: {e:?}"),
            )
        })
}

async fn cmd_devices() {
    let devices = connect::list_devices()
        .await
        .unwrap_or_else(|e| error::fail(error::NO_DEVICE, format!("usbmuxd: {e:?}")));
    let json: Vec<serde_json::Value> = devices
        .iter()
        .map(|d| {
            serde_json::json!({
                "udid": d.udid,
                "deviceId": d.device_id,
                "connectionType": format!("{:?}", d.connection_type),
            })
        })
        .collect();
    println!("{}", serde_json::to_string(&json).unwrap());
}

async fn cmd_apps(args: &Args) {
    let mut conn = open_connection(args).await;
    let mut server = conn
        .remote_server()
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("instruments: {e:?}")));
    let mut listing = ApplicationListingClient::new(&mut server)
        .await
        .unwrap_or_else(|e| {
            error::fail(error::SERVICE_FAILED, format!("application listing: {e:?}"))
        });
    let apps = listing.installed_applications().await.unwrap_or_else(|e| {
        error::fail(error::SERVICE_FAILED, format!("application listing: {e:?}"))
    });
    let json: Vec<serde_json::Value> = apps
        .iter()
        .map(|app| plist_to_json(&Value::Dictionary(app.clone())))
        .collect();
    println!("{}", serde_json::to_string(&json).unwrap());
}

async fn cmd_info(args: &Args) {
    let mut conn = open_connection(args).await;
    let mut server = conn
        .remote_server()
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("instruments: {e:?}")));
    let mut info = DeviceInfoClient::new(&mut server)
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("device info: {e:?}")));
    let hardware = info
        .hardware_information()
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("device info: {e:?}")));
    println!(
        "{}",
        serde_json::to_string(&plist_to_json(&Value::Dictionary(hardware))).unwrap()
    );
}

async fn cmd_launch(args: &Args) {
    let bundle_id = require_bundle_id(args);
    let mut conn = open_connection(args).await;
    let mut server = conn
        .remote_server()
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("instruments: {e:?}")));
    let mut control = ProcessControlClient::new(&mut server)
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("process control: {e:?}")));
    let pid = control
        .launch_app(bundle_id, None, None, false, false)
        .await
        .unwrap_or_else(|e| {
            error::fail(error::APP_NOT_FOUND, format!("launch {bundle_id}: {e:?}"))
        });
    println!("{}", serde_json::json!({ "pid": pid }));
}

async fn resolve_pid(conn: &mut Connection, bundle_id: &str) -> Option<u64> {
    let mut server = conn.remote_server().await.ok()?;
    let executable_name = {
        let mut listing = ApplicationListingClient::new(&mut server).await.ok()?;
        let apps = listing.installed_applications().await.ok()?;
        apps.iter()
            .find_map(|app| sysmon::executable_name_from_app(app, bundle_id))
    };
    let mut info = DeviceInfoClient::new(&mut server).await.ok()?;
    let processes = info.running_processes().await.ok()?;
    processes
        .iter()
        .find(|p| {
            executable_name.as_deref().is_some_and(|exe| p.name == exe)
                || p.name == bundle_id
                || p.real_app_name.ends_with(&format!("/{}", p.name))
                    && executable_name.is_none()
                    && bundle_id.rsplit('.').next().is_some_and(|c| p.name == c)
        })
        .map(|p| p.pid as u64)
}

async fn cmd_kill(args: &Args) {
    let mut conn = open_connection(args).await;
    let pid = match args.pid {
        Some(pid) => pid,
        None => {
            let bundle_id = require_bundle_id(args);
            resolve_pid(&mut conn, bundle_id).await.unwrap_or_else(|| {
                error::fail(error::APP_NOT_FOUND, format!("{bundle_id} is not running"))
            })
        }
    };
    let mut server = conn
        .remote_server()
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("instruments: {e:?}")));
    let mut control = ProcessControlClient::new(&mut server)
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("process control: {e:?}")));
    control
        .kill_app(pid)
        .await
        .unwrap_or_else(|e| error::fail(error::SERVICE_FAILED, format!("kill {pid}: {e:?}")));
    println!("{}", serde_json::json!({ "killed": pid }));
}

async fn cmd_poll(args: &Args) {
    let bundle_id = require_bundle_id(args);
    let mut conn = open_connection(args).await;
    if let Err(e) = poll::poll(&mut conn, bundle_id, args.interval_ms).await {
        error::fail(error::STREAM_ENDED, format!("{e:?}"));
    }
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    match args.command.as_str() {
        "devices" => cmd_devices().await,
        "apps" => cmd_apps(&args).await,
        "info" => cmd_info(&args).await,
        "launch" => cmd_launch(&args).await,
        "kill" => cmd_kill(&args).await,
        "poll" => cmd_poll(&args).await,
        _ => {
            eprint!("{USAGE}");
            std::process::exit(2);
        }
    }
}
