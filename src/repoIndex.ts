import * as FS from 'node:fs'
import * as path from 'node:path'

import { FetchError } from 'node-fetch'
import * as semver from 'semver'

import { normalizeArch } from './internal/archName'
import { fetchJson } from './internal/fetch'
import { log } from './logger'


/**
 * Expected version of the index file.
 * Keep in sync with FORMAT_VERSION in scripts/generate-index!
 */
export const FORMAT_VERSION = 2

export interface IndexFile {
  formatVersion: number
  contents: IndexEntry[]
}

// NOTE: Keep in sync with API section in README.adoc (until I figure out how to generate it).
export interface IndexEntry {
  /**
   * Name of the program (`nginx` or `njs`).
   */
  name: string
  /**
   * Version of the program.
   */
  version: string
  /**
   * The build variant of the binary (e.g. `debug`).
   * An empty string indicates the default variant.
   */
  variant: string
  /**
   * OS platform for which this binary was built.
   */
  os: Platform
  /**
   * CPU architecture for which this binary was built.
   */
  arch: Arch
  /**
   * Full name of the binary file.
   */
  filename: string
  /**
   * Date and time (ISO-8601) at which the binary was built.
   */
  date: string
  /**
   * Size of the binary file in bytes.
   */
  size: number
  /**
   * Checksum of the binary file in format `<algorithm>:<hash>`.
   *
   * @example 'sha1:7336b675b26bd67fdda3db18c66fa7f64691e280'
   */
  checksum: string
  /**
   * A record of all libraries (or modules) statically linked into the binary
   * and the version number.
   *
   * @example
   * {
   *   'openssl': '1.1.1i-r0',
   *   'echo-nginx-module': '0.62',
   * }
   */
  bundledLibs: Record<string, string>
}

type Platform = 'linux' | 'darwin' | 'win32'
type Arch = 'armv7' | 'arm' | 'aarch64' | 'arm64' | 'ppc64le' | 'x86_64' | 'x64'

// NOTE: Keep in sync with API section in README.adoc (until I figure out how to generate it).
export interface Query {
  /**
   * Specify required version as exact version number or a SemVer version range.
   *
   * @example '1.8.0', '1.8.x', '^1.8.0'
   * @see https://github.com/npm/node-semver#ranges
   */
  version?: string
  /**
   * Specify build variant of the binary (e.g. `debug`).
   * Defaults to an empty string, i.e. the default variant.
   */
  variant?: string
  /**
   * Specify target OS. Defaults to the host OS.
   */
  os?: Platform
  /**
   * Specify target CPU architecture. Defaults to the host architecture.
   */
  arch?: Arch
}

export async function getIndex (
  repoUrl: string,
  cacheDir: string,
  fetchTimeout: number,
  cacheMaxAge: number,
): Promise<IndexFile> {
  const cachedIndexPath = path.join(cacheDir, 'index.json')

  const readCachedIndex = () => JSON.parse(FS.readFileSync(cachedIndexPath, 'utf8')) as IndexFile

  let isCached = false
  try {
    if (Date.now() - FS.statSync(cachedIndexPath).mtimeMs < cacheMaxAge * 60_000) {
      log.debug(`Using cached index ${cachedIndexPath}`)
      return readCachedIndex()
    }
    isCached = true
  } catch {
    // ignore
  }
  try {
    log.debug(`Fetching ${repoUrl}/index.json`)

    const index = await fetchJson(`${repoUrl}/index.json`, { timeout: fetchTimeout }) as IndexFile

    FS.mkdirSync(cacheDir, { recursive: true })
    FS.writeFileSync(cachedIndexPath, JSON.stringify(index, null, 2))

    return index

  } catch (err) {
    if (isCached && err instanceof FetchError && err.type === 'system') {
      log.warn('Failed to refresh repository index, using stale index')
      return readCachedIndex()
    }
    throw err
  }
}

export function queryIndex (index: IndexFile, name: string, query: Query): IndexEntry[] {
  log.debug(`Looking for ${name} binary matching ${formatQuery(query)}`)

  return index.contents
    .filter(x => x.name === name)
    .filter(queryFilter(query))
    .sort((a, b) => semver.rcompare(a.version, b.version))
}

export const formatQuery = (query: Query) => JSON.stringify(query)
  .replace(/"/g, '')
  .replace(/,/g, ', ')
  .replace(/:/g, ': ')

const queryFilter = (query: Query) => (meta: IndexEntry) => objKeys(query).every(key => {
  return query[key] === undefined ? false
    : key === 'version' ? semver.satisfies(meta[key], query[key]!)
    : key === 'arch' ? normalizeArch(query[key]!) === meta[key]
    : query[key] === meta[key]
})

const objKeys = <T extends {}> (obj: T) => Object.keys(obj) as Array<keyof T>
