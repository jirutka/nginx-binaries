import AnyLogger from 'anylogger'
import FS from 'fs'
import { FetchError } from 'node-fetch'
import OS from 'os'
import path from 'path'
import semver from 'semver'

import { normalizeArch } from './internal/archName'
import { getCacheDir } from './internal/cacheDir'
import { downloadFile } from './internal/downloadFile'
import { fetchJson } from './internal/fetch'
import { bindAll, replaceProperty } from './internal/utils'


const log = AnyLogger('nginx-binaries')

const defaults = {
  cacheMaxAge: 8 * 60,  // minutes
  repoUrl: 'https://jirutka.github.io/nginx-binaries',
  timeout: 10_000,  // milliseconds
}

const defaultQuery: Omit<Required<Query>, 'version'> = {
  // macOS (darwin) on ARM can run x86_64 binaries.
  arch: OS.platform() === 'darwin' ? 'x86_64' : normalizeArch(OS.arch()) as any,
  os: OS.platform() as any,
  variant: '',
}

export interface IndexEntry {
  name: string
  version: string
  variant: string
  os: OS
  arch: Arch
  filename: string
  date: string
  size: number
  integrity: string
}

interface IndexFile {
  contents: IndexEntry[]
}

type OS = 'linux' | 'darwin' | 'win32'
type Arch = 'armv7' | 'arm' | 'aarch64' | 'arm64' | 'ppc64le' | 'x86_64' | 'x64'

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
  os?: OS
  /**
   * Specify target CPU architecture. Defaults to the host architecture.
   */
  arch?: Arch
}

const formatQuery = (query: Query) => JSON.stringify(query)
  .replace(/"/g, '')
  .replace(/,/g, ', ')
  .replace(/:/g, ': ')

const objKeys = <T> (obj: T) => Object.keys(obj) as Array<keyof T>

const queryFilter = (query: Query) => (meta: IndexEntry) => objKeys(query).every(key => {
  return query[key] === undefined ? false
    : key === 'version' ? semver.satisfies(meta[key], query[key]!)
    : key === 'arch' ? normalizeArch(query[key]!) === meta[key]
    : query[key] === meta[key]
})

function queryIndex (index: IndexFile, name: string, query: Query): IndexEntry[] {
  const fullQuery = { ...defaultQuery, ...query }

  log.debug(`Looking for ${name} binary matching ${formatQuery(fullQuery)}`)
  return index.contents
    .filter(x => x.name === name)
    .filter(queryFilter(fullQuery))
    .sort((a, b) => semver.rcompare(a.version, b.version))
}

async function getIndex (
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

export interface Downloader {
  /**
   * Path to the cache directory where the repository index and binaries are stored.
   *
   * Defaults to `.cache/nginx-binaries/` relative to the nearest writable `node_modules`
   * (nearest to `process.cwd()`) or `nginx-binaries/` in the system-preferred temp
   * directory.
   */
  cacheDir: string
  /**
   * Maximum age in minutes for the cached repository index in `cacheDir` to be
   * considered fresh. If the cached index is stale, the Downloader tries to refresh
   * it before reading.
   *
   * @default 480 (8 hours)
   */
  cacheMaxAge: number
  /**
   * URL of the repository with binaries.
   *
   * **Caution:** After changing `repoUrl`, you should delete old `index.json` in
   * `cacheDir` or disable index cache by setting `cacheMaxAge` to `0`.
   *
   * @default 'https://jirutka.github.io/nginx-binaries'
   */
  repoUrl: string
  /**
   * Fetch response timeout in milliseconds.
   *
   * @default 10000
   */
  timeout: number
  /**
   * Downloads a binary specified by `query` and stores it in the `cacheDir` or
   * in `destFilePath`, if provided. Returns path to the file.
   *
   * If the file already exists and the checksums match, it just returns its path.
   *
   * If multiple versions satisfies the version range, the one with highest
   * version number is selected.
   *
   * @param query A query that specifies what binary to download.
   * @param destFilePath An optional file path where to write the downloaded binary.
   * @return Path to the downloaded binary on the filesystem.
   * @throws {RangeError} if no matching binary is found.
   */
  download: (query: Query, destFilePath?: string) => Promise<string>
  /**
   * Returns metadata of available binaries that match the query.
   */
  search: (query: Query) => Promise<IndexEntry[]>
  /**
   * Returns all the available variants matching the query.
   */
  variants: (query?: Query) => Promise<string[]>
  /**
   * Returns all the available versions matching the query.
   */
  versions: (query?: Query) => Promise<string[]>
}

const createDownloader = (name: string): Downloader => bindAll({
  ...defaults,

  get cacheDir () {
    // Replace accessors with plain value (lazy initialization).
    return replaceProperty(this, 'cacheDir', getCacheDir('nginx-binaries'))
  },
  set cacheDir (dirpath) {
    this.cacheDir &&= dirpath
  },

  async download (query, destFilePath) {
    const [entry, ] = await this.search(query)
    if (!entry) {
      throw RangeError(`No ${name} binary found for ${formatQuery({ ...defaultQuery, ...query })}`)
    }
    destFilePath ??= path.join(this.cacheDir, entry.filename)
    const url = `${this.repoUrl}/${entry.filename}`

    return await downloadFile(url, entry.integrity, destFilePath, { timeout: this.timeout })
  },

  async search (query) {
    const index = await getIndex(this.repoUrl, this.cacheDir, this.timeout, this.cacheMaxAge)
    return queryIndex(index, name, query)
  },

  async variants (query) {
    return [...new Set((await this.search(query ?? {})).map(x => x.variant))]
  },

  async versions (query) {
    return [...new Set((await this.search(query ?? {})).map(x => x.version))]
  },
})

/**
 * Creates a Fetcher that provides **nginx** binary.
 */
export const NginxBinary = createDownloader('nginx')

/**
 * Creates a Fetcher that provides **njs** binary.
 */
export const NjsBinary = createDownloader('njs')
