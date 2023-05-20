import * as OS from 'node:os'
import * as path from 'node:path'

import { formatQuery, getIndex, queryIndex, FORMAT_VERSION, IndexEntry, Query } from './repoIndex'
import { normalizeArch } from './internal/archName'
import { getCacheDir } from './internal/cacheDir'
import { downloadFile } from './internal/downloadFile'
import { bindAll, replaceProperty } from './internal/utils'


const defaultQuery: Omit<Required<Query>, 'version'> = {
  // macOS (darwin) on ARM can run x86_64 binaries.
  arch: OS.platform() === 'darwin' ? 'x86_64' : normalizeArch(OS.arch()) as any,
  os: OS.platform() as any,
  variant: '',
}

// NOTE: Keep in sync with API section in README.adoc (until I figure out how to generate it).
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

export const createDownloader = (name: string): Downloader => bindAll({
  cacheMaxAge: 8 * 60,  // minutes
  repoUrl: 'https://jirutka.github.io/nginx-binaries',
  timeout: 10_000,  // milliseconds

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

    return await downloadFile(url, entry.checksum, destFilePath, { timeout: this.timeout })
  },

  async search (query) {
    const index = await getIndex(this.repoUrl, this.cacheDir, this.timeout, this.cacheMaxAge)
    // TODO: Move to getIndex()
    if (index.formatVersion !== FORMAT_VERSION) {
      throw Error(`Index format version mismatch, clean cache and update nginx-binaries package`)
    }
    return queryIndex(index, name, { ...defaultQuery, ...query })
  },

  async variants (query) {
    return [...new Set((await this.search(query ?? {})).map(x => x.variant))]
  },

  async versions (query) {
    return [...new Set((await this.search(query ?? {})).map(x => x.version))]
  },
})
