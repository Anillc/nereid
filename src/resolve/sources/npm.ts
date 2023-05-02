
import { promises as fsp } from 'fs'
import { createGunzip } from 'zlib'
import axios from 'axios'
import tar from 'tar-stream'
import { Task } from '../task'
import { Source } from '..'
import { Nereid } from '../..'
import { DummyWriter } from '../../utils'

export class NpmTask extends Task<null> {
  abort: AbortController
  writer: DummyWriter
  constructor(
    public source: Source<null>,
    public composable: Nereid.Composable,
    public output: string,
    public fullname: string,
    public pkgname: string,
    public registry: string,
    public timeout: number,
  ) {
    super(source, composable, output)
  }

  _start() {
    this.abort = new AbortController()
    const writer = fetchNpmResource(
      this.fullname, this.pkgname, this.composable.hash,
      `0.0.0-${this.composable.hash}`,
      this.registry, this.timeout,
      this.abort.signal,
    )
    writer.then((writer) => {
      this.writer = writer
      return writer.promise
    }).then((buffer) => {
      return fsp.writeFile(this.output, buffer)
    }).then(() => {
      this.done()
    }).catch((error) => {
      this.writer = null
      this.failed(error)
    })
  }

  _pause() {
    this.abort?.abort()
  }

  _stop() {
    this.abort?.abort()
  }

  get current() {
    return this.writer?.count() || 0
  }
}

export function createNpmSource(src: string, url: URL, timeout: number, output: string): Source {
  // npm://package-name?registry=xxx
  const fullname = url.pathname ? `@${url.host}${url.pathname}` : url.host
  const pkgname = url.pathname ? url.pathname.slice(1) : url.host
  const registry = url.searchParams.get('registry') || 'https://registry.npmjs.com'
  const source: Source<null> = { src, fetchIndex, task }
  async function fetchIndex(index: string) {
    const versions = await fetchVersions(fullname, registry, timeout)
    if (versions.length === 0) throw new Error('index not found')
    const indexVersion = versions.find(version => /0\.0\.0-latest-(\d+)/.test(version))
    const writer = await fetchNpmResource(fullname, pkgname, index, indexVersion, registry, timeout)
    const buffer = await writer.promise
    return JSON.parse(buffer.toString())
  }
  function task(composable: Nereid.Composable) {
    return new NpmTask(
      source, composable,
      `${output}/store/${composable.hash}`,
      fullname, pkgname, registry, timeout,
    )
  }
  return source
}

async function fetchNpmResource(
  fullname: string,
  pkgname: string,
  filename: string,
  version: string,
  registry: string,
  timeout?: number,
  signal?: AbortSignal,
): Promise<DummyWriter> {
  const tarball = `${registry}/${fullname}/-/${pkgname}-${version}.tgz`
  const { data: stream } = await axios.get(tarball, { responseType: 'stream', signal, timeout })
  const writer = new DummyWriter()
  signal?.addEventListener('abort', () => {
    writer.reject(new Error('aborted'))
  })
  const extract = tar.extract()
  extract.on('entry', (headers, stream, next) => {
    if (headers.name !== `package/${filename}`) {
      stream.on('end', next)
      stream.resume()
      return
    }
    stream.on('end', () => {
      writer.end()
    })
    stream.pipe(writer)
  })
  stream.pipe(createGunzip()).pipe(extract)
  return writer
}

async function fetchVersions(name: string, registry: string, timeout?: number) {
  try {
    const { data } = await axios.get(`${registry}/${name}`, { timeout })
    return Object.keys(data.versions).reverse()
  } catch (error) {
    if (error?.code === 'E404') {
      return []
    }
    throw error
  }
}
