import { createDownloader } from './downloader'

export type { Downloader } from './downloader'
export type { IndexEntry, IndexFile } from './repoIndex'
export { setLogger } from './logger'

/**
 * Creates a Fetcher that provides **nginx** binary.
 */
export const NginxBinary = createDownloader('nginx')

/**
 * Creates a Fetcher that provides **njs** binary.
 */
export const NjsBinary = createDownloader('njs')
