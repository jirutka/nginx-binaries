import AnyLogger from 'anylogger'
import semver from 'semver'

import { downloadFile } from './internal/downloadFile'
import { fetchJson } from './internal/fetch'
import { hostArch, hostOs } from './internal/host'


const log = AnyLogger('nginx-binaries')

const defaults = {
  repoUrl: 'https://jirutka.github.io/nginx-binaries',
  timeout: 10_000,
}

const defaultQuery: Omit<Required<Query>, 'version'> = {
  arch: hostArch as any,
  os: hostOs as any,
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

type OS = 'linux'  // TODO: add more
type Arch = 'x86_64'  // TODO: add more

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
   * URL of the repository with binaries.
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
   * @throws `RangeError` if no matching binary is found.
   */
  download: (query: Query, destDir: string) => Promise<string>
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
  return query[key] === undefined || (
    key === 'version'
    ? semver.satisfies(meta[key], query[key]!)
    : query[key] === meta[key]
  )
})

function queryIndex (index: IndexFile, name: string, query: Query): IndexEntry[] {
  const fullQuery = { ...defaultQuery, ...query }

  log.debug(`Looking for ${name} binary matching ${formatQuery(fullQuery)}`)
  return index.contents
    .filter(x => x.name === name)
    .filter(queryFilter(fullQuery))
    .sort((a, b) => semver.rcompare(a.version, b.version))
}

function createDownloader (name: string): Downloader {
  let { repoUrl, timeout } = defaults
  let index: IndexFile | undefined

  const fetchIndex = async () => {
    log.debug(`Fetching ${repoUrl}/index.json...`)
    return await fetchJson(`${repoUrl}/index.json`, { timeout }) as IndexFile
  }
  const search = async (query: Query = {}): Promise<IndexEntry[]> => {
    index ??= await fetchIndex()
    return queryIndex(index, name, query)
  }

  return {
    set repoUrl (url) { repoUrl = url; index = undefined },
    get repoUrl () { return repoUrl },

    set timeout (msec) { timeout = msec },
    get timeout () { return timeout },

    async download (query, destDir) {
      index ??= await fetchIndex()

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
