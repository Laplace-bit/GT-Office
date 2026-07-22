mod models;
mod repository;

pub use models::*;
pub use repository::*;

pub fn module_name() -> &'static str {
    "gt-agent"
}
