import * as FS from 'node:fs'
import * as http from 'node:http'
import * as OS from 'node:os'

import * as finalHandler from 'finalhandler'
import * as serveStatic from 'serve-static'


export function createStaticServer (root: string, options?: serveStatic.ServeStaticOptions): http.Server {
  const serve = serveStatic(root, options)

  return http.createServer((req, res) => {
    serve(req, res, finalHandler(req, res) as () => void)
  })
}

export function isFile (pathname: string): boolean {
  try {
    return FS.statSync(pathname).isFile()
  } catch {
    return false
  }
}

export const mktempd = (suffix: string) => FS.mkdtempSync(`${OS.tmpdir()}/${suffix}`)

export function readJson (filename: string): any {
  return JSON.parse(FS.readFileSync(filename, 'utf8'))
}
