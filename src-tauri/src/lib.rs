//! Desktop shell for bpp-ops.
//!
//! The window loads the deployed web app directly, so the desktop build stays in
//! sync with every Firebase deploy and needs no updater. The only native surface
//! is an OAuth bridge: Google blocks its sign-in flow inside embedded webviews,
//! so `signInWithPopup` cannot work here. Instead the app performs the standard
//! native-app flow (RFC 8252) — a loopback listener plus the *system* browser —
//! and hands the resulting authorization code back to the frontend, which
//! exchanges it with PKCE and calls `signInWithCredential`.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// Baked in at build time (see the desktop release workflow). Google treats the
/// secret of an "installed app" client as non-confidential, but it still must not
/// sit in the publicly served web bundle — hence compiling it into the binary.
const CLIENT_ID: Option<&str> = option_env!("CRNG_OAUTH_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("CRNG_OAUTH_CLIENT_SECRET");

/// How long the loopback listener waits for the browser to come back.
const REDIRECT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct OauthState {
    pending: Mutex<Option<Receiver<Result<String, String>>>>,
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let decoded = std::str::from_utf8(&bytes[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok());
                match decoded {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next().unwrap_or("");
        if k == key {
            Some(percent_decode(v))
        } else {
            None
        }
    })
}

/// Blocks until the browser hits the loopback redirect, then answers with a small
/// "you can close this" page and yields the authorization code.
fn accept_code(listener: &TcpListener) -> Result<String, String> {
    let (stream, _) = listener.accept().map_err(|e| e.to_string())?;

    let mut request_line = String::new();
    BufReader::new(&stream)
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;

    // "GET /?code=...&scope=... HTTP/1.1"
    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = target.splitn(2, '?').nth(1).unwrap_or("");
    let code = query_param(query, "code");
    let error = query_param(query, "error");

    let (status, message) = if code.is_some() {
        ("200 OK", "로그인이 완료되었습니다.<br>이 탭을 닫고 앱으로 돌아가세요.")
    } else {
        ("400 Bad Request", "로그인에 실패했습니다.<br>앱에서 다시 시도해 주세요.")
    };
    let body = format!(
        "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\">\
         <title>bpp-ops</title>\
         <body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;\
         display:flex;align-items:center;justify-content:center;height:100vh;\
         margin:0;background:#111;color:#eee;text-align:center;line-height:1.7\">\
         <div>{message}</div></body></html>"
    );

    let mut writer = &stream;
    let _ = write!(
        writer,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = writer.flush();

    match (code, error) {
        (Some(code), _) => Ok(code),
        (None, Some(error)) => Err(error),
        _ => Err("redirect carried no authorization code".to_string()),
    }
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Exchanges the authorization code for an ID token, per Google's installed-app
/// flow (client secret included, as Google requires even with PKCE).
fn exchange_code(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<serde_json::Value, String> {
    let client_id = CLIENT_ID.ok_or("CRNG_OAUTH_CLIENT_ID was not set at build time")?;
    let client_secret =
        CLIENT_SECRET.ok_or("CRNG_OAUTH_CLIENT_SECRET was not set at build time")?;

    let body = form_encode(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ]);

    let response = ureq::post(TOKEN_ENDPOINT)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body)
        .map_err(|e| format!("token exchange failed: {e}"))?;

    response
        .into_json()
        .map_err(|e| format!("token response was not JSON: {e}"))
}

/// The whole native OAuth round trip: loopback listener, system browser, code
/// exchange. Returns Google's token response as it arrived.
///
/// PKCE values are generated by the frontend (WebCrypto) and passed in, so the
/// shell needs no crypto dependencies of its own.
async fn run_oauth(
    scope: &str,
    prompt: &str,
    offline: bool,
    login_hint: Option<String>,
    code_challenge: String,
    code_verifier: String,
    state: tauri::State<'_, OauthState>,
) -> Result<serde_json::Value, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let _ = tx.send(accept_code(&listener));
    });
    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "oauth state poisoned".to_string())?;
        *pending = Some(rx);
    }

    let client_id = CLIENT_ID.ok_or("CRNG_OAUTH_CLIENT_ID was not set at build time")?;
    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", client_id),
        ("redirect_uri", &redirect_uri),
        ("response_type", "code"),
        ("scope", scope),
        ("code_challenge", &code_challenge),
        ("code_challenge_method", "S256"),
        ("include_granted_scopes", "true"),
    ];
    if !prompt.is_empty() {
        params.push(("prompt", prompt));
    }
    // Offline access is what makes a grant outlive the browser session: Google
    // returns a refresh token, and renewing from it needs no window at all.
    if offline {
        params.push(("access_type", "offline"));
    }
    // Sending the signed-in address means the API grant lands on the same
    // account as the app, rather than on whichever one the browser happens to
    // have in front.
    if let Some(hint) = login_hint.as_deref() {
        params.push(("login_hint", hint));
    }
    let query = form_encode(&params);
    std::process::Command::new("open")
        .arg(format!("{AUTH_ENDPOINT}?{query}"))
        .spawn()
        .map_err(|e| format!("could not open the browser: {e}"))?;

    let rx = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "oauth state poisoned".to_string())?;
        pending
            .take()
            .ok_or_else(|| "sign-in was not started".to_string())?
    };

    tauri::async_runtime::spawn_blocking(move || {
        let code = rx
            .recv_timeout(REDIRECT_TIMEOUT)
            .map_err(|_| "timed out waiting for the browser redirect".to_string())??;
        exchange_code(&code, &code_verifier, &redirect_uri)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Signs in to the app. Returns a Google ID token for `signInWithCredential`.
#[tauri::command]
async fn google_sign_in(
    code_challenge: String,
    code_verifier: String,
    state: tauri::State<'_, OauthState>,
) -> Result<String, String> {
    let tokens = run_oauth(
        "openid email profile",
        "select_account",
        false,
        None,
        code_challenge,
        code_verifier,
        state,
    )
    .await?;
    tokens
        .get("id_token")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "token response carried no id_token".to_string())
}

/// Grants the app an API scope — Calendar, Drive — and returns the access token.
///
/// Google Identity Services does this in the browser with a popup, and Google
/// refuses its sign-in pages inside an embedded webview, so in the desktop shell
/// that popup opens onto a wall. The native flow is the same one sign-in already
/// uses: the system browser, and a loopback listener to catch the answer.
#[tauri::command]
async fn google_authorize(
    app: tauri::AppHandle,
    scope: String,
    code_challenge: String,
    code_verifier: String,
    login_hint: Option<String>,
    state: tauri::State<'_, OauthState>,
) -> Result<serde_json::Value, String> {
    let tokens = run_oauth(
        &scope,
        "consent",
        true,
        login_hint,
        code_challenge,
        code_verifier,
        state,
    )
    .await?;
    if let Some(refresh) = tokens.get("refresh_token").and_then(|v| v.as_str()) {
        // Best effort: a grant that cannot be remembered still works today, it
        // just asks again tomorrow.
        let _ = remember_refresh(&app, &scope, refresh);
    }
    Ok(tokens)
}

/// Renews an API token from the stored grant, with no browser and no click.
///
/// This is the half the browser cannot have: only a client holding the secret
/// may redeem a refresh token, and here the secret is compiled into the binary.
/// Without it the desktop app dropped its calendar connection every hour.
#[tauri::command]
async fn google_refresh(
    app: tauri::AppHandle,
    scope: String,
) -> Result<serde_json::Value, String> {
    let refresh = read_grants(&app)
        .and_then(|grants| find_grant(&grants, &scope))
        .ok_or_else(|| "no stored grant covers that scope".to_string())?;

    let client_id = CLIENT_ID.ok_or("CRNG_OAUTH_CLIENT_ID was not set at build time")?;
    let client_secret =
        CLIENT_SECRET.ok_or("CRNG_OAUTH_CLIENT_SECRET was not set at build time")?;

    // Off the main thread: this is a network round trip, and a synchronous
    // command would hold the window still for the whole of it.
    let result = tauri::async_runtime::spawn_blocking(move || {
        let body = form_encode(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh.as_str()),
            ("grant_type", "refresh_token"),
        ]);
        let response = ureq::post(TOKEN_ENDPOINT)
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send_string(&body)
            .map_err(|e| format!("refresh failed: {e}"))?;
        response
            .into_json::<serde_json::Value>()
            .map_err(|e| format!("token response was not JSON: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?;

    // A revoked or expired grant is not worth keeping: forgetting it is what
    // brings the connect button back rather than retrying forever.
    if result.is_err() {
        forget_grants(&app, &scope);
    }
    result
}

/// Drops the stored grant — what disconnecting means on this side.
#[tauri::command]
fn google_forget(app: tauri::AppHandle, scope: String) {
    forget_grants(&app, &scope);
}

// ── Where the refresh token lives ────────────────────────────────────────────
//
// On disk in the app's own data directory, never in the webview: the frontend
// asks for an access token and gets one, and the long-lived secret behind it
// stays on this side of the bridge.

fn grants_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    Ok(dir.join("google-grants.json"))
}

fn read_grants(app: &tauri::AppHandle) -> Option<serde_json::Map<String, serde_json::Value>> {
    let path = grants_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .as_object()
        .cloned()
}

fn write_grants(
    app: &tauri::AppHandle,
    grants: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let path = grants_path(app)?;
    let body = serde_json::to_string(grants).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("could not write {path:?}: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn remember_refresh(app: &tauri::AppHandle, scope: &str, refresh: &str) -> Result<(), String> {
    let mut grants = read_grants(app).unwrap_or_default();
    grants.insert(scope.to_string(), serde_json::Value::String(refresh.to_string()));
    write_grants(app, &grants)
}

/// A grant covers a request when it was issued for at least those scopes.
///
/// The calendar is read with one scope and written with two, so an exact match
/// on the string would miss a wider grant that already covers the narrower ask.
fn find_grant(grants: &serde_json::Map<String, serde_json::Value>, scope: &str) -> Option<String> {
    if let Some(exact) = grants.get(scope).and_then(|v| v.as_str()) {
        return Some(exact.to_string());
    }
    let want: HashSet<&str> = scope.split_whitespace().collect();
    grants.iter().find_map(|(granted, token)| {
        let have: HashSet<&str> = granted.split_whitespace().collect();
        if want.iter().all(|s| have.contains(s)) {
            token.as_str().map(str::to_string)
        } else {
            None
        }
    })
}

fn forget_grants(app: &tauri::AppHandle, scope: &str) {
    let Some(grants) = read_grants(app) else { return };
    let dropping: HashSet<&str> = scope.split_whitespace().collect();
    let kept: serde_json::Map<String, serde_json::Value> = grants
        .into_iter()
        .filter(|(granted, _)| !granted.split_whitespace().any(|s| dropping.contains(s)))
        .collect();
    let _ = write_grants(app, &kept);
}

/// The version this shell was built as, for the in-app update check.
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Hands a URL to the real browser. A webview cannot sign in to GitHub, and the
/// download lives behind that sign-in.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("https 주소만 열 수 있습니다".into());
    }
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open the browser: {e}"))
}

pub fn run() {
    tauri::Builder::default()
        // Updating in place, rather than sending somebody to a download page:
        // the shell is unsigned and the repository is private, so the bundle is
        // served from the app's own deployment and verified by its signature.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(OauthState::default())
        .invoke_handler(tauri::generate_handler![
            google_sign_in,
            google_authorize,
            google_refresh,
            google_forget,
            app_version,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes_in_auth_codes() {
        // Google codes contain '/' which arrives percent-encoded.
        assert_eq!(percent_decode("4%2F0AY0e-g7abc"), "4/0AY0e-g7abc");
        assert_eq!(percent_decode("plain-code_123"), "plain-code_123");
        assert_eq!(percent_decode("a+b"), "a b");
        // A trailing, truncated escape must not panic.
        assert_eq!(percent_decode("abc%"), "abc%");
    }

    #[test]
    fn extracts_the_requested_query_param() {
        let q = "code=4%2Fxyz&scope=email%20profile";
        assert_eq!(query_param(q, "code").as_deref(), Some("4/xyz"));
        assert_eq!(query_param(q, "scope").as_deref(), Some("email profile"));
        assert_eq!(query_param(q, "error"), None);
        assert_eq!(query_param("error=access_denied", "error").as_deref(), Some("access_denied"));
    }
}
