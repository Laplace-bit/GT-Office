export function bumpVersion(current, type) {
  const parts = current.split(".").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver: ${current}`)
  }

  const [major, minor, patch] = parts
  if (type === "major") return `${major + 1}.0.0`
  if (type === "minor") return `${major}.${minor + 1}.0`
  if (type === "patch") return `${major}.${minor}.${patch + 1}`
  throw new Error(`Invalid bump type: ${type}`)
}

export function resolveReleaseBaseTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return null
  }
  return tags[0] ?? null
}

export function applyReleaseVersionsToPackageLock(lockfile, version, workspacePaths = []) {
  if (!lockfile || typeof lockfile !== "object") {
    throw new Error("Invalid package-lock.json payload")
  }

  lockfile.version = version

  if (lockfile.packages && typeof lockfile.packages === "object") {
    if (lockfile.packages[""] && typeof lockfile.packages[""] === "object") {
      lockfile.packages[""].version = version
    }

    for (const workspacePath of workspacePaths) {
      const entry = lockfile.packages[workspacePath]
      if (entry && typeof entry === "object") {
        entry.version = version
      }
    }
  }

  return lockfile
}
