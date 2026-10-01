/*
 * Approvals backend stubs (Phase 7) — the trust UI's Rust side.
 *
 * Real permission enforcement arrives in Phase 12 (Shield gateway) and
 * Phase 14/20 (LLM + skills). Until then this module owns:
 *   - remember-rule persistence (`approvals.json` Tauri Store — the seam the
 *     Shield database will take over; shapes mirror src/lib/approvalCore.ts)
 *   - the OS native notification bridge (tauri-plugin-notification; macOS
 *     requests permission on first send — a denial degrades to in-app only)
 *
 * IPC surface (frontend: src/lib/approvalRules.ts + approvalEvents.ts):
 *   load_rules() -> Vec<ApprovalRule>
 *   save_rules(rules)
 *   send_os_notification(title, body, notification_id)
 */
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::{Store, StoreBuilder};

/// Store file — separate from settings.json (different lifecycle: Shield
/// will migrate these into its own database in Phase 12).
const STORE_FILE: &str = "approvals.json";
const RULES_KEY: &str = "rules";

// ─── Rule model (camelCase to match the TS contract) ───────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRule {
    pub id: String,
    pub skill_id: String,
    pub action: String,
    pub resource: Option<String>,
    pub effect: ApprovalEffect,
    pub duration: RuleDuration,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalEffect {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleDuration {
    Forever,
    #[serde(rename = "1h")]
    OneHour,
    Session,
}

fn rules_store<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Store<R>>> {
    StoreBuilder::new(app, STORE_FILE).build().ok()
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_rules<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ApprovalRule>, String> {
    let Some(store) = rules_store(&app) else {
        return Ok(Vec::new());
    };
    match store.get(RULES_KEY) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("corrupt approval rules: {e}")),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn save_rules<R: Runtime>(
    app: AppHandle<R>,
    rules: Vec<ApprovalRule>,
) -> Result<(), String> {
    let store = rules_store(&app).ok_or("approval store unavailable")?;
    store.set(RULES_KEY, serde_json::to_value(&rules).map_err(|e| e.to_string())?);
    store
        .save()
        .map_err(|e| format!("failed to save approval rules: {e}"))
}

/// Fire an OS notification. Permission is requested implicitly on first send
/// (macOS); on denial or any platform failure this simply no-ops so the
/// caller's in-app feed stays the source of truth.
#[tauri::command]
pub fn send_os_notification<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: String,
    #[allow(unused_variables)] notification_id: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("os notification failed: {e}"))
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{ApprovalEffect, ApprovalRule, RuleDuration};

    fn sample() -> ApprovalRule {
        ApprovalRule {
            id: "rule-1".into(),
            skill_id: "gmail-skill".into(),
            action: "Send email".into(),
            resource: Some("sarah@company.com".into()),
            effect: ApprovalEffect::Allow,
            duration: RuleDuration::OneHour,
            created_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn rule_roundtrips_the_ts_contract() {
        let json = serde_json::to_value(sample()).unwrap();
        // camelCase keys, "1h" duration — exactly what approvalCore.ts writes.
        assert_eq!(json["skillId"], "gmail-skill");
        assert_eq!(json["createdAt"], sample().created_at);
        assert_eq!(json["duration"], "1h");
        assert_eq!(json["effect"], "allow");
        assert_eq!(json["resource"], "sarah@company.com");
        let back: ApprovalRule = serde_json::from_value(json).unwrap();
        assert_eq!(back, sample());
    }

    #[test]
    fn null_resource_roundtrips() {
        let mut rule = sample();
        rule.resource = None;
        rule.duration = RuleDuration::Forever;
        rule.effect = ApprovalEffect::Deny;
        let json = serde_json::to_value(&rule).unwrap();
        assert!(json["resource"].is_null());
        assert_eq!(json["duration"], "forever");
        assert_eq!(json["effect"], "deny");
        let back: ApprovalRule = serde_json::from_value(json).unwrap();
        assert_eq!(back, rule);
    }

    #[test]
    fn rejects_unknown_duration_and_effect() {
        let json = serde_json::to_value(sample()).unwrap();
        let mut bad = json.clone();
        bad["duration"] = serde_json::json!("sometimes");
        assert!(serde_json::from_value::<ApprovalRule>(bad).is_err());

        let mut bad = json.clone();
        bad["effect"] = serde_json::json!("maybe");
        assert!(serde_json::from_value::<ApprovalRule>(bad).is_err());
    }

    #[test]
    fn session_duration_serializes() {
        let mut rule = sample();
        rule.duration = RuleDuration::Session;
        let json = serde_json::to_value(&rule).unwrap();
        assert_eq!(json["duration"], "session");
    }
}
