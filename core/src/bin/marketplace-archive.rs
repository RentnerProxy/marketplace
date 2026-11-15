fn main() {
    let mut arguments = std::env::args_os().skip(1);
    match (arguments.next(), arguments.next()) {
        (None, None) => marketplace_core::protocol::run_command(marketplace_core::archive::execute),
        (Some(mode), None) if mode == "worker" => {
            marketplace_core::protocol::run_worker(
                marketplace_core::archive::execute_worker,
                false,
            );
        }
        _ => {
            let _ = marketplace_core::protocol::emit(&serde_json::json!({
                "type": "error",
                "error": marketplace_core::protocol::CoreError::new(
                    "CORE_INVALID_OPERATION",
                    "Die Archivoperation ist ungültig.",
                ),
            }));
            std::process::exit(1);
        }
    }
}
