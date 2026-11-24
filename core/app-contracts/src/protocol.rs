use std::collections::{HashMap, hash_map::Entry};

use jsonschema::Validator;
use serde_json::{Number, Value};

use crate::validation::{array, string, unique_strings};
use crate::{ContractError, MAX_JSON_DEPTH, compile_schema, embedded_schema, validate_shape};

const DOCUMENTS: &str = "x-rentnerproxy-protocol-documents";
const MAX_JSON_NUMBER: f64 = 9_007_199_254_740_991.0;
/// Serialized size limit of a legacy handoff part.
const MAX_PART_BYTES: usize = 262_144;

/// UTF-8 length of the ECMAScript `JSON.stringify` form of decoded wire JSON.
fn json_text_len(value: &Value) -> usize {
    match value {
        Value::Null | Value::Bool(true) => 4,
        Value::Bool(false) => 5,
        Value::Number(number) => number_text_len(number),
        Value::String(text) => string_text_len(text),
        Value::Array(items) => {
            items.iter().map(json_text_len).sum::<usize>() + items.len().max(1) + 1
        }
        Value::Object(fields) => {
            let members = fields
                .iter()
                .map(|(key, value)| string_text_len(key) + 1 + json_text_len(value));
            members.sum::<usize>() + fields.len().max(1) + 1
        }
    }
}

fn string_text_len(text: &str) -> usize {
    let mut length = 2;
    for character in text.chars() {
        length += match character {
            '"' | '\\' | '\u{8}' | '\u{c}' | '\n' | '\r' | '\t' => 2,
            _ if character < ' ' => 6,
            _ => character.len_utf8(),
        };
    }
    length
}

/// ECMAScript `Number::toString` length for a number within the wire bound.
fn number_text_len(number: &Number) -> usize {
    let value = number.as_f64().unwrap_or_default();
    if value.fract() == 0.0 {
        return (value as i64).to_string().len();
    }
    let scientific = format!("{:e}", value.abs());
    let Some((mantissa, exponent)) = scientific.split_once('e') else {
        return scientific.len();
    };
    let digits = mantissa.len() - usize::from(mantissa.contains('.'));
    let point = exponent.parse::<i32>().unwrap_or_default() + 1;
    let length = match point {
        1..=21 => digits + 1,
        -5..=0 => digits + 2 + point.unsigned_abs() as usize,
        _ => {
            let exponent_digits = (point - 1).unsigned_abs().to_string().len();
            digits + usize::from(digits > 1) + 2 + exponent_digits
        }
    };
    length + usize::from(value < 0.0)
}

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
        if name == "LegacyHandoffPart" && json_text_len(&document["part"]) > MAX_PART_BYTES {
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
    fn measures_wire_json_like_json_stringify() {
        for (value, expected) in [
            (json!(0.5), 3),
            (json!(123.456), 7),
            (json!(0.000_001), 8),
            (json!(0.000_012_34), 10),
            (json!(1e-7), 4),
            (json!(1.5e-7), 6),
            (json!(1.5e-10), 7),
            (json!(-0.25), 5),
            (json!(3.0), 1),
            (json!(-0.0), 1),
            (json!(0.1 + 0.2), 19),
            (json!(9_007_199_254_740_991_u64), 16),
            (json!(-1234.5678), 10),
            (json!("\u{1}\u{1f}\u{7f}\"\\/\u{8}\u{c}\n\r\t\u{2028}\u{e4}\u{1f600}"), 39),
            (json!([]), 2),
            (json!({}), 2),
            (json!([null, true, false]), 17),
            (json!({"a": [1, {"b": "c"}]}), 19),
        ] {
            assert_eq!(json_text_len(&value), expected, "{value}");
        }
    }

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
