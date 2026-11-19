use std::collections::{HashMap, HashSet};
use std::io;

use serde_json::Value;

use super::documents::Files;
use super::invalid;
use super::ustar::safe_package_path;

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
pub(super) enum Node {
    Api,
    Callback,
    Components,
    Content,
    Encoding,
    Example,
    Link,
    Operation,
    Parameter,
    Path,
    Request,
    Response,
    Schema,
    SecurityScheme,
}

#[derive(Clone, Copy)]
enum Children {
    One(Node),
    Array(Node),
    Items(Node),
    Map(Node),
    ExtendedMap(Node),
}

impl Node {
    fn children(self) -> &'static [(&'static str, Children)] {
        use Children::{Array, ExtendedMap, Items, Map, One};
        use Node::*;

        // Follow schema applicators and OpenAPI reference objects. Examples,
        // defaults, map keys and extensions can contain arbitrary application data.
        match self {
            Api => &[
                ("components", One(Components)),
                ("paths", ExtendedMap(Path)),
                ("webhooks", Map(Path)),
            ],
            Components => &[
                ("callbacks", Map(Callback)),
                ("examples", Map(Example)),
                ("headers", Map(Parameter)),
                ("links", Map(Link)),
                ("parameters", Map(Parameter)),
                ("pathItems", Map(Path)),
                ("requestBodies", Map(Request)),
                ("responses", Map(Response)),
                ("schemas", Map(Schema)),
                ("securitySchemes", Map(SecurityScheme)),
            ],
            Content => &[
                ("encoding", Map(Encoding)),
                ("examples", Map(Example)),
                ("schema", One(Schema)),
            ],
            Encoding => &[("headers", Map(Parameter))],
            Operation => &[
                ("callbacks", Map(Callback)),
                ("parameters", Array(Parameter)),
                ("requestBody", One(Request)),
                ("responses", ExtendedMap(Response)),
            ],
            Parameter => &[
                ("content", Map(Content)),
                ("examples", Map(Example)),
                ("schema", One(Schema)),
            ],
            Path => &[
                ("delete", One(Operation)),
                ("get", One(Operation)),
                ("head", One(Operation)),
                ("options", One(Operation)),
                ("parameters", Array(Parameter)),
                ("patch", One(Operation)),
                ("post", One(Operation)),
                ("put", One(Operation)),
                ("trace", One(Operation)),
            ],
            Request => &[("content", Map(Content))],
            Response => &[
                ("content", Map(Content)),
                ("headers", Map(Parameter)),
                ("links", Map(Link)),
            ],
            Schema => &[
                ("$defs", Map(Schema)),
                ("additionalItems", One(Schema)),
                ("additionalProperties", One(Schema)),
                ("allOf", Array(Schema)),
                ("anyOf", Array(Schema)),
                ("contains", One(Schema)),
                ("contentSchema", One(Schema)),
                ("definitions", Map(Schema)),
                ("dependencies", Map(Schema)),
                ("dependentSchemas", Map(Schema)),
                ("else", One(Schema)),
                ("if", One(Schema)),
                ("items", Items(Schema)),
                ("not", One(Schema)),
                ("oneOf", Array(Schema)),
                ("patternProperties", Map(Schema)),
                ("prefixItems", Array(Schema)),
                ("properties", Map(Schema)),
                ("propertyNames", One(Schema)),
                ("then", One(Schema)),
                ("unevaluatedItems", One(Schema)),
                ("unevaluatedProperties", One(Schema)),
            ],
            Callback | Example | Link | SecurityScheme => &[],
        }
    }

    fn allows_reference(self) -> bool {
        use Node::*;
        matches!(
            self,
            Callback
                | Example
                | Link
                | Parameter
                | Path
                | Request
                | Response
                | Schema
                | SecurityScheme
        )
    }
}

struct Reference {
    target: String,
    pointer: String,
    node: Node,
}

#[derive(Default)]
struct Visits {
    seen: HashSet<(*const Value, Node)>,
    pending: Vec<Reference>,
    references: usize,
}

impl Visits {
    fn follow(&mut self, member: &Value, owner: &str, node: Node) -> io::Result<()> {
        self.references += 1;
        let Some(reference) = member
            .as_str()
            .filter(|text| text.encode_utf16().count() <= 1024)
        else {
            return Err(invalid("Invalid candidate JSON reference"));
        };
        if self.references > 4096 {
            return Err(invalid("Invalid candidate JSON reference"));
        }
        self.pending.push(parse_reference(reference, owner, node)?);
        Ok(())
    }

    fn walk(&mut self, value: &Value, owner: &str, node: Node) -> io::Result<()> {
        let Some(members) = value.as_object() else {
            return Ok(());
        };
        if members.is_empty() {
            return Ok(());
        }
        // Boxed documents remain alive for the whole walk. Their Value addresses
        // are used only as identity, including when a reference links a cycle.
        if !self.seen.insert((std::ptr::from_ref(value), node)) {
            return Ok(());
        }
        if (node == Node::Schema
            && ["$id", "$dynamicRef", "$recursiveRef"]
                .iter()
                .any(|key| members.contains_key(*key)))
            || (node == Node::Example && members.contains_key("externalValue"))
        {
            return Err(invalid("Unsupported candidate JSON reference or scope"));
        }
        if let Some(reference) = members.get("$ref").filter(|_| node.allows_reference()) {
            self.follow(reference, owner, node)?;
        } else if node == Node::Callback {
            self.walk_children(value, owner, Children::ExtendedMap(Node::Path))?;
        }
        if let Some(reference) = members.get("operationRef").filter(|_| node == Node::Link) {
            self.follow(reference, owner, Node::Operation)?;
        }
        for &(key, rule) in node.children() {
            if let Some(child) = members.get(key) {
                self.walk_children(child, owner, rule)?;
            }
        }
        Ok(())
    }

    fn walk_children(&mut self, value: &Value, owner: &str, rule: Children) -> io::Result<()> {
        match rule {
            Children::One(node) => self.walk(value, owner, node)?,
            Children::Array(node) | Children::Items(node) => {
                if let Some(items) = value.as_array() {
                    for item in items {
                        self.walk(item, owner, node)?;
                    }
                } else if matches!(rule, Children::Items(_)) {
                    self.walk(value, owner, node)?;
                }
            }
            Children::Map(node) | Children::ExtendedMap(node) => {
                if let Some(items) = value.as_object() {
                    for (key, item) in items {
                        if !(matches!(rule, Children::ExtendedMap(_)) && key.starts_with("x-")) {
                            self.walk(item, owner, node)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

pub(super) fn verify(files: &Files<'_>, documents: Vec<(&str, Value, Node)>) -> io::Result<()> {
    let mut visits = Visits::default();
    let mut loaded = HashMap::new();
    let mut bytes = 0;
    for (path, document, node) in documents {
        bytes += files.required(path)?;
        let document = Box::new(document);
        visits.walk(&document, path, node)?;
        loaded.insert(path.to_owned(), document);
    }
    while let Some(Reference {
        target,
        pointer,
        node,
    }) = visits.pending.pop()
    {
        if !loaded.contains_key(&target) {
            bytes += files.required(&target)?;
            if loaded.len() >= 64 || bytes > 16 * 1024 * 1024 {
                return Err(invalid(
                    "Referenced candidate JSON documents exceed their budget",
                ));
            }
            loaded.insert(target.clone(), Box::new(files.json(&target)?));
        }
        let value = resolve_pointer(&loaded[&target], &pointer, node == Node::Schema)?;
        if !(value.is_object() || (node == Node::Schema && value.is_boolean())) {
            return Err(invalid(
                "Candidate JSON reference must target an object or schema",
            ));
        }
        visits.walk(value, &target, node)?;
    }
    Ok(())
}

fn parse_reference(reference: &str, owner: &str, node: Node) -> io::Result<Reference> {
    let (asset, fragment) = reference.split_once('#').unwrap_or((reference, ""));
    if reference.is_empty()
        || fragment.contains('#')
        || (asset.is_empty() && !reference.starts_with('#'))
        || (!asset.is_empty() && (!safe_package_path(asset) || !asset.ends_with(".json")))
    {
        return Err(invalid("Candidate JSON references must be package-local"));
    }
    let pointer =
        decode_fragment(fragment).ok_or_else(|| invalid("Invalid candidate JSON reference"))?;
    if (!pointer.is_empty() && !pointer.starts_with('/'))
        || pointer.as_bytes().iter().enumerate().any(|(index, byte)| {
            *byte == b'~' && !matches!(pointer.as_bytes().get(index + 1), Some(b'0' | b'1'))
        })
    {
        return Err(invalid("Invalid candidate JSON reference"));
    }
    let target = if asset.is_empty() {
        owner.to_owned()
    } else if let Some((parent, _)) = owner.rsplit_once('/') {
        format!("{parent}/{asset}")
    } else {
        asset.to_owned()
    };
    if !safe_package_path(&target) {
        return Err(invalid("Invalid candidate JSON reference"));
    }
    Ok(Reference {
        target,
        pointer,
        node,
    })
}

fn decode_fragment(fragment: &str) -> Option<String> {
    let mut bytes = fragment.bytes();
    let mut decoded = Vec::with_capacity(fragment.len());
    while let Some(byte) = bytes.next() {
        decoded.push(if byte == b'%' {
            let high = char::from(bytes.next()?).to_digit(16)?;
            let low = char::from(bytes.next()?).to_digit(16)?;
            (high * 16 + low) as u8
        } else {
            byte
        });
    }
    String::from_utf8(decoded).ok()
}

fn resolve_pointer<'a>(mut value: &'a Value, pointer: &str, schema: bool) -> io::Result<&'a Value> {
    if let Some(components) = pointer.strip_prefix('/') {
        for component in components.split('/') {
            if schema && value.get("$id").is_some_and(Value::is_string) {
                return Err(invalid("Unsupported candidate JSON reference or scope"));
            }
            let key = component.replace("~1", "/").replace("~0", "~");
            let next = if let Some(array) = value.as_array() {
                (!key.starts_with('0') || key == "0")
                    .then_some(())
                    .filter(|()| key.bytes().all(|byte| byte.is_ascii_digit()))
                    .and_then(|()| key.parse::<usize>().ok())
                    .and_then(|index| array.get(index))
            } else {
                value.get(&key)
            };
            value = next.ok_or_else(|| {
                invalid("Candidate JSON reference does not resolve inside its package")
            })?;
        }
    }
    Ok(value)
}
