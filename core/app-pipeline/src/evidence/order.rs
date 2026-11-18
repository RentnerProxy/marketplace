use std::{collections::HashSet, fmt, io, sync::LazyLock};

use serde::{Deserialize, Deserializer, Serialize, Serializer, de, ser::SerializeMap};
use serde_json::{Number, Value};

// Candidate bytes historically follow the contract's field order, while Trivy
// extensions keep the order received from the scanner. Keep ordered decoding
// local so other crates retain their established serde_json map behavior.
#[derive(Clone, Debug)]
pub(crate) enum OrderedJson {
    Null,
    Bool(bool),
    Number(Number),
    String(String),
    Array(Vec<OrderedJson>),
    Object(Vec<(String, OrderedJson)>),
}

impl OrderedJson {
    pub(crate) fn parse(bytes: &[u8]) -> io::Result<Self> {
        let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
        Ok(serde_json::from_slice(bytes)?)
    }

    pub(crate) fn get(&self, name: &str) -> Option<&Self> {
        match self {
            Self::Object(entries) => entries
                .iter()
                .find_map(|(key, value)| (key == name).then_some(value)),
            _ => None,
        }
    }

    pub(crate) fn set(&mut self, name: &str, value: Self) {
        let Self::Object(entries) = self else {
            unreachable!("set requires an ordered object");
        };
        if let Some((_, existing)) = entries.iter_mut().find(|(key, _)| key == name) {
            *existing = value;
        } else {
            entries.push((name.to_owned(), value));
        }
    }

    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }

    pub(crate) fn prioritize_fields(&mut self, names: &[&str]) {
        let Self::Object(entries) = self else {
            unreachable!("prioritize_fields requires an ordered object");
        };
        let mut ordered = Vec::with_capacity(entries.len());
        for name in names {
            if let Some(index) = entries.iter().position(|(key, _)| key == name) {
                ordered.push(entries.remove(index));
            }
        }
        ordered.append(entries);
        *entries = ordered;
    }

    pub(crate) fn as_array(&self) -> Option<&[Self]> {
        match self {
            Self::Array(values) => Some(values),
            _ => None,
        }
    }

    pub(crate) fn as_integer(&self) -> Option<u64> {
        let Self::Number(value) = self else {
            return None;
        };
        value.as_u64()
    }

    pub(crate) fn is_object(&self) -> bool {
        matches!(self, Self::Object(_))
    }
}

impl From<&Value> for OrderedJson {
    fn from(value: &Value) -> Self {
        match value {
            Value::Null => Self::Null,
            Value::Bool(value) => Self::Bool(*value),
            Value::Number(value) => Self::Number(value.clone()),
            Value::String(value) => Self::String(value.clone()),
            Value::Array(values) => Self::Array(values.iter().map(Self::from).collect()),
            Value::Object(entries) => Self::Object(
                entries
                    .iter()
                    .map(|(key, value)| (key.clone(), Self::from(value)))
                    .collect(),
            ),
        }
    }
}

impl<'de> Deserialize<'de> for OrderedJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct JsonVisitor;

        impl<'de> de::Visitor<'de> for JsonVisitor {
            type Value = OrderedJson;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a JSON value without duplicate members")
            }

            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(OrderedJson::Null)
            }

            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
                Ok(OrderedJson::Bool(value))
            }

            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Ok(OrderedJson::Number(value.into()))
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
                Ok(OrderedJson::Number(value.into()))
            }

            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
                if value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
                    return self.visit_i64(value as i64);
                }
                Number::from_f64(value)
                    .map(OrderedJson::Number)
                    .ok_or_else(|| E::custom("Invalid JSON number"))
            }

            fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
                Ok(OrderedJson::String(value))
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                self.visit_string(value.to_owned())
            }

            fn visit_seq<A: de::SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = sequence.next_element()? {
                    values.push(value);
                }
                Ok(OrderedJson::Array(values))
            }

            fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                let mut seen = HashSet::new();
                while let Some((key, value)) = map.next_entry::<String, OrderedJson>()? {
                    if !seen.insert(key.clone()) {
                        return Err(de::Error::custom("Duplicate JSON member"));
                    }
                    entries.push((key, value));
                }
                Ok(OrderedJson::Object(entries))
            }
        }

        deserializer.deserialize_any(JsonVisitor)
    }
}

impl Serialize for OrderedJson {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => value.serialize(serializer),
            Self::String(value) => serializer.serialize_str(value),
            Self::Array(values) => values.serialize(serializer),
            Self::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                let mut indexed: Vec<_> = entries
                    .iter()
                    .filter_map(|(key, value)| array_index(key).map(|index| (index, key, value)))
                    .collect();
                indexed.sort_unstable_by_key(|(index, _, _)| *index);
                for (_, key, value) in indexed {
                    map.serialize_entry(key, value)?;
                }
                for (key, value) in entries {
                    if array_index(key).is_none() {
                        map.serialize_entry(key, value)?;
                    }
                }
                map.end()
            }
        }
    }
}

fn array_index(key: &str) -> Option<u32> {
    if key.starts_with('+') || (key.starts_with('0') && key.len() != 1) {
        return None;
    }
    key.parse().ok().filter(|index| *index != u32::MAX)
}

static SCHEMA: LazyLock<OrderedJson> = LazyLock::new(|| {
    OrderedJson::parse(include_bytes!(
        "../../../../contracts/v1/contracts.schema.json"
    ))
    .expect("the bundled v1 contract must be JSON")
});

pub(super) fn serialize_manifest<S: Serializer>(
    value: &Value,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let defs = SCHEMA.get("$defs").expect("v1 contract definitions");
    let manifest = defs.get("AppManifest").expect("v1 manifest definition");
    ordered_contract(value, manifest, defs).serialize(serializer)
}

fn ordered_contract(value: &Value, schema: &OrderedJson, defs: &OrderedJson) -> OrderedJson {
    if let Some(reference) = schema.get("$ref").and_then(OrderedJson::as_str)
        && let Some(definition) = reference
            .strip_prefix("#/$defs/")
            .and_then(|name| defs.get(name))
    {
        return ordered_contract(value, definition, defs);
    }
    // The current manifest's capability variants share the same field order.
    if let Some(variant) = schema
        .get("anyOf")
        .and_then(OrderedJson::as_array)
        .and_then(|variants| variants.first())
    {
        return ordered_contract(value, variant, defs);
    }
    if let (Value::Object(values), Some(OrderedJson::Object(properties))) =
        (value, schema.get("properties"))
    {
        return OrderedJson::Object(
            properties
                .iter()
                .filter_map(|(name, property)| {
                    values
                        .get(name)
                        .map(|value| (name.clone(), ordered_contract(value, property, defs)))
                })
                .collect(),
        );
    }
    if let (Value::Array(values), Some(items)) = (value, schema.get("items")) {
        return OrderedJson::Array(
            values
                .iter()
                .map(|value| ordered_contract(value, items, defs))
                .collect(),
        );
    }
    if let Value::Number(value) = value
        && let Some(number) = value.as_f64()
        && number.fract() == 0.0
        && number.abs() <= 9_007_199_254_740_991.0
    {
        return OrderedJson::Number((number as i64).into());
    }
    OrderedJson::from(value)
}
