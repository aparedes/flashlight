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
use idevice::provider::UsbmuxdProvider;
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
        let provider = device.to_provider(addr, "flashlight-ios-profiler");

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

    /// Opens a fresh instruments connection. The DVT channel API borrows its
    /// RemoteServerClient mutably, so each concurrently-streaming service
    /// (sysmontap, graphics) gets its own connection.
    pub async fn remote_server(&mut self) -> Result<RemoteServer, IdeviceError> {
        match &mut self.tunnel {
            Some(tunnel) => tunnel.rsd.connect::<RemoteServer>(&mut tunnel.handle).await,
            None => RemoteServer::connect(&self.provider).await,
        }
    }
}
