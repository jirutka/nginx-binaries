import { strict as assert } from 'node:assert'

import type AnyLoggerModule from 'anylogger'
import debug from 'debug'
import { beforeEach, describe, test } from 'mocha'
import * as proxyquire from 'proxyquire'
import { reset, spy, verify } from 'ts-mockito'

import type * as LoggerModule from './logger'


type AnyLogger = typeof AnyLoggerModule
type LoggerModule = typeof LoggerModule

const logLevels = ['debug', 'info', 'warn', 'error'] as const

describe('logger', () => {
  let consoleSpy: typeof console

  beforeEach(() => {
    consoleSpy = spy(console)
  })
  afterEach(() => {
    reset(consoleSpy)
  })

  const usesConsoleLogger = ({ log, __testing: { loggerName, noop }}: LoggerModule) => {
    test('maps debug level to no-op, others to console[level]', () => {
      for (const level of logLevels.slice(1)) {
        log[level]('foo', 'bar')
        verify(consoleSpy[level](`${loggerName}:`, 'foo', 'bar')).once()
      }
      assert(log.debug === noop)
    })
  }

  const usesConsoleAndDebugLogger = ({ log, __testing: { loggerName }}: LoggerModule) => {
    test('maps debug level to the debug logger, others to console[level]', () => {
      for (const level of logLevels.slice(1)) {
        log[level]('foo', 'bar')
        verify(consoleSpy[level](`${loggerName}:`, 'foo', 'bar')).once()
      }

      assert((log.debug as debug.Debugger).extend === debug(loggerName).extend,
        'Expected log.debug to be from the debug library.')

      assert((log.debug as debug.Debugger).namespace === loggerName)
    })
  }

  describe('when anylogger is available', () => {

    describe('but no adapter is loaded', () => {
      const loggerModule = proxyquire<LoggerModule>('./logger', {
        anylogger: proxyquire<AnyLogger>('anylogger', {}),
        debug: null,
      })
      usesConsoleLogger(loggerModule)
    })

    describe('and has adapter', () => {
      test('maps all levels to anylogger', () => {
        const anylogger = proxyquire<AnyLogger>('anylogger', {})
        proxyquire('anylogger-debug', { anylogger })

        const { log, __testing: { loggerName } } = proxyquire<LoggerModule>('./logger', {
          anylogger,
          debug: null,
        })
        const loggerSpy = spy(anylogger(loggerName))

        for (const level of logLevels) {
          log[level]('foo', 'bar')
          verify(loggerSpy[level]('foo', 'bar')).once()
        }
      })
    })
  })

  describe('when anylogger is not available', () => {

    describe('and debug library is available', () => {
      const loggerModule = proxyquire<LoggerModule>('./logger', {
        anylogger: null,
      })
      usesConsoleAndDebugLogger(loggerModule)
    })

    describe('and debug library is not available', () => {
      const loggerModule = proxyquire<LoggerModule>('./logger', {
        anylogger: null,
        debug: null,
      })
      usesConsoleLogger(loggerModule)
    })
  })
})

test('setLogger', () => {
  const { log, setLogger, __testing: { noop } } = proxyquire<LoggerModule>('./logger', {})

  const logger = {
    warn: () => void 0,
    error: () => void 0,
  }
  setLogger(logger)

  for (const level of logLevels) {
    assert(log[level] === (logger as any)[level] || noop,
      `Expected log.${level} to be the provided logging function or no-op if not provided.`)
  }
})
