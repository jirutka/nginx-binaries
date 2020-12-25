import logger from 'anylogger'
import crypto from 'crypto'
import { promises as fs, createReadStream, createWriteStream } from 'fs'
import nodeFetch, { FetchError, RequestInfo, RequestInit, Response } from 'node-fetch'
import { basename, join as joinPath } from 'path'
import process from 'process'
import semver from 'semver'
import stream from 'stream'
import { promisify } from 'util'


interface IndexFile {
  contents: IndexEntry[]
}

type OS = 'linux'  // TODO: add more
type Arch = 'x86_64'  // TODO: add more

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

export interface Specifier {
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

export interface Fetcher {
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
  download: (spec: Specifier, destDir: string) => Promise<string>
  /**
   * Returns metadata of available binaries that match the specifier.
   */
  search: (spec: Specifier) => Promise<IndexEntry[]>
  /**
   * Returns all the available variants matching the specifier.
   */
  variants: (spec?: Specifier) => Promise<string[]>
  /**
   * Returns all the available versions matching the specifier.
   */
  versions: (spec?: Specifier) => Promise<string[]>
}

const defaults = {
  repoUrl: 'https://jirutka.github.io/nginx-binaries',
  timeout: 10_000,
}

const streamPipeline = promisify(stream.pipeline)
const log = logger('nginx-binaries')

const hostArch = ({
  arm: 'armv7',
  arm64: 'aarch64',
  x32: 'x86',
  x64: 'x86_64',
} as Record<string, string>)[process.arch] || process.arch

const hostOs = process.platform

const defaultSpec: Omit<Required<Specifier>, 'version'> = {
  arch: hostArch as any,
  os: hostOs as any,
  variant: '',
}

const objKeys = <T> (obj: T) => Object.keys(obj) as Array<keyof T>

function splitIntegrityValue (integrity: string): [algorithm: string, value: string] {
  const [alg, value] = integrity.split('-', 2)
  if (!alg || !value) {
    throw RangeError(`Invalid integrity value: ${integrity}`)
  }
  return [alg, value]
}

async function isFileWithChecksum (filepath: string, integrity: string): Promise<boolean> {
  const [hashAlg, expectedHash] = splitIntegrityValue(integrity)
  const hash = crypto.createHash(hashAlg)

  try {
    await streamPipeline(createReadStream(filepath), hash)
    return hash.digest('hex') === expectedHash

  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      return false
    }
    throw err
  }
}

async function fetch (url: RequestInfo, init?: RequestInit): Promise<Response> {
  const resp = await nodeFetch(url, init)
  if (resp.status !== 200) {
    throw new FetchError(`Unexpected response for ${url}: ${resp.status} ${resp.statusText}`, 'invalid-response')
  }
  return resp
}

async function downloadFile (url: string, integrity: string, destDir: string, fetchOpts?: RequestInit): Promise<string> {
  const filename = basename(url)
  const filepath = joinPath(destDir, filename)

  if (await isFileWithChecksum(filepath, integrity)) {
    log.debug(`File ${filepath} already exists`)
    return filepath
  }

  const [hashAlg, expectedHash] = splitIntegrityValue(integrity)
  const hash = crypto.createHash(hashAlg)

  log.info(`Downloading ${url}...`)

  await fs.mkdir(destDir, { recursive: true })

  const resp = await fetch(url, fetchOpts)

  await streamPipeline(
    resp.body.on('data', chunk => hash.update(chunk)),
    createWriteStream(filepath, { flags: 'w', mode: 0o0755 }),
  )

  if (hash.digest('hex') !== expectedHash) {
    throw Error(`File ${filename} is corrupted, ${hashAlg} checksum doesn't match!`)
  }
  log.debug(`File was saved in ${filepath}`)

  return filepath
}

async function fetchJson (url: string, opts: RequestInit): Promise<object> {
  log.debug(`Fetching ${url}...`)

  const resp = await fetch(url, opts)
  return await resp.json()
}

const formatSpec = (spec: Specifier) => JSON.stringify(spec)
  .replace(/"/g, '')
  .replace(/,/g, ', ')
  .replace(/:/g, ': ')

const specFilter = (spec: Specifier) => (meta: IndexEntry) => {
  const isSatisfied = (key: keyof Specifier) => spec[key] === undefined
    || (key === 'version' ? semver.satisfies(meta[key], spec[key]!) : spec[key] === meta[key])

  return objKeys(spec).every(isSatisfied)
}

function findBySpec (index: IndexFile, name: string, spec: Specifier): IndexEntry[] {
  const fullSpec = { ...defaultSpec, ...spec }

  log.debug(`Looking for ${name} binary matching ${formatSpec(fullSpec)}`)
  return index.contents
    .filter(x => x.name === name)
    .filter(specFilter(fullSpec))
    .sort((a, b) => semver.rcompare(a.version, b.version))
}

function createFetcher (name: string): Fetcher {
  let { repoUrl, timeout } = defaults
  let index: IndexFile | undefined

  const fetchIndex = async () => {
    return await fetchJson(`${repoUrl}/index.json`, { timeout }) as IndexFile
  }
  const search = async (spec: Specifier = {}): Promise<IndexEntry[]> => {
    index ??= await fetchIndex()
    return findBySpec(index, name, spec)
  }

  return {
    set repoUrl (url) { repoUrl = url; index = undefined },
    get repoUrl () { return repoUrl },

    set timeout (msec) { timeout = msec },
    get timeout () { return timeout },

    async download (spec, destDir) {
      index ??= await fetchIndex()

      const file = findBySpec(index, name, spec)[0]
      if (!file) {
        throw RangeError(`No ${name} binary found for ${formatSpec({ ...defaultSpec, ...spec })}`)
      }
      return await downloadFile(`${repoUrl}/${file.filename}`, file.integrity, destDir, { timeout })
    },
    async variants (spec) {
      return (await search(spec)).map(x => x.variant)
    },
    async versions (spec) {
      return (await search(spec)).map(x => x.version)
    },
    search,
  }
}

/**
 * Creates a Fetcher that provides **nginx** binary.
 */
export const NginxFetcher = createFetcher('nginx')

/**
 * Creates a Fetcher that provides **njs** binary.
 */
export const NjsFetcher = createFetcher('njs')
