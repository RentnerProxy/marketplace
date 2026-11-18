pub mod dependency;
pub mod evidence;
pub mod package;
pub mod publication;
pub mod sandbox;
pub mod sbom;
pub mod smoke;
pub mod source;

use rentnerproxy_app_contracts::{CONTRACT_VERSION, ManifestEnvironment};

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
