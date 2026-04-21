use std::sync::Arc;

use crate::adapters::AdapterRegistry;
use crate::sandbox::PathAuthority;

/// Shared application state managed by Tauri.
pub struct AppState {
    pub adapters: Arc<AdapterRegistry>,
    pub authority: Arc<PathAuthority>,
}

impl AppState {
    pub fn new(registry: AdapterRegistry) -> Self {
        Self {
            adapters: Arc::new(registry),
            authority: Arc::new(PathAuthority::new()),
        }
    }
}
