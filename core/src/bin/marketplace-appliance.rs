fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "start".into());
    let code = match marketplace_core::appliance::run(&mode) {
        Ok(code) => code,
        Err(code) => {
            eprintln!("{code}");
            1
        }
    };
    std::process::exit(code);
}
