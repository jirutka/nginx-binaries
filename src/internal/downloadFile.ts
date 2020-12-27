import AnyLogger from 'anylogger'
import crypto from 'crypto'
import { createReadStream, createWriteStream, mkdirSync as mkdir } from 'fs'
import { RequestInit } from 'node-fetch'
import { basename, join as joinPath } from 'path'
import stream from 'stream'
import { promisify } from 'util'

import { fetch } from './fetch'


const log = AnyLogger('nginx-binaries')
const streamPipeline = promisify(stream.pipeline)

export async function downloadFile (
  url: string,
  integrity: string,
  destDir: string,
  fetchOpts?: RequestInit,
): Promise<string> {

  const filename = basename(url)
  const filepath = joinPath(destDir, filename)

  if (await checkFileChecksum(filepath, integrity)) {
    log.debug(`File ${filepath} already exists`)
    return filepath
  }

  const [hashAlg, expectedHash] = splitIntegrityValue(integrity)
  const hash = crypto.createHash(hashAlg)

  log.info(`Downloading ${url}...`)

  mkdir(destDir, { recursive: true })

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

async function checkFileChecksum (filepath: string, integrity: string): Promise<boolean> {
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

function splitIntegrityValue (integrity: string): [algorithm: string, value: string] {
  const [alg, value] = integrity.split('-', 2)
  if (!alg || !value) {
    throw RangeError(`Invalid integrity value: ${integrity}`)
  }
  return [alg, value]
}
