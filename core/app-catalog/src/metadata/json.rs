use olpc_cjson::CanonicalFormatter;
use serde::Serialize;
use serde_json::Value;

use crate::{CatalogError, Result};

pub(crate) fn decode(bytes: &[u8]) -> Result<Value> {
    let value = marketplace_artifacts::parse_json(bytes)
        .map_err(|_| CatalogError::new("Invalid or ambiguous catalog JSON"))?;
    if !value.is_object() {
        return Err(CatalogError::new("Expected catalog JSON object"));
    }
    Ok(value)
}

pub(super) fn canonical(signed: &Value) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut serializer =
        serde_json::Serializer::with_formatter(&mut bytes, CanonicalFormatter::new());
    signed
        .serialize(&mut serializer)
        .map_err(|_| CatalogError::new("Invalid canonical TUF metadata"))?;
    Ok(bytes)
}
