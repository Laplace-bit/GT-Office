pub mod change_feed;
pub mod types;

pub use change_feed::SessionChangeFeed;
pub use types::*;

pub fn module_name() -> &'static str {
    "gt-changefeed"
}
