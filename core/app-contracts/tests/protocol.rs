use std::sync::LazyLock;

use rentnerproxy_app_contracts::{ContractError, ProtocolContracts};
use serde_json::Value;

static CONTRACTS: LazyLock<ProtocolContracts> = LazyLock::new(|| ProtocolContracts::new().unwrap());

#[test]
fn shared_protocol_fixtures_agree_with_the_typescript_contract() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../../contracts/v1/protocol-fixtures.json")).unwrap();
    let cases = fixtures["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let expected = if case["valid"].as_bool().unwrap() {
            Ok(())
        } else {
            Err(ContractError::InvalidShape)
        };
        assert_eq!(
            CONTRACTS.validate(
                case["schema"].as_str().unwrap(),
                case.get("document").unwrap()
            ),
            expected,
            "{}",
            case["title"].as_str().unwrap()
        );
    }
}

#[test]
fn rejects_an_unknown_protocol_schema_name() {
    assert_eq!(
        CONTRACTS.validate("UnknownProtocolDocument", &Value::Null),
        Err(ContractError::InvalidShape)
    );
}
