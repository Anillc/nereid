
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
    public url: string,
    public timeout: number,
    public registry: string,
    public org: string,
  ) {
    super(source, composable, output)
  }

  _start() {
    this.abort = new AbortController()
    const writer = fetchNpmResource(
      this.registry, this.org, this.composable.hash,
      this.timeout, this.abort.signal,
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

export function createNpmSource(src: string, timeout: number, output: string): Source {
  // npm://org?registry=xxx
  const url = new URL(src)
  const org = url.host
  const registry = url.searchParams.get('registry') || 'https://registry.npmjs.com'
  const source: Source<null> = { src, fetchIndex, task }
  async function fetchIndex(index: string) {
    const writer = await fetchNpmResource(registry, org, index, timeout)
    const buffer = await writer.promise
    return JSON.parse(buffer.toString())
  }
  function task(composable: Nereid.Composable) {
    return new NpmTask(
      source, composable, `${output}/store/${composable.hash}`,
      `${src}/store/${composable.hash}`, timeout, registry, org,
    )
  }
  return source
}

async function fetchNpmResource(
  registry: string,
  org: string,
  name: string,
  timeout?: number,
  signal?: AbortSignal,
): Promise<DummyWriter> {
  const { data } = await axios.get(`${registry}/@${org}/${name}`, { signal, timeout })
  const tarball: string = (Object.values(data.versions).at(-1) as any).dist.tarball
  const { data: stream } = await axios.get(tarball, { responseType: 'stream', signal, timeout })
  const writer = new DummyWriter()
  signal?.addEventListener('abort', () => {
    writer.reject(new Error('aborted'))
  })
  const extract = tar.extract()
  extract.on('entry', (headers, stream, next) => {
    if (headers.name !== `package/${name}`) {
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
