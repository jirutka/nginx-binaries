
const mapping = {
  arm: 'armv7',
  arm64: 'aarch64',
  x32: 'x86',
  x64: 'x86_64',
} as Record<string, string>

/**
 * Normalizes the given architecture name to an Alpine architecture name.
 */
export const normalizeArch = (arch: string): string => mapping[arch] || arch
