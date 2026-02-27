import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const targetDirs = [
  path.join(rootDir, "src", "app"),
  path.join(rootDir, "src", "components"),
];
const targetExtensions = new Set([".ts", ".tsx"]);

const disallowedPhrases = [
  "Operation failed.",
  "Accepted.",
  "Rejected.",
  "Revoke failed.",
  "Revoked.",
  "Remove friend failed.",
  "Removed friend.",
  "Please type the confirmation text.",
  "Failed to load friends.",
];

function collectFiles(dir, result) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, result);
      continue;
    }
    if (!targetExtensions.has(path.extname(entry.name))) continue;
    result.push(fullPath);
  }
}

const files = [];
targetDirs.forEach((dir) => collectFiles(dir, files));

const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");

  if (text.includes("\uFFFD")) {
    violations.push({
      file,
      reason: "包含替代字元 �（常見於編碼破壞）",
    });
  }

  const brokenQuestionLiterals =
    text.match(/["'`][^"'`\n]*\?{3,}[^"'`\n]*["'`]/g) ?? [];
  if (brokenQuestionLiterals.length > 0) {
    violations.push({
      file,
      reason: "偵測到可疑 ??? 字串（可能是亂碼）",
    });
  }

  for (const phrase of disallowedPhrases) {
    if (!text.includes(phrase)) continue;
    violations.push({
      file,
      reason: `偵測到應避免的英文 UI 字串：${phrase}`,
    });
  }
}

if (violations.length > 0) {
  console.error("語系檢查失敗：");
  for (const item of violations) {
    const relative = path.relative(rootDir, item.file).replaceAll("\\", "/");
    console.error(`- ${relative}: ${item.reason}`);
  }
  process.exit(1);
}

console.log("語系檢查通過：未偵測到亂碼或已列入黑名單的英文 UI 字串。");

