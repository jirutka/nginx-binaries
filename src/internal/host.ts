import process from 'process'


export const hostArch = ({
  arm: 'armv7',
  arm64: 'aarch64',
  x32: 'x86',
  x64: 'x86_64',
} as Record<string, string>)[process.arch] || process.arch

export const hostOs = process.platform
