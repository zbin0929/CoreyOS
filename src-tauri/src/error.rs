use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("adapter not configured: {hint}")]
    NotConfigured { hint: String },

    #[error("adapter unreachable at {endpoint}: {source}")]
    Unreachable {
        endpoint: String,
        #[source]
        source: anyhow::Error,
    },

    #[error("unauthorized: {detail}")]
    Unauthorized { detail: String },

    #[error("rate limited, retry after {retry_after_s:?}s")]
    RateLimited { retry_after_s: Option<u32> },

    #[error("upstream error {status}: {body}")]
    Upstream { status: u16, body: String },

    #[error("protocol error: {detail}")]
    Protocol { detail: String },

    #[error("unsupported capability: {capability}")]
    Unsupported { capability: &'static str },

    #[error("internal error: {source}")]
    Internal {
        #[source]
        source: anyhow::Error,
    },
}

impl AdapterError {
    pub fn internal(e: impl Into<anyhow::Error>) -> Self {
        Self::Internal { source: e.into() }
    }
}

/// Frontend-friendly serialized error envelope.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IpcError {
    NotConfigured { hint: String },
    Unreachable { endpoint: String, message: String },
    Unauthorized { detail: String },
    RateLimited { retry_after_s: Option<u32> },
    Upstream { status: u16, body: String },
    Protocol { detail: String },
    Unsupported { capability: String },
    Internal { message: String },
    /// Sandbox denied access to a system-critical path.
    SandboxDenied { path: String, reason: String },
    /// Sandbox would allow with user consent. In Phase 0 this is terminal
    /// (no consent UI yet); in Phase 2 it resolves via an interactive prompt.
    SandboxConsentRequired { path: String },
}

impl From<AdapterError> for IpcError {
    fn from(e: AdapterError) -> Self {
        match e {
            AdapterError::NotConfigured { hint } => IpcError::NotConfigured { hint },
            AdapterError::Unreachable { endpoint, source } => IpcError::Unreachable {
                endpoint,
                message: format!("{source}"),
            },
            AdapterError::Unauthorized { detail } => IpcError::Unauthorized { detail },
            AdapterError::RateLimited { retry_after_s } => IpcError::RateLimited { retry_after_s },
            AdapterError::Upstream { status, body } => IpcError::Upstream { status, body },
            AdapterError::Protocol { detail } => IpcError::Protocol { detail },
            AdapterError::Unsupported { capability } => IpcError::Unsupported {
                capability: capability.into(),
            },
            AdapterError::Internal { source } => IpcError::Internal {
                message: format!("{source}"),
            },
        }
    }
}

impl From<crate::sandbox::SandboxError> for IpcError {
    fn from(e: crate::sandbox::SandboxError) -> Self {
        use crate::sandbox::SandboxError as S;
        match e {
            S::Denied { path, reason } => IpcError::SandboxDenied {
                path,
                reason: reason.to_string(),
            },
            S::ConsentRequired { path } => IpcError::SandboxConsentRequired { path },
            S::ReadOnlyRoot { path } => IpcError::SandboxDenied {
                path,
                reason: "workspace root is read-only".into(),
            },
            S::Canonicalize { path, source } => IpcError::Internal {
                message: format!("fs error on {path}: {source}"),
            },
            S::Invalid { path } => IpcError::Internal {
                message: format!("invalid path: {path}"),
            },
        }
    }
}

pub type AdapterResult<T> = Result<T, AdapterError>;
pub type IpcResult<T> = Result<T, IpcError>;
