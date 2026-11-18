use std::fmt;

use serde::de::{Error, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Number, Value};

// serde_json::Value normally keeps the last of two identical member names.
// Reject the ambiguity before verifying signatures or interpreting any fields.
struct UniqueValue(Value);

impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_any(JsonVisitor).map(Self)
    }
}

struct JsonVisitor;

impl<'de> Visitor<'de> for JsonVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON with unique object members")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<Value, A::Error> {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if object.contains_key(&key) {
                return Err(A::Error::custom("duplicate JSON member"));
            }
            object.insert(key, map.next_value::<UniqueValue>()?.0);
        }
        Ok(Value::Object(object))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Value, A::Error> {
        let mut array = Vec::new();
        while let Some(value) = seq.next_element::<UniqueValue>()? {
            array.push(value.0);
        }
        Ok(Value::Array(array))
    }

    fn visit_bool<E: Error>(self, value: bool) -> std::result::Result<Value, E> {
        Ok(value.into())
    }

    fn visit_str<E: Error>(self, value: &str) -> std::result::Result<Value, E> {
        Ok(value.into())
    }

    fn visit_string<E: Error>(self, value: String) -> std::result::Result<Value, E> {
        Ok(value.into())
    }

    fn visit_i64<E: Error>(self, value: i64) -> std::result::Result<Value, E> {
        Ok(value.into())
    }

    fn visit_u64<E: Error>(self, value: u64) -> std::result::Result<Value, E> {
        Ok(value.into())
    }

    fn visit_f64<E: Error>(self, value: f64) -> std::result::Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("invalid JSON number"))
    }

    fn visit_unit<E: Error>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }
}

pub fn parse_json(bytes: &[u8]) -> std::io::Result<Value> {
    serde_json::from_slice::<UniqueValue>(bytes)
        .map(|value| value.0)
        .map_err(|_| crate::invalid("Invalid or ambiguous JSON"))
}

pub fn validate_wire_json(value: &Value) -> std::io::Result<()> {
    fn valid(value: &Value, depth: usize) -> bool {
        const MAX_INTEGER: f64 = 9_007_199_254_740_991.0;
        if depth > 64 {
            return false;
        }
        match value {
            Value::Object(members) => {
                depth < 64 && members.values().all(|value| valid(value, depth + 1))
            }
            Value::Array(items) => depth < 64 && items.iter().all(|item| valid(item, depth + 1)),
            Value::Number(number) => number
                .as_f64()
                .is_some_and(|value| value.abs() <= MAX_INTEGER),
            _ => true,
        }
    }
    if valid(value, 0) {
        Ok(())
    } else {
        Err(crate::invalid(
            "JSON exceeds the wire depth or number limits",
        ))
    }
}
