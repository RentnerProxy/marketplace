use std::collections::{HashMap, hash_map::Entry};

use jsonschema::Validator;
use serde_json::Value;

use crate::validation::{array, string, unique_strings};
use crate::{ContractError, MAX_JSON_DEPTH, compile_schema, embedded_schema, validate_shape};

const DOCUMENTS: &str = "x-rentnerproxy-protocol-documents";
const MAX_JSON_NUMBER: f64 = 9_007_199_254_740_991.0;

fn is_wire_json(value: &Value, depth: usize) -> bool {
    match value {
        Value::Number(number) => number
            .as_f64()
            .is_some_and(|value| value.abs() <= MAX_JSON_NUMBER),
        Value::Array(items) => {
            depth < MAX_JSON_DEPTH && items.iter().all(|item| is_wire_json(item, depth + 1))
        }
        Value::Object(fields) => {
            depth < MAX_JSON_DEPTH && fields.values().all(|value| is_wire_json(value, depth + 1))
        }
        _ => true,
    }
}

/// Offline validators for the app protocol document registry. Callers enforce
/// input byte limits, reject duplicate JSON members during decoding, and verify
/// authorization, peer identity, and runtime paths.
pub struct ProtocolContracts {
    documents: HashMap<String, Validator>,
}

impl ProtocolContracts {
    /// Compile the embedded protocol validators once for reuse.
    pub fn new() -> Result<Self, ContractError> {
        Self::from_schema(embedded_schema()?)
    }

    fn from_schema(mut schema: Value) -> Result<Self, ContractError> {
        let registry = schema
            .as_object_mut()
            .and_then(|object| object.remove(DOCUMENTS))
            .ok_or(ContractError::InvalidSchema)?;
        let names = registry
            .as_array()
            .filter(|names| !names.is_empty())
            .ok_or(ContractError::InvalidSchema)?;
        let mut documents = HashMap::with_capacity(names.len());
        for name in names {
            let name = name.as_str().ok_or(ContractError::InvalidSchema)?;
            if !name.as_bytes().split_first().is_some_and(|(first, rest)| {
                first.is_ascii_uppercase() && rest.iter().all(u8::is_ascii_alphanumeric)
            }) || schema["$defs"].get(name).is_none()
            {
                return Err(ContractError::InvalidSchema);
            }
            let Entry::Vacant(entry) = documents.entry(name.to_owned()) else {
                return Err(ContractError::InvalidSchema);
            };
            entry.insert(compile_schema(&mut schema, name)?);
        }
        Ok(Self { documents })
    }

    /// Validate a document by its registered protocol schema name.
    pub fn validate(&self, name: &str, document: &Value) -> Result<(), ContractError> {
        let validator = self
            .documents
            .get(name)
            .ok_or(ContractError::InvalidShape)?;
        if !is_wire_json(document, 0) {
            return Err(ContractError::InvalidShape);
        }
        validate_shape(validator, document)?;
        if name == "BootstrapDescriptor" && document["appCredential"] == document["coreCredential"]
        {
            return Err(ContractError::InvalidShape);
        }
        if name == "AppReadiness"
            && !unique_strings(
                array(&document["providers"])
                    .iter()
                    .map(|provider| string(&provider["id"])),
            )
        {
            return Err(ContractError::InvalidShape);
        }
        let problem = match name {
            "Problem" => Some(document),
            "Operation" if document["status"] == "failed" => Some(&document["problem"]),
            "ProviderResult"
                if document["profile"] == "dns"
                    && matches!(
                        document["payload"]["action"].as_str(),
                        Some("present" | "cleanup")
                    )
                    && document["payload"]["operation"]["status"] == "failed" =>
            {
                Some(&document["payload"]["operation"]["problem"])
            }
            "UiBridgeMessage"
                if document["type"] == "apiResult"
                    && document["result"]["ok"].as_bool() == Some(false) =>
            {
                Some(&document["result"]["problem"])
            }
            _ => None,
        };
        if let Some(problem) = problem
            && string(&problem["type"]).strip_prefix("urn:rentnerproxy:problem:")
                != Some(string(&problem["code"]))
        {
            return Err(ContractError::InvalidShape);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn validates_only_registered_schema_names() {
        let contracts = ProtocolContracts::from_schema(json!({
            "$defs": {"Document": {"type": "object"}, "Other": {"type": "object"}},
            DOCUMENTS: ["Document"]
        }))
        .unwrap();
        let document = json!({});
        assert_eq!(contracts.validate("Document", &document), Ok(()));
        assert_eq!(
            contracts.validate("Other", &document),
            Err(ContractError::InvalidShape)
        );
    }

    #[test]
    fn rejects_invalid_protocol_registries() {
        let schema = json!({"$defs": {"Document": {"type": "object"}}});
        assert!(matches!(
            ProtocolContracts::from_schema(schema.clone()),
            Err(ContractError::InvalidSchema)
        ));

        for registry in [
            json!("Document"),
            json!([]),
            json!([0]),
            json!([""]),
            json!(["document"]),
            json!(["Document/other"]),
            json!(["Unknown"]),
            json!(["Document", "Document"]),
        ] {
            let mut malformed = schema.clone();
            malformed[DOCUMENTS] = registry;
            assert!(matches!(
                ProtocolContracts::from_schema(malformed),
                Err(ContractError::InvalidSchema)
            ));
        }
    }
}
