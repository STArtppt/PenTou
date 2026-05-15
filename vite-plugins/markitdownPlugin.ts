import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

export const DOC_IMPORT_MAX_FILE_SIZE = 30 * 1024 * 1024;
export const DOC_IMPORT_MAX_FILE_COUNT = 30;
export const DOC_IMPORT_MAX_TOTAL_SIZE = 150 * 1024 * 1024;

export const DOC_IMPORT_SUPPORTED_EXTENSIONS = new Set([
  ".md", ".txt", ".pdf", ".docx", ".pptx",
  ".xlsx", ".csv", ".json", ".html", ".xml",
]);

const MARKITDOWN_MIN_PYTHON_MAJOR = 3;
const MARKITDOWN_MIN_PYTHON_MINOR = 10;

const PYTHON_CANDIDATES = ["python3.12", "python3.11", "python3.10", "python3", "python"];

const OPTIONAL_FEATURES = [
  { extension: ".pdf", feature: "pdf", modules: ["pdfminer", "pdfplumber"] },
  { extension: ".docx", feature: "docx", modules: ["mammoth"] },
  { extension: ".pptx", feature: "pptx", modules: ["pptx"] },
  { extension: ".xlsx", feature: "xlsx", modules: ["pandas", "openpyxl"] },
];

export interface MarkitdownStatus {
  installed: boolean;
  command?: string;
  args?: string[];
  pythonCommand?: string;
  commandSource: string;
  version: string;
  installHints: string[];
  error: string;
  missingExtensions?: Array<{ extension: string; modules: string[] }>;
}

let cachedStatus: { result: MarkitdownStatus; at: number } | null = null;
const TTL = 30_000;

export function getMarkitdownStatusCached(force = false): MarkitdownStatus {
  if (!force && cachedStatus && Date.now() - cachedStatus.at < TTL) {
    return cachedStatus.result;
  }
  const result = resolveMarkitdownCommand();
  cachedStatus = { result, at: Date.now() };
  return result;
}

function parsePythonVersion(str: string): { major: number; minor: number } | null {
  const m = str.match(/Python\s+(\d+)\.(\d+)/i);
  if (!m) return null;
  return { major: parseInt(m[1]), minor: parseInt(m[2]) };
}

function isVersionValid(v: { major: number; minor: number }): boolean {
  if (v.major > MARKITDOWN_MIN_PYTHON_MAJOR) return true;
  return v.major === MARKITDOWN_MIN_PYTHON_MAJOR && v.minor >= MARKITDOWN_MIN_PYTHON_MINOR;
}

function probeOptionalDeps(pythonCmd: string): {
  allPresent: boolean;
  missingExtensions: Array<{ extension: string; modules: string[] }>;
  installHints: string[];
} {
  const probeScript = OPTIONAL_FEATURES.flatMap((f) =>
    f.modules.map(
      (m) => `
try:
    import ${m}
    print("ok:${m}")
except ImportError:
    print("missing:${m}")`
    )
  ).join("\n");

  const result = spawnSync(pythonCmd, ["-c", probeScript], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const output = (result.stdout || "").trim();

  const missingExtensions: Array<{ extension: string; modules: string[] }> = [];
  for (const feature of OPTIONAL_FEATURES) {
    const missingMods = feature.modules.filter((m) => output.includes(`missing:${m}`));
    if (missingMods.length > 0) {
      missingExtensions.push({ extension: feature.extension, modules: missingMods });
    }
  }

  const allPresent = missingExtensions.length === 0;
  const installHints: string[] = [];
  if (!allPresent) {
    const features = OPTIONAL_FEATURES
      .filter((f) => missingExtensions.some((me) => me.extension === f.extension))
      .map((f) => f.feature);
    installHints.push(`${pythonCmd} -m pip install -U 'markitdown[${features.join(",")}]'`);
  }
  return { allPresent, missingExtensions, installHints };
}

function tryGetPythonFromMarkitdown(): string | null {
  try {
    const which = spawnSync("which", ["markitdown"], { encoding: "utf8", timeout: 5_000 });
    if (which.error || which.status !== 0) return null;
    const p = (which.stdout || "").trim();
    if (!p) return null;
    const firstLine = fs.readFileSync(p, "utf8").split("\n")[0];
    if (firstLine.startsWith("#!")) {
      const py = firstLine.slice(2).trim().split(" ")[0];
      if (py.includes("python")) return py;
    }
  } catch {}
  return null;
}

function resolveMarkitdownCommand(): MarkitdownStatus {
  // Step 1: direct `markitdown` command
  const direct = spawnSync("markitdown", ["--version"], { encoding: "utf8", timeout: 8_000 });
  if (!direct.error && direct.status === 0) {
    const version = (direct.stdout || direct.stderr || "").trim();
    const pythonForProbe = tryGetPythonFromMarkitdown() || "python3";
    const probe = probeOptionalDeps(pythonForProbe);
    if (probe.allPresent) {
      return {
        installed: true,
        command: "markitdown",
        args: [],
        commandSource: "markitdown",
        version,
        installHints: [],
        error: "",
      };
    }
    return {
      installed: false,
      command: "markitdown",
      args: [],
      commandSource: "markitdown",
      version,
      installHints: probe.installHints,
      error: `已安装但依赖不完整：${probe.missingExtensions.map((me) => `${me.extension}（缺少：${me.modules.join("，")}）`).join("；")}`,
      missingExtensions: probe.missingExtensions,
    };
  }

  // Step 2: try python candidates
  const detectedPythons: string[] = [];
  let sawLegacyPackage = false;
  let sawModuleMissing = false;
  let foundCmd: string | null = null;
  let foundPython: string | null = null;
  let foundVersion = "";

  for (const pyCmd of PYTHON_CANDIDATES) {
    const pyVer = spawnSync(pyCmd, ["--version"], { encoding: "utf8", timeout: 8_000 });
    if (pyVer.error || pyVer.status !== 0) continue;
    const pyVerStr = (pyVer.stdout || pyVer.stderr || "").trim();
    const parsed = parsePythonVersion(pyVerStr);
    if (!parsed) continue;
    detectedPythons.push(`${pyCmd} (${pyVerStr})`);
    if (!isVersionValid(parsed)) continue;

    const modResult = spawnSync(pyCmd, ["-m", "markitdown", "--version"], {
      encoding: "utf8",
      timeout: 8_000,
    });
    if (!modResult.error && modResult.status === 0) {
      foundVersion = (modResult.stdout || modResult.stderr || "").trim();
      foundCmd = pyCmd;
      foundPython = pyCmd;
      break;
    }
    const stderr = (modResult.stderr || "").trim();
    if (stderr.includes("cannot be directly executed")) sawLegacyPackage = true;
    else if (stderr.includes("No module named markitdown")) sawModuleMissing = true;
  }

  if (foundCmd && foundPython) {
    const probe = probeOptionalDeps(foundPython);
    const commandSource = `${foundCmd} -m markitdown`;
    if (probe.allPresent) {
      return {
        installed: true,
        command: foundCmd,
        args: ["-m", "markitdown"],
        pythonCommand: foundPython,
        commandSource,
        version: foundVersion,
        installHints: [],
        error: "",
      };
    }
    return {
      installed: false,
      command: foundCmd,
      args: ["-m", "markitdown"],
      pythonCommand: foundPython,
      commandSource,
      version: foundVersion,
      installHints: probe.installHints,
      error: `已安装但依赖不完整：${probe.missingExtensions.map((me) => `${me.extension}（缺少：${me.modules.join("，")}）`).join("；")}`,
      missingExtensions: probe.missingExtensions,
    };
  }

  // All failed — diagnose
  const validPythons = detectedPythons.filter((p) => {
    const m = p.match(/Python\s+(\d+)\.(\d+)/i);
    if (!m) return false;
    return isVersionValid({ major: parseInt(m[1]), minor: parseInt(m[2]) });
  });

  let error = "";
  let installHints: string[] = [];

  if (detectedPythons.length === 0) {
    error = "markitdown 未安装，且未检测到 Python 环境";
    installHints = ["brew install python@3.11", "python3.11 -m pip install -U 'markitdown[pdf,docx,pptx,xlsx]'"];
  } else if (validPythons.length === 0) {
    error = `Python 版本过低（需要 >= 3.10），当前检测到：${detectedPythons.join("；")}`;
    installHints = ["brew install python@3.11"];
  } else if (sawLegacyPackage) {
    error = "检测到旧版 markitdown（无 CLI 入口），请重装最新版";
    installHints = ["python3 -m pip install -U 'markitdown[pdf,docx,pptx,xlsx]'"];
  } else if (sawModuleMissing) {
    const py = validPythons[0]?.split(" ")[0] || "python3";
    error = `未在 ${py} 环境中检测到 markitdown，请先安装`;
    installHints = [`${py} -m pip install -U 'markitdown[pdf,docx,pptx,xlsx]'`];
  } else {
    error = "markitdown 不可用，请安装后重试";
    installHints = ["python3.11 -m pip install -U 'markitdown[pdf,docx,pptx,xlsx]'"];
  }

  return {
    installed: false,
    commandSource: "unavailable",
    version: "",
    installHints,
    error,
  };
}

export function convertFileToMarkdownWithMarkitdown(params: {
  command: string;
  args: string[];
  sourcePath: string;
}): { success: true; content: string } | { success: false; error: string } {
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), "pentou-doc-import-"));
  const outputPath = path.join(tempDir, "output.md");
  try {
    const result = spawnSync(
      params.command,
      [...params.args, "--keep-data-uris", params.sourcePath, "-o", outputPath],
      { encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 * 20 },
    );
    if (result.error) return { success: false, error: result.error.message };
    if (result.status !== 0) {
      const stderr = String(result.stderr || "").trim();
      const stdout = String(result.stdout || "").trim();
      return { success: false, error: `markitdown failed: ${stderr || stdout || `exit ${result.status}`}` };
    }
    if (!fs.existsSync(outputPath)) {
      return { success: false, error: "markitdown did not produce output file" };
    }
    return { success: true, content: fs.readFileSync(outputPath, "utf8") };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
