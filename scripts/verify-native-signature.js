import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { verifyMacRelease, notarizeMac } from "../tinybuild/notarization.js";
const execute = promisify(execFile);

export function signatureCommand(filename, platform = process.platform) {
  if (platform === "win32")
    return {
      executable: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; $signature = Get-AuthenticodeSignature -LiteralPath $env:TINYBUILD_VERIFY_FILE; if ($signature.Status -ne 'Valid') { Write-Error ('Signature check failed: ' + $signature.Status); exit 1 }; $signature.SignerCertificate.Thumbprint",
      ],
    };
  if (platform === "darwin")
    return {
      executable: "codesign",
      args: ["--verify", "--deep", "--strict", "--verbose=2", filename],
    };
  return { executable: "gpg", args: ["--verify", filename + ".asc", filename] };
}

export async function verifyNativeSignature(
  filename,
  { platform = process.platform, run = execute } = {},
) {
  filename = path.resolve(filename);
  const command = signatureCommand(filename, platform);
  await run(command.executable, command.args, {
    env: {
      ...process.env,
      TINYBUILD_VERIFY_FILE: filename,
      // PowerShell 7's inherited module path must not make Windows PowerShell
      // load an incompatible version of its built-in security cmdlets.
      ...(platform === "win32"
        ? {
            PSModulePath: path.win32.join(
              process.env.SystemRoot || "C:\\Windows",
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "Modules",
            ),
          }
        : {}),
    },
    windowsHide: true,
    timeout: 60000,
  });
  return { file: filename, platform, verified: true };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const value = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const file = args.find(
    (arg, index) =>
      !arg.startsWith("--") &&
      !["--archive", "--profile"].includes(args[index - 1]),
  );
  if (!file)
    throw new Error(
      "Pass the signed .exe/.app file, or a file with a detached .asc GPG signature on Linux",
    );
  console.log(
    JSON.stringify(
      args.includes("--submit")
        ? await notarizeMac({
            archive: value("--archive"),
            application: file,
            keychainProfile: value("--profile"),
            dryRun: args.includes("--dryRun"),
          })
        : args.includes("--notarized")
          ? await verifyMacRelease(file, { dryRun: args.includes("--dryRun") })
          : await verifyNativeSignature(file),
      null,
      2,
    ),
  );
}
