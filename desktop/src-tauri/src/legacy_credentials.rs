//! Recovery-only scope for old desktop provider entries. New writes belong to
//! the independent engine broker. Never accept arbitrary OS service/account
//! addresses from a renderer, including CLI's environment-name accounts.
pub fn validate_scope(service: &str, account: &str) -> Result<(), String> {
    const ACCOUNTS: &[&str] = &[
        "openai", "anthropic", "google", "openrouter", "ollama", "mistral",
        "groq", "together", "xai", "deepseek", "cohere", "custom",
    ];
    if service != "xr" || !ACCOUNTS.contains(&account) {
        return Err("Only known legacy XR desktop provider credentials can be recovered or removed; use the engine secret broker for new credentials".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_desktop_accounts_remain_recoverable() {
        for account in ["openai", "anthropic", "google", "custom", "cohere"] {
            assert!(validate_scope("xr", account).is_ok());
        }
    }
    #[test]
    fn no_foreign_service_or_cli_environment_account() {
        for (service, account) in [("other-app", "openai"), ("xr", "OPENAI_API_KEY"), ("xr", "XR_AUDIT_SIGNING_KEY"), ("xr", ""), ("xr", "openai\n"), ("xr ", "openai")] {
            assert!(validate_scope(service, account).is_err());
        }
    }
}
