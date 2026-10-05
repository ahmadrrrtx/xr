/*
 * Phase 10 — offline scaffolds (brief: NO npm/bun install during scaffold).
 *
 * Every template is a handful of hand-written files created under the new
 * workspace folder. The web template deliberately leaves a "run bun install"
 * README note instead of running package-manager network calls.
 */
use std::fs;
use std::path::Path;

/// `template_id` ∈ web | python | research | custom (git/scratch handled
/// elsewhere: clone / empty folder). Returns the relative file list written.
pub fn scaffold(path: &str, template_id: &str, name: &str) -> Result<Vec<String>, String> {
    let root = Path::new(path);
    fs::create_dir_all(root)
        .map_err(|e| format!("create {path}: {e}"))?;

    match template_id {
        "web" => {
            write(root, "package.json", &web_package(name));
            write(root, "vite.config.ts", WEB_VITE);
            write(root, "index.html", WEB_INDEX);
            write(root, "src/main.tsx", WEB_MAIN);
            write(root, "src/App.tsx", &web_app(name));
            write(root, "src/index.css", WEB_CSS);
            write(root, "README.md", &web_readme(name));
        }
        "python" => {
            write(root, "main.py", &python_main(name));
            write(root, "requirements.txt", "requests>=2.32\n");
            write(root, "README.md", &python_readme(name));
            write(root, ".gitignore", PY_IGNORE);
        }
        "research" => {
            fs::create_dir_all(root.join("sources"))
                .map_err(|e| e.to_string())?;
            fs::create_dir_all(root.join("notes"))
                .map_err(|e| e.to_string())?;
            write(root, "outline.md", &research_outline(name));
            write(root, "README.md", &research_readme(name));
            write(&root.join("sources"), "README.md", "Collected sources live here — drop links, PDFs, or notes as you go.\n");
            write(&root.join("notes"), "README.md", "Loose notes: findings, quotes, open questions.\n");
        }
        "custom" | "blank" => {
            write(root, "README.md", &custom_readme(name));
        }
        other => {
            return Err(format!("no scaffold for template '{other}'"));
        }
    }
    Ok(list_files(root))
}

fn write(dir: &Path, rel: &str, content: &str) {
    let p = dir.join(rel);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(p, content);
}

fn list_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.flatten() {
                let p = e.path();
                let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().to_string();
                if p.is_dir() {
                    walk(&p, root, out);
                } else {
                    out.push(rel);
                }
            }
        }
    }
    walk(root, root, &mut out);
    out.sort();
    out
}

// ── web ────────────────────────────────────────────────────────────────────

fn web_package(name: &str) -> String {
    format!(
        r#"{{
  "name": "{slug}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {{
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }},
  "dependencies": {{
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }},
  "devDependencies": {{
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0"
  }}
}}
"#,
        slug = slugify(name)
    )
}

const WEB_VITE: &str = r#"import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
"#;

const WEB_INDEX: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#;

const WEB_MAIN: &str = r#"import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"#;

fn web_app(name: &str) -> String {
    format!(
        r#"export default function App() {{
  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, minHeight: '100vh' }}>
      <h1>{name}</h1>
      <p>Scaffolded by XR · Phase 10. Run <code>bun dev</code> after installing dependencies.</p>
    </main>
  );
}}
"#
    )
}

const WEB_CSS: &str = "body {\n  margin: 0;\n}\n";

fn web_readme(name: &str) -> String {
    format!(
        "# {name}\n\nWeb workspace (Vite + React + TypeScript).\n\n## Getting started\n\n```\nrun bun install to install dependencies\nbun dev\n```\n"
    )
}

// ── python ─────────────────────────────────────────────────────────────────

fn python_main(name: &str) -> String {
    format!(
        r#""""{name} — entry point."""


def main() -> None:
    print("Hello from {name}!")


if __name__ == "__main__":
    main()
"#
    )
}

fn python_readme(name: &str) -> String {
    format!(
        "# {name}\n\nPython workspace.\n\n```\npython -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython main.py\n```\n"
    )
}

const PY_IGNORE: &str = ".venv/\n__pycache__/\n*.pyc\n";

// ── research ───────────────────────────────────────────────────────────────

fn research_outline(name: &str) -> String {
    format!("# {name} — outline\n\n- I. Opening question\n- II. What we know so far\n- III. Gaps\n- IV. Draft answer\n")
}

fn research_readme(name: &str) -> String {
    format!("# {name}\n\nResearch workspace: `sources/` for material, `notes/` for findings, `outline.md` for the shape of the answer.\n")
}

// ── custom ─────────────────────────────────────────────────────────────────

fn custom_readme(name: &str) -> String {
    format!("# {name}\n\nNew workspace — a blank folder. Add what you need.\n")
}

pub fn slugify(name: &str) -> String {
    let out: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect();
    out.split('-').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-")
}
