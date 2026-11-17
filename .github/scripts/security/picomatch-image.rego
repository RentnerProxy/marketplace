package trivy

default ignore = false

# The scan script enables this policy only after verifying the installed parser.
ignore {
    input.VulnerabilityID == "CVE-2026-112366"
    input.PkgName == "picomatch"
    input.InstalledVersion == "4.0.7"
    input.PkgPath == "app/node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/package.json"
}
