mod models;
mod repository;
mod seeds;

pub use models::*;
pub use repository::*;
pub use seeds::*;

pub fn module_name() -> &'static str {
    "gt-agent"
}
