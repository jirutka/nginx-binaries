import nodeFetch, { FetchError, RequestInfo, RequestInit, Response } from 'node-fetch'


export async function fetch (url: RequestInfo, init?: RequestInit): Promise<Response> {
  const resp = await nodeFetch(url, init)
  if (resp.status !== 200) {
    throw new FetchError(
      `Unexpected response for ${url}: ${resp.status} ${resp.statusText}`,
      'invalid-response',
    )
  }
  return resp
}

export async function fetchJson (url: string, opts: RequestInit): Promise<object> {
  const resp = await fetch(url, opts)
  return await resp.json()
}
