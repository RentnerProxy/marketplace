mod operations;

use serde_json::Value;

use crate::validation::integer;
use crate::{ContractError, ProtocolContracts};

pub use operations::{HttpOperation, MAX_JSON_DEPTH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpSocket {
    App,
    Core,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HttpDescriptor {
    pub method: HttpMethod,
    pub socket: HttpSocket,
    pub path: &'static str,
    pub path_parameter: Option<&'static str>,
    pub idempotency_key: bool,
    pub resume_cursor: bool,
    pub request: Option<&'static str>,
    pub success_status: u16,
    pub response: Option<&'static str>,
    pub event: Option<&'static str>,
}

#[derive(Default)]
pub struct HttpRequestOptions<'a> {
    pub path_value: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
    pub resume_cursor: Option<&'a str>,
    pub body: Option<&'a Value>,
}

/// A validated relative request for the operation's declared socket.
pub struct HttpRequest<'a> {
    method: HttpMethod,
    socket: HttpSocket,
    path: String,
    idempotency_key: Option<&'a str>,
    resume_cursor: Option<&'a str>,
    body: Option<&'a Value>,
}

impl<'a> HttpRequest<'a> {
    pub fn method(&self) -> HttpMethod {
        self.method
    }

    pub fn socket(&self) -> HttpSocket {
        self.socket
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    /// Operation-specific headers. The caller supplies installation headers
    /// and credentials through its transport.
    pub fn headers(&self) -> impl Iterator<Item = (&'static str, &'a str)> {
        [
            self.idempotency_key.map(|key| ("Idempotency-Key", key)),
            self.resume_cursor.map(|cursor| ("Last-Event-ID", cursor)),
        ]
        .into_iter()
        .flatten()
    }

    pub fn body(&self) -> Option<&'a Value> {
        self.body
    }
}

impl ProtocolContracts {
    /// Validate the operation's inputs and prepare a relative request.
    ///
    /// # Errors
    ///
    /// Returns `InvalidShape` for omitted required inputs, undeclared inputs,
    /// or values that fail the corresponding protocol schema.
    pub fn prepare_http_request<'a>(
        &self,
        operation: HttpOperation,
        options: HttpRequestOptions<'a>,
    ) -> Result<HttpRequest<'a>, ContractError> {
        let descriptor = operation.descriptor();
        let path = match (descriptor.path_parameter, options.path_value) {
            (Some(name), Some(value)) => {
                self.validate("RecordId", &Value::from(value))?;
                descriptor.path.replace(&format!("{{{name}}}"), value)
            }
            (None, None) => descriptor.path.to_owned(),
            _ => return Err(ContractError::InvalidShape),
        };
        if descriptor.idempotency_key != options.idempotency_key.is_some() {
            return Err(ContractError::InvalidShape);
        }
        if let Some(key) = options.idempotency_key {
            self.validate("RecordId", &Value::from(key))?;
        }
        if let Some(cursor) = options.resume_cursor {
            if !descriptor.resume_cursor {
                return Err(ContractError::InvalidShape);
            }
            self.validate("EventCursor", &Value::from(cursor))?;
        }
        self.validate_http_body(descriptor.request, options.body)?;
        Ok(HttpRequest {
            method: descriptor.method,
            socket: descriptor.socket,
            path,
            idempotency_key: options.idempotency_key,
            resume_cursor: options.resume_cursor,
            body: options.body,
        })
    }

    /// Validate a decoded response body against the operation and HTTP status.
    /// Pass `None` when opening an event stream or receiving a bodyless response.
    /// The caller enforces byte limits and rejects duplicate JSON members.
    ///
    /// # Errors
    ///
    /// Returns `InvalidShape` for an unexpected status, incorrect body
    /// presence, or a body that fails validation.
    pub fn validate_http_response(
        &self,
        operation: HttpOperation,
        status: u16,
        body: Option<&Value>,
    ) -> Result<(), ContractError> {
        let descriptor = operation.descriptor();
        if status == descriptor.success_status {
            return self.validate_http_body(descriptor.response, body);
        }
        if let (400..=599, Some(problem)) = (status, body) {
            self.validate("Problem", problem)?;
            if integer(&problem["status"]) == u64::from(status) {
                return Ok(());
            }
        }
        Err(ContractError::InvalidShape)
    }

    /// Validate a decoded event payload for the stream operation.
    ///
    /// # Errors
    ///
    /// Returns `InvalidShape` when the operation has no event schema or the
    /// payload fails that schema.
    pub fn validate_http_event(
        &self,
        operation: HttpOperation,
        event: &Value,
    ) -> Result<(), ContractError> {
        let schema = operation
            .descriptor()
            .event
            .ok_or(ContractError::InvalidShape)?;
        self.validate(schema, event)
    }

    fn validate_http_body(
        &self,
        schema: Option<&str>,
        body: Option<&Value>,
    ) -> Result<(), ContractError> {
        match (schema, body) {
            (Some(schema), Some(body)) => self.validate(schema, body),
            (None, None) => Ok(()),
            _ => Err(ContractError::InvalidShape),
        }
    }
}
