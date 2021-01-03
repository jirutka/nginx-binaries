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

export interface Downloader {
  /**
   * Maximum age in minutes for the cached repository index to be considered fresh.
   * If the cached index is stale, the Downloader tries to refresh it before reading.
   *
   * Index file `index.json` is stored in directory `.cache/nginx-binaries/` inside
   * the nearest writable `node_modules` directory or `nginx-binaries/` in the
   * system-preferred temp directory.
   *
   * @default 480 (8 hours)
   */
  cacheMaxAge: number
  /**
   * URL of the repository with binaries.
   *
   * **Caution:** After changing `repoUrl`, you should delete the old cached repository
   * index (if exists) or disable index cache by setting `cacheMaxAge` to `0`.
   * See `cacheMaxAge` for information about location of the cache.
   *
   * @default https://jirutka.github.io/nginx-binaries
   */
  repoUrl: string
  /**
   * Fetch response timeout in milliseconds.
   * @default 10000
   */
  timeout: number
  /**
   * Downloads the specified binary into `destDir` and returns its path.
   *
   * If the binary already exists in `destDir` and the checksums match,
   * it just returns its path.
   *
   * If multiple versions satisfies the version range, the one with highest
   * version number is selected.
   *
   * @param query A query that specifies what binary to download.
   * @param destDir A path to a directory where to store the downloaded binary.
   *   Defaults to `.cache/nginx-binaries/` in the nearest writable `node_modules`
   *   directory or `nginx-binaries/` in the system-preferred temp directory.
   * @return Path to the downloaded binary on the filesystem.
   * @throws {RangeError} if no matching binary is found.
   */
  download: (query: Query, destDir?: string) => Promise<string>
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

function createDownloader (name: string): Downloader {
  let { cacheMaxAge, repoUrl, timeout } = defaults
  let cacheDir: string | undefined

  const search = async (query: Query = {}): Promise<IndexEntry[]> => {
    cacheDir ??= getCacheDir('nginx-binaries')
    const index = await getIndex(repoUrl, cacheDir, timeout, cacheMaxAge)
    return queryIndex(index, name, query)
  }

  return {
    set repoUrl (url) { repoUrl = url },
    get repoUrl () { return repoUrl },

    set timeout (msec) { timeout = msec },
    get timeout () { return timeout },

    set cacheMaxAge (minutes: number) { cacheMaxAge = minutes },
    get cacheMaxAge () { return cacheMaxAge },

    async download (query, destDir) {
      cacheDir ??= getCacheDir('nginx-binaries')
      destDir ??= cacheDir

      const index = await getIndex(repoUrl, cacheDir, timeout, cacheMaxAge)
      const file = queryIndex(index, name, query)[0]
      if (!file) {
        throw RangeError(`No ${name} binary found for ${formatQuery({ ...defaultQuery, ...query })}`)
      }
      return await downloadFile(`${repoUrl}/${file.filename}`, file.integrity, destDir, { timeout })
    },
    async variants (query) {
      return [...new Set((await search(query)).map(x => x.variant))]
    },
    async versions (query) {
      return [...new Set((await search(query)).map(x => x.version))]
    },
    search,
  }
}

/**
 * Creates a Fetcher that provides **nginx** binary.
 */
export const NginxBinary = createDownloader('nginx')

/**
 * Creates a Fetcher that provides **njs** binary.
 */
export const NjsBinary = createDownloader('njs')
