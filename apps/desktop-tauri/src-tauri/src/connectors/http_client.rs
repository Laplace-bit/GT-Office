use super::channel_error::ChannelError;
use reqwest::{Client, ClientBuilder, Method};
use serde_json::Value;
use std::time::Duration;
use tracing::warn;

const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 8;
const DEFAULT_MAX_RETRIES: u32 = 2;
const DEFAULT_RETRY_DELAY_SECS: u64 = 1;

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub content_type: Option<String>,
    pub timeout_secs: u64,
}

impl HttpRequest {
    pub fn get(url: &str) -> HttpRequestBuilder {
        HttpRequestBuilder {
            method: "GET".to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
            content_type: None,
            timeout_secs: 8,
        }
    }

    pub fn post(url: &str) -> HttpRequestBuilder {
        HttpRequestBuilder {
            method: "POST".to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
            content_type: None,
            timeout_secs: 8,
        }
    }
}

pub struct HttpRequestBuilder {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    content_type: Option<String>,
    timeout_secs: u64,
}

impl HttpRequestBuilder {
    pub fn header(mut self, key: &str, value: &str) -> Self {
        self.headers.push((key.to_string(), value.to_string()));
        self
    }

    pub fn json_body(mut self, value: &Value) -> Self {
        self.body = Some(value.to_string());
        self.content_type = Some("application/json".to_string());
        self
    }

    pub fn form_body(mut self, pairs: &[(String, String)]) -> Self {
        self.body = Some(
            pairs
                .iter()
                .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
                .collect::<Vec<_>>()
                .join("&"),
        );
        self.content_type = Some("application/x-www-form-urlencoded".to_string());
        self
    }

    pub fn timeout_secs(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    pub fn build(self) -> HttpRequest {
        HttpRequest {
            method: self.method,
            url: self.url,
            headers: self.headers,
            body: self.body,
            content_type: self.content_type,
            timeout_secs: self.timeout_secs,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpClient {
    client: Client,
    max_retries: u32,
    retry_delay_secs: u64,
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpClient {
    pub fn new() -> Self {
        Self::builder().build()
    }

    pub fn builder() -> HttpClientBuilder {
        HttpClientBuilder {
            connect_timeout_secs: DEFAULT_CONNECT_TIMEOUT_SECS,
            max_retries: DEFAULT_MAX_RETRIES,
            retry_delay_secs: DEFAULT_RETRY_DELAY_SECS,
        }
    }

    pub async fn execute(&self, request: HttpRequest) -> Result<HttpResponse, ChannelError> {
        let mut last_error: Option<ChannelError> = None;
        let max_attempts = 1 + self.max_retries;

        for attempt in 0..max_attempts {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(self.retry_delay_secs)).await;
            }

            match self.execute_once(&request).await {
                Ok(response) => return Ok(response),
                Err(error) if error.retryable() && attempt + 1 < max_attempts => {
                    warn!(
                        attempt = attempt + 1,
                        max_attempts,
                        error = %error,
                        "http request failed, retrying"
                    );
                    last_error = Some(error);
                }
                Err(error) => return Err(error),
            }
        }

        Err(last_error.unwrap_or_else(|| ChannelError::Transport {
            detail: "all retry attempts exhausted".to_string(),
            retryable: false,
        }))
    }

    async fn execute_once(&self, request: &HttpRequest) -> Result<HttpResponse, ChannelError> {
        let method = Method::from_bytes(request.method.as_bytes()).unwrap_or(Method::GET);
        let mut req = self.client.request(method, &request.url);

        for (key, value) in &request.headers {
            req = req.header(key.as_str(), value.as_str());
        }

        if let Some(content_type) = &request.content_type {
            req = req.header("Content-Type", content_type);
        }

        if let Some(body) = &request.body {
            req = req.body(body.clone());
        }

        req = req.timeout(Duration::from_secs(request.timeout_secs));

        let response = req.send().await.map_err(ChannelError::from)?;

        let status = response.status().as_u16();
        let body_bytes = response.bytes().await.map_err(ChannelError::from)?;

        Ok(HttpResponse {
            status,
            body: body_bytes.to_vec(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn json_value(&self) -> Result<Value, ChannelError> {
        serde_json::from_slice::<Value>(&self.body).map_err(|error| {
            ChannelError::invalid_response(format!("invalid JSON: {error}"), Some(self.status))
        })
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }

    pub fn is_success(&self) -> bool {
        self.status >= 200 && self.status < 300
    }
}

pub struct HttpClientBuilder {
    connect_timeout_secs: u64,
    max_retries: u32,
    retry_delay_secs: u64,
}

impl HttpClientBuilder {
    #[cfg(test)]
    pub fn max_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }

    #[cfg(test)]
    pub fn retry_delay_secs(mut self, secs: u64) -> Self {
        self.retry_delay_secs = secs;
        self
    }

    pub fn build(self) -> HttpClient {
        let client = ClientBuilder::new()
            .connect_timeout(Duration::from_secs(self.connect_timeout_secs))
            .use_rustls_tls()
            .build()
            .expect("failed to build reqwest client");

        HttpClient {
            client,
            max_retries: self.max_retries,
            retry_delay_secs: self.retry_delay_secs,
        }
    }
}

#[cfg(test)]
#[path = "http_client_tests.rs"]
mod tests;
