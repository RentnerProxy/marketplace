#[cfg(feature = "pipeline")]
pub mod dependency;
#[cfg(feature = "pipeline")]
pub mod evidence;
#[cfg(feature = "pipeline")]
pub mod package;
#[cfg(feature = "pipeline")]
pub mod publication;
#[cfg(feature = "pipeline")]
pub mod sandbox;
#[cfg(feature = "pipeline")]
pub mod sbom;
pub mod smoke;
#[cfg(feature = "pipeline")]
pub mod source;

#[cfg(feature = "pipeline")]
use rentnerproxy_app_contracts::{CONTRACT_VERSION, ManifestEnvironment};

#[cfg(feature = "pipeline")]
fn candidate_runtime(target: &str) -> ManifestEnvironment<'_> {
    ManifestEnvironment {
        target,
        runtime_profile: "rentnerproxy-linux-v1",
        platform_api: CONTRACT_VERSION,
        app_protocol: CONTRACT_VERSION,
        ui_bridge: Some(CONTRACT_VERSION),
        engine_capabilities: &["caddy.load-balancing.v1", "caddy.crowdsec.v1"],
    }
}
