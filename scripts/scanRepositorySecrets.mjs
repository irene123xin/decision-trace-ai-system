import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([".git", "node_modules", ".next", ".pnpm-store", ".npm-cache", "coverage", "out"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".sql", ".css", ".yml", ".yaml", ".toml", ".txt", ".csv", ".example", ".gitignore"]);
const rules = [
  ["gemini_api_key", /AIza[0-9A-Za-z_-]{30,}/],
  ["supabase_key", /sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}/],
  ["jwt_or_service_role_key", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["database_password_url", /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["hardcoded_sensitive_assignment", /(?:GEMINI_API_KEY|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|RESEARCHER_PIN|RESEARCHER_ACCESS_PIN|RESEARCHER_COOKIE_SECRET|DATABASE_URL)\s*[:=]\s*["'][^"'\s]{4,}["']/],
  ["authorization_literal", /Authorization\s*:\s*["']Bearer\s+[A-Za-z0-9._-]{12,}["']/i],
];
const findings = [];

function excludedEnvironmentFile(name) {
  return name === ".env" || name === ".env.local" || /^\.env.*\.local$/.test(name);
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    const projectPath = relative(root, absolutePath);
    if (entry.isDirectory()) { walk(absolutePath); continue; }
    if (excludedEnvironmentFile(entry.name)) continue;
    if (/(?:credentials|service[-_]?account|private[-_]?key)\.(?:json|pem|key)$/i.test(entry.name)) {
      findings.push({ file: projectPath, line: null, category: "sensitive_filename" });
    }
    if (!textExtensions.has(extname(entry.name)) && entry.name !== ".gitignore" && entry.name !== ".env.example") continue;
    let source;
    try { source = readFileSync(absolutePath, "utf8"); } catch { continue; }
    source.split(/\r?\n/).forEach((line, index) => {
      for (const [category, pattern] of rules) {
        if (pattern.test(line)) findings.push({ file: projectPath, line: index + 1, category });
      }
    });
  }
}

walk(root);
const reviewed = findings.map((finding) => ({
  ...finding,
  disposition: finding.file === "tests/researchDataExportIntegrity.test.mjs" && finding.line === 158
    ? "intentional_redaction_test_fixture"
    : "review_required",
}));
const clean = reviewed.every((finding) => finding.disposition === "intentional_redaction_test_fixture");
console.log(JSON.stringify({ status: clean ? "clean_with_test_fixture" : "review_required", findings: reviewed }, null, 2));
if (!clean) process.exitCode = 2;
