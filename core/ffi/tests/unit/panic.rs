use super::*;

#[test]
fn contains_a_panic_and_reports_uncertain_completion() {
    let output = contain_panic(|| panic!("simulated failure after dispatch"));
    let metadata: serde_json::Value = serde_json::from_slice(output.json()).unwrap();
    assert_eq!(metadata["type"], "error");
    assert_eq!(metadata["error"]["code"], "CORE_OPERATION_UNCERTAIN");
}
