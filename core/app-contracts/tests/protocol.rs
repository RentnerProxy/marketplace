use std::sync::LazyLock;

use rentnerproxy_app_contracts::{
    ContractError, HttpDescriptor, HttpMethod, HttpOperation, HttpRequestOptions, HttpSocket,
    ProtocolContracts,
};
use serde_json::{Value, json};

static CONTRACTS: LazyLock<ProtocolContracts> = LazyLock::new(|| ProtocolContracts::new().unwrap());
static HTTP_FIXTURES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../contracts/v1/http-fixtures.json")).unwrap()
});

#[test]
fn shared_protocol_fixtures_agree_with_the_typescript_contract() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../../contracts/v1/protocol-fixtures.json")).unwrap();
    let cases = fixtures["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        assert_eq!(
            CONTRACTS.validate(
                case["schema"].as_str().unwrap(),
                case.get("document").unwrap()
            ),
            expected_validation(case),
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

#[test]
fn bounds_the_depth_of_decoded_wire_json() {
    let mut document = serde_json::json!({});
    for _ in 1..rentnerproxy_app_contracts::MAX_JSON_DEPTH {
        document = serde_json::json!({"nested": document});
    }
    assert_eq!(CONTRACTS.validate("AppApiPayload", &document), Ok(()));
    assert_eq!(
        CONTRACTS.validate("AppApiPayload", &serde_json::json!({"nested": document})),
        Err(ContractError::InvalidShape)
    );
}

#[test]
fn generated_http_operations_match_openapi() {
    let document: Value =
        serde_json::from_str(include_str!("../../../contracts/v1/openapi.json")).unwrap();
    for (path, methods) in document["paths"].as_object().unwrap() {
        for (method, spec) in methods.as_object().unwrap() {
            let id = spec["operationId"].as_str().unwrap();
            let operation = HttpOperation::from_id(id).unwrap_or_else(|| panic!("{id}"));
            let descriptor = operation.descriptor();

            assert_eq!(operation.id(), id);
            assert_eq!(descriptor.path, path.as_str(), "{id}");
            assert_eq!(
                descriptor.method,
                match method.as_str() {
                    "get" => HttpMethod::Get,
                    "post" => HttpMethod::Post,
                    unknown => panic!("{id}: {unknown}"),
                },
                "{id}"
            );
            assert_eq!(
                descriptor.socket,
                match spec["x-rentnerproxy-socket"].as_str().unwrap() {
                    "app.sock" => HttpSocket::App,
                    "core.sock" => HttpSocket::Core,
                    unknown => panic!("{id}: {unknown}"),
                },
                "{id}"
            );
            let path_parameter = path
                .split_once('{')
                .and_then(|(_, suffix)| suffix.split_once('}'))
                .map(|(parameter, _)| parameter);
            assert_eq!(descriptor.path_parameter, path_parameter, "{id}");

            let parameters = spec["parameters"].as_array().unwrap();
            for (name, expected) in [
                ("IdempotencyKey", descriptor.idempotency_key),
                ("ResumeCursor", descriptor.resume_cursor),
            ] {
                let reference = format!("#/components/parameters/{name}");
                assert_eq!(
                    parameters
                        .iter()
                        .any(|parameter| parameter["$ref"] == reference),
                    expected,
                    "{id}: {name}"
                );
            }
            if let Some(name) = descriptor.path_parameter {
                let reference = format!("#/components/parameters/{name}");
                assert!(
                    parameters
                        .iter()
                        .any(|parameter| parameter["$ref"] == reference),
                    "{id}: {name}"
                );
                assert_eq!(
                    schema_name(&document["components"]["parameters"][name]["schema"]),
                    descriptor.path_parameter_schema(),
                    "{id}: {name}"
                );
            }

            let status = descriptor.success_status.to_string();
            let response = spec["responses"]
                .get(&status)
                .unwrap_or_else(|| panic!("{id}: {status}"));
            assert_eq!(
                schema_name(&spec["requestBody"]["content"]["application/json"]["schema"]),
                descriptor.request,
                "{id}"
            );
            assert_eq!(
                schema_name(&response["content"]["application/json"]["schema"]),
                descriptor.response,
                "{id}"
            );
            assert_eq!(
                schema_name(
                    &response["content"]["text/event-stream"]["x-rentnerproxy-event-data-schema"]
                ),
                descriptor.event,
                "{id}"
            );
        }
    }
    assert_eq!(HttpOperation::from_id("unknownOperation"), None);
}

#[test]
fn legacy_handoff_operations_address_one_provider_domain() {
    let status = Some("LegacyHandoffStatus");
    let expected = [
        HttpDescriptor {
            method: HttpMethod::Get,
            socket: HttpSocket::Core,
            path: "/platform/v1/legacy-handoffs/{domain}",
            path_parameter: Some("domain"),
            idempotency_key: false,
            resume_cursor: false,
            request: None,
            success_status: 200,
            response: status,
            event: None,
        },
        HttpDescriptor {
            method: HttpMethod::Post,
            socket: HttpSocket::Core,
            path: "/platform/v1/legacy-handoffs/{domain}/begin",
            path_parameter: Some("domain"),
            idempotency_key: true,
            resume_cursor: false,
            request: None,
            success_status: 200,
            response: status,
            event: None,
        },
        HttpDescriptor {
            method: HttpMethod::Post,
            socket: HttpSocket::Core,
            path: "/platform/v1/legacy-handoffs/{domain}/parts",
            path_parameter: Some("domain"),
            idempotency_key: false,
            resume_cursor: false,
            request: Some("LegacyHandoffPartRequest"),
            success_status: 200,
            response: Some("LegacyHandoffPart"),
            event: None,
        },
        HttpDescriptor {
            method: HttpMethod::Post,
            socket: HttpSocket::Core,
            path: "/platform/v1/legacy-handoffs/{domain}/commit",
            path_parameter: Some("domain"),
            idempotency_key: true,
            resume_cursor: false,
            request: Some("LegacyHandoffCommit"),
            success_status: 200,
            response: status,
            event: None,
        },
    ];
    let operations = [
        HttpOperation::GetLegacyHandoff,
        HttpOperation::BeginLegacyHandoff,
        HttpOperation::ReadLegacyHandoffPart,
        HttpOperation::CommitLegacyHandoff,
    ];
    for (operation, expected) in operations.into_iter().zip(expected) {
        assert_eq!(operation.descriptor(), expected, "{}", operation.id());
        assert_eq!(
            operation.descriptor().path_parameter_schema(),
            Some("LegacyHandoffDomain"),
            "{}",
            operation.id()
        );
    }
}

#[test]
fn legacy_handoff_domains_are_exactly_the_provider_profiles() {
    let schema: Value =
        serde_json::from_str(include_str!("../../../contracts/v1/contracts.schema.json")).unwrap();
    let domains = &schema["$defs"]["LegacyHandoffDomain"]["enum"];
    assert_eq!(
        domains,
        &schema["$defs"]["AppManifest"]["properties"]["providers"]["items"]["enum"]
    );
    for domain in domains.as_array().unwrap() {
        let domain = domain.as_str().unwrap();
        let options = HttpRequestOptions {
            path_value: Some(domain),
            ..HttpRequestOptions::default()
        };
        let request = CONTRACTS.prepare_http_request(HttpOperation::GetLegacyHandoff, options);
        assert_eq!(
            request.unwrap().path(),
            format!("/platform/v1/legacy-handoffs/{domain}")
        );
    }
}

#[test]
fn shared_http_requests_agree_with_the_typescript_contract() {
    let cases = http_cases("requests");
    for case in cases {
        let (operation, title) = http_operation(case);
        let options = &case["options"];
        let option_string = |key| options.get(key).map(|value| value.as_str().unwrap());
        let idempotency_key = option_string("idempotencyKey");
        let resume_cursor = option_string("resumeCursor");
        let body = options.get("body");
        let actual = CONTRACTS.prepare_http_request(
            operation,
            HttpRequestOptions {
                path_value: option_string("pathParameter"),
                idempotency_key,
                resume_cursor,
                body,
            },
        );
        let Some(expected) = case.get("expected") else {
            assert!(
                matches!(actual, Err(ContractError::InvalidShape)),
                "{title}"
            );
            continue;
        };
        let request = actual.unwrap_or_else(|error| panic!("{title}: {error}"));
        let method = match request.method() {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
        };
        let socket = match request.socket() {
            HttpSocket::App => "app.sock",
            HttpSocket::Core => "core.sock",
        };
        assert_eq!(method, expected["method"], "{title}");
        assert_eq!(socket, expected["socket"], "{title}");
        assert_eq!(request.path(), expected["path"], "{title}");
        let mut headers = request.headers();
        if let Some(key) = idempotency_key {
            assert_eq!(headers.next(), Some(("Idempotency-Key", key)), "{title}");
        }
        if let Some(cursor) = resume_cursor {
            assert_eq!(headers.next(), Some(("Last-Event-ID", cursor)), "{title}");
        }
        assert_eq!(headers.next(), None, "{title}");
        assert_eq!(request.body(), body, "{title}");
    }
}

#[test]
fn shared_http_responses_and_events_agree_with_the_typescript_contract() {
    for case in http_cases("responses") {
        let (operation, title) = http_operation(case);
        let status = u16::try_from(case["status"].as_u64().unwrap()).unwrap();
        assert_eq!(
            CONTRACTS.validate_http_response(operation, status, case.get("body")),
            expected_validation(case),
            "{title}"
        );
    }
    for case in http_cases("events") {
        let (operation, title) = http_operation(case);
        assert_eq!(
            CONTRACTS.validate_http_event(operation, case.get("body").unwrap()),
            expected_validation(case),
            "{title}"
        );
    }
}

#[test]
fn accepts_a_problem_status_written_with_a_decimal_point() {
    let problem = json!({
        "type": "urn:rentnerproxy:problem:unavailable",
        "title": "Unavailable",
        "status": 503.0,
        "code": "unavailable",
        "requestId": "request-1",
    });
    assert_eq!(
        CONTRACTS.validate_http_response(HttpOperation::GetAppReadiness, 503, Some(&problem)),
        Ok(())
    );
}

fn http_cases(kind: &str) -> &[Value] {
    let cases = HTTP_FIXTURES[kind].as_array().unwrap();
    assert!(!cases.is_empty());
    cases
}

fn http_operation(case: &Value) -> (HttpOperation, &str) {
    let title = case["title"].as_str().unwrap();
    let id = case["operation"].as_str().unwrap();
    let operation = HttpOperation::from_id(id).unwrap_or_else(|| panic!("{title}: {id}"));
    assert_eq!(operation.id(), id, "{title}");
    (operation, title)
}

fn expected_validation(case: &Value) -> Result<(), ContractError> {
    if case["valid"].as_bool().unwrap() {
        Ok(())
    } else {
        Err(ContractError::InvalidShape)
    }
}

fn schema_name(schema: &Value) -> Option<&str> {
    schema["$ref"]
        .as_str()?
        .strip_prefix("#/components/schemas/")
}
