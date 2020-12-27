import { assert } from 'chai'
import FS from 'fs'
import getPort from 'get-port'
import { after, before, test } from 'mocha'
import * as OS from 'os'
import { basename } from 'path'

import { createStaticServer, isFile, readJson } from './helpers'
import { IndexEntry, NginxBinary } from '../src'
import * as archName from '../src/internal/archName'
import { getCacheDir } from '../src/internal/cacheDir'


const fixtureRepoPath = `${__dirname}/fixtures/repo`
const hostArch = archName.normalize(OS.arch())
const hostOs = OS.platform()

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
