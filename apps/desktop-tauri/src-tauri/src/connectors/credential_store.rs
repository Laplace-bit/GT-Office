use gt_security::SecretStore;

use crate::connectors::channel_error::ChannelError;

const CHANNEL_SECRET_SERVICE: &str = "gtoffice.channel";
const CHANNEL_SECRET_NAMESPACE: &str = "CHANNEL_CREDENTIAL";

fn channel_secret_store() -> SecretStore {
    SecretStore::new(CHANNEL_SECRET_SERVICE, CHANNEL_SECRET_NAMESPACE)
}

pub fn store_secret(reference: &str, value: &str) -> Result<(), ChannelError> {
    channel_secret_store()
        .store(reference, value)
        .map_err(|error| ChannelError::Auth {
            category: "secret_store_failed".to_string(),
            detail: error.to_string(),
            retryable: false,
        })
}

pub fn load_secret(reference: &str) -> Result<String, ChannelError> {
    channel_secret_store()
        .load(reference)
        .map_err(|error| ChannelError::Auth {
            category: "secret_store_failed".to_string(),
            detail: error.to_string(),
            retryable: false,
        })
}
