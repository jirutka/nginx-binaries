import * as OS from 'node:os'

const mapping = {
  arm: 'armv7',
  arm64: 'aarch64',
  x32: 'x86',
  x64: 'x86_64',
} as Record<string, string>

/**
 * Normalizes the given architecture name to an Alpine architecture name or
 * macOS architecture name.
 */
export function normalizeArch (arch: string): string {
  if (arch === 'arm64' && OS.platform() === 'darwin') {
    return arch
  }
  return mapping[arch] || arch
}
