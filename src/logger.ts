import type { BaseLogger as AnyLogger } from 'anylogger'
import type { Debugger } from 'debug'


const loggerName = 'nginx-binaries'
const logLevels = ['debug', 'info', 'warn', 'error'] as const

type Logger = Pick<Console, typeof logLevels[number]>

const noop = () => void 0

/** @internal */
// Initialized in `initialize()`.
export const log = {} as Logger

/**
 * Use the given logger. Undefined logging functions will be replaced with no-op.
 */
export function setLogger (logger: Partial<Logger>) {
  for (const level of logLevels) {
    log[level] = logger[level] || noop
  }
}

// NOTE: We cannot use dynamic `import()` because we don't have guarantee that
// it will be invoked *before* `setLogger` called from the application code.
(function initialize () {
  try {
    const anylogger = require('anylogger')(loggerName) as AnyLogger
    if (anylogger.enabledFor('error') != null) {
      for (const level of logLevels) {
        log[level] = (...args: any[]) => anylogger[level](...args)
      }
      return
    }
  } catch {}

  for (const level of logLevels) {
    log[level] = (...args: any[]) => console[level](`${loggerName}:`, ...args)
  }
  try {
    log.debug = require('debug')(loggerName) as Debugger
  } catch {
    log.debug = noop
  }
})()


/** @internal */
export const __testing = { loggerName, logLevels, noop }
