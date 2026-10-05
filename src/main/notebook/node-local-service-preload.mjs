/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { lstatSync, realpathSync } from 'node:fs'
import { Server } from 'node:http'
import { basename, dirname, isAbsolute, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// This is a declared HTTP transport adapter, not a network security boundary.
// The process sandbox must still deny all TCP and allow only this exact Unix socket.
const ERROR = 'OPEN_SCIENCE_SERVICE_ADAPTER_INVALID'
const fail = (message) => {
  throw Object.assign(new Error(`${ERROR}: ${message}`), { code: ERROR })
}

const moduleUrl = new URL(import.meta.url)
if (moduleUrl.protocol !== 'file:' || moduleUrl.search || moduleUrl.hash) {
  fail('load the adapter from its verified local file without URL parameters')
}
const modulePath = fileURLToPath(moduleUrl)
if (!isAbsolute(modulePath) || !lstatSync(modulePath).isFile()) {
  fail('adapter must be a regular local file')
}

const socketPath = process.env.OPEN_SCIENCE_SERVICE_SOCKET
const portText = process.env.OPEN_SCIENCE_SERVICE_PORT
if (
  process.platform === 'win32' ||
  typeof socketPath !== 'string' ||
  !isAbsolute(socketPath) ||
  normalize(socketPath) !== socketPath ||
  Buffer.byteLength(socketPath) > 103 ||
  [...socketPath].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  ) ||
  !/^[A-Za-z0-9._-]+\.sock$/u.test(basename(socketPath))
) {
  fail('provide a normalized absolute Unix socket path of at most 103 UTF-8 bytes')
}
if (typeof portText !== 'string' || !/^[1-9]\d{0,4}$/u.test(portText)) {
  fail('provide a canonical decimal logical port')
}
const logicalPort = Number(portText)
if (logicalPort < 1024 || logicalPort > 65535) fail('logical port must be 1024..65535')

const parent = dirname(socketPath)
const directory = lstatSync(parent)
if (
  !directory.isDirectory() ||
  (directory.mode & 0o077) !== 0 ||
  (typeof process.getuid === 'function' && directory.uid !== process.getuid()) ||
  realpathSync(parent) !== parent
) {
  fail('socket parent must be an existing private directory owned by this user without symlinks')
}
try {
  lstatSync(socketPath)
  fail('socket destination already exists')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const originalListen = Server.prototype.listen
let consumed = false
Server.prototype.listen = function (...args) {
  if (consumed) fail('only one service binding is supported per child process')
  let port
  let host
  let callback
  if (typeof args[0] === 'number' && (args.length === 2 || args.length === 3)) {
    ;[port, host, callback] = args
  } else if (
    args[0] !== null &&
    typeof args[0] === 'object' &&
    Object.getPrototypeOf(args[0]) === Object.prototype &&
    (args.length === 1 || args.length === 2) &&
    Object.keys(args[0]).length === 2 &&
    Object.hasOwn(args[0], 'port') &&
    Object.hasOwn(args[0], 'host')
  ) {
    ;({ port, host } = args[0])
    callback = args[1]
  } else {
    fail('supported listen forms are (port, host, callback?) and ({ port, host }, callback?)')
  }
  if (
    port !== logicalPort ||
    !['127.0.0.1', 'localhost'].includes(host) ||
    (callback !== undefined && typeof callback !== 'function')
  ) {
    fail('listen must use the declared logical port, loopback host and optional callback')
  }
  consumed = true
  return callback === undefined
    ? originalListen.call(this, socketPath)
    : originalListen.call(this, socketPath, callback)
}
