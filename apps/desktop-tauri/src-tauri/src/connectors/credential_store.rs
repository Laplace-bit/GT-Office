use gt_security::SecretStore;

const CHANNEL_SECRET_SERVICE: &str = "gtoffice.channel";
const CHANNEL_SECRET_NAMESPACE: &str = "CHANNEL_CREDENTIAL";

fn channel_secret_store() -> SecretStore {
    SecretStore::new(CHANNEL_SECRET_SERVICE, CHANNEL_SECRET_NAMESPACE)
}

pub fn store_secret(reference: &str, value: &str) -> Result<(), String> {
    channel_secret_store()
        .store(reference, value)
        .map_err(|error| error.to_string())
}

pub fn load_secret(reference: &str) -> Result<String, String> {
    channel_secret_store()
        .load(reference)
        .map_err(|error| error.to_string())
}
