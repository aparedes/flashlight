//! Connection bootstrap: usbmuxd discovery, then either the iOS 17+
//! CoreDevice tunnel (userspace TCP, no sudo, no TUN device) or the legacy
//! lockdown instruments service for iOS < 17.
//!
//! iOS 17+ path: usbmuxd -> lockdown -> CoreDeviceProxy -> CDTunnel handshake
//! -> jktcp userspace TCP stack over the tunnel's raw IPv6 packets -> RSD
//! handshake -> com.apple.instruments.dtservicehub.
//!
//! Requires the personalized Developer Disk Image to be mounted (Xcode and
//! devicectl do this automatically; `pymobiledevice3 mounter auto-mount` also
//! works). If dtservicehub is missing from RSD, that's the likely cause.

use idevice::dvt::remote_server::RemoteServerClient;
use idevice::provider::{IdeviceProvider, UsbmuxdProvider};
use idevice::services::lockdown::LockdownClient;
use idevice::services::rsd::RsdHandshake;
use idevice::tcp::handle::AdapterHandle;
use idevice::usbmuxd::{
    Connection as MuxConnection, UsbmuxdAddr, UsbmuxdConnection, UsbmuxdDevice,
};

use idevice::core_device_proxy::CoreDeviceProxy;
use idevice::{IdeviceError, IdeviceService, ReadWrite};

pub type RemoteServer = RemoteServerClient<Box<dyn ReadWrite>>;

pub struct Connection {
    provider: UsbmuxdProvider,
    tunnel: Option<Tunnel>,
}

struct Tunnel {
    handle: AdapterHandle,
    rsd: RsdHandshake,
}

pub async fn list_devices() -> Result<Vec<UsbmuxdDevice>, IdeviceError> {
    let mut mux = UsbmuxdConnection::default().await?;
    mux.get_devices().await
}

/// Lockdown values used to describe a device (model, OS, name). Best effort:
/// `None` when the device is not paired or lockdown is unreachable — `devices`
/// must still list the device.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeviceDescription {
    pub product_type: Option<String>,
    pub product_version: Option<String>,
    pub device_name: Option<String>,
}

/// Reads `ProductType` / `ProductVersion` / `DeviceName` over lockdown. Mirrors
/// `IdeviceService::connect`'s handshake (connect, pair, start a TLS session)
/// but stops before requesting a service, since we only need GetValue.
pub async fn describe_device(device: &UsbmuxdDevice) -> DeviceDescription {
    let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
    let provider = device.to_provider(addr, "lantern-ios-profiler");

    let Ok(mut lockdown) = LockdownClient::connect(&provider).await else {
        return DeviceDescription::default();
    };
    let Ok(pairing_file) = provider.get_pairing_file().await else {
        return DeviceDescription::default();
    };
    if lockdown.start_session(&pairing_file).await.is_err() {
        return DeviceDescription::default();
    }

    DeviceDescription {
        product_type: read_string(&mut lockdown, "ProductType").await,
        product_version: read_string(&mut lockdown, "ProductVersion").await,
        device_name: read_string(&mut lockdown, "DeviceName").await,
    }
}

async fn read_string(lockdown: &mut LockdownClient, key: &str) -> Option<String> {
    lockdown
        .get_value(Some(key), None)
        .await
        .ok()?
        .as_string()
        .map(str::to_string)
}

impl Connection {
    pub async fn open(udid: Option<&str>) -> Result<Self, IdeviceError> {
        let mut mux = UsbmuxdConnection::default().await?;
        let device = match udid {
            Some(udid) => mux.get_device(udid).await?,
            None => mux
                .get_devices()
                .await?
                .into_iter()
                // Prefer USB devices; network entries duplicate them.
                .find(|d| matches!(d.connection_type, MuxConnection::Usb))
                .ok_or(IdeviceError::DeviceNotFound)?,
        };
        let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
        let provider = device.to_provider(addr, "lantern-ios-profiler");

        let tunnel = match Self::open_tunnel(&provider).await {
            Ok(tunnel) => Some(tunnel),
            Err(e) => {
                // Pre-iOS 17 devices don't expose CoreDeviceProxy; fall back
                // to the lockdown instruments service lazily in remote_server.
                // On iOS 17+ this is a real failure the fallback won't fix, so
                // leave a marker the TypeScript side can surface.
                crate::error::report(
                    crate::error::TUNNEL_FAILED,
                    format!("CoreDevice tunnel unavailable, trying lockdown fallback: {e:?}"),
                );
                None
            }
        };

        Ok(Self { provider, tunnel })
    }

    async fn open_tunnel(provider: &UsbmuxdProvider) -> Result<Tunnel, IdeviceError> {
        let proxy = CoreDeviceProxy::connect(provider).await?;
        let rsd_port = proxy.tunnel_info().server_rsd_port;
        let adapter = proxy.create_software_tunnel()?;
        let mut handle = AdapterHandle::new(adapter);
        let stream = handle
            .connect(rsd_port)
            .await
            .map_err(IdeviceError::Socket)?;
        let rsd = RsdHandshake::new(stream).await?;
        Ok(Tunnel { handle, rsd })
    }

    pub fn uses_core_device_tunnel(&self) -> bool {
        self.tunnel.is_some()
    }

    /// Opens a fresh instruments connection and performs the DTX capability
    /// handshake. NOTE: iOS closes concurrent dtservicehub connections, so a
    /// command should open ONE connection and multiplex channels on it.
    pub async fn remote_server(&mut self) -> Result<RemoteServer, IdeviceError> {
        let mut server = match &mut self.tunnel {
            Some(tunnel) => {
                tunnel
                    .rsd
                    .connect::<RemoteServer>(&mut tunnel.handle)
                    .await?
            }
            None => RemoteServer::connect(&self.provider).await?,
        };
        publish_capabilities(&mut server).await?;
        Ok(server)
    }
}

/// Announces our DTX capabilities on the control channel, mirroring
/// pymobiledevice3's `DTXConnection._perform_handshake`. DTXBlockCompression=0
/// is load-bearing: without it the server compresses large payloads (the
/// first sysmontap sample, typically), which the idevice message parser
/// cannot decode — the reader task dies and every channel reports
/// "remote server connection closed".
async fn publish_capabilities(server: &mut RemoteServer) -> Result<(), IdeviceError> {
    let mut capabilities = plist::Dictionary::new();
    capabilities.insert(
        "com.apple.private.DTXBlockCompression".into(),
        plist::Value::Integer(0u64.into()),
    );
    capabilities.insert(
        "com.apple.private.DTXConnection".into(),
        plist::Value::Integer(1u64.into()),
    );
    server
        .call_method(
            0,
            Some(plist::Value::String(
                "_notifyOfPublishedCapabilities:".into(),
            )),
            Some(vec![idevice::dvt::message::AuxValue::archived_value(
                plist::Value::Dictionary(capabilities),
            )]),
            false,
        )
        .await
}
