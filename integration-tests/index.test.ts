import * as FS from 'node:fs'
import * as OS from 'node:os'
import { basename } from 'node:path'

import { assert } from 'chai'
import * as getPort from 'get-port'
import { after, before, test } from 'mocha'

import { createStaticServer, isFile, readJson } from './helpers'
import { IndexEntry, NginxBinary } from '../src'
import { normalizeArch } from '../src/internal/archName'
import { getCacheDir } from '../src/internal/cacheDir'


const fixtureRepoPath = `${__dirname}/fixtures/repo`
const hostOs = OS.platform()
// macOS (darwin) on ARM can run x86_64 binaries.
const hostArch = hostOs === 'darwin' ? 'x86_64' : normalizeArch(OS.arch())

const server = createStaticServer(fixtureRepoPath)

before(async () => {
  const host = '127.0.0.1'
  const port = await getPort({ host })

  server.listen(port, host)

  NginxBinary.repoUrl = `http://${host}:${port}/`
})

after(() => {
  server.close()
  FS.rmSync(getCacheDir('nginx-binaries'), { force: true, recursive: true })
})

describe('NginxBinary', () => {

  test('.download', async () => {
    const result = await NginxBinary.download({ version: '1.18.0', os: 'linux', arch: 'x86_64' })

    assert(isFile(result), 'Expected the returned path to be a file.')

    const actualFile = FS.readFileSync(result)
    const expectedFile = FS.readFileSync(`${fixtureRepoPath}/${basename(result)}`)

    assert(Buffer.compare(actualFile, expectedFile) === 0,
      'Expected the correct file to be fetched.')
  })

  test('.search', async () => {
    const indexJson = readJson(`${fixtureRepoPath}/index.json`).contents as IndexEntry[]
    const expected = indexJson
      .filter(e => e.name === 'nginx' && e.arch === hostArch && e.os === hostOs)

    assert.sameDeepMembers(await NginxBinary.search({ version: '>=1.18.0' }), expected)
  })

  test('.variants', async () => {
    assert.deepEqual(await NginxBinary.variants(), [''])
  })

  test('.versions', async () => {
    assert.deepEqual(await NginxBinary.versions(), ['1.19.5', '1.18.0'])
  })
})
