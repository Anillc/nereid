import { createWriteStream, promises as fsp, ReadStream, WriteStream } from 'fs'
import axios, { AxiosResponse } from 'axios'
import { Task } from '../task'
import { Source } from '..'
import { Nereid } from '../..'

export class HttpTask extends Task<null> {
  current = 0
  abort: AbortController
  stream: WriteStream
  constructor(
    public source: Source<null>,
    public composable: Nereid.Composable,
    public output: string,
    public url: string,
    public timeout: number,
  ) {
    super(source, composable, output)
  }

  _start() {
    this.abort = new AbortController()
    const headers: Record<string, string> = {}
    if (this.current !== 0) headers['Range'] = `bytes=${this.current}-`

    axios.get(this.url, {
      headers,
      timeout: this.timeout,
      signal: this.abort.signal,
      responseType: 'stream',
    }).then(async (response: AxiosResponse<ReadStream>) => {
      // continue with 206, restart with 200
      if (response.status === 200) {
        if (this.stream)
          await new Promise(resolve => this.stream.close(resolve))
        await fsp.rm(this.output, { force: true })
        this.stream = createWriteStream(this.output)
        this.current = 0
      }
      if (!this.stream) this.stream = createWriteStream(this.output)
      response.data.on('data', data => {
        if (typeof data === 'string') data = Buffer.from(data)
        this.stream.write(data)
        this.current += data.byteLength
      })
      response.data.on('end', () => {
        this.stream.end()
        this.done()
      })
      response.data.on('error', error => {
        this.failed(error)
      })
    }).catch(error => {
      this.failed(error)
    })
  }

  _pause() {
    this.abort?.abort()
  }

  _stop() {
    this.abort?.abort()
  }
}

export function createHttpSource(src: string, timeout: number, output: string): Source {
  const source: Source<null> = { src, fetchIndex, task }
  async function fetchIndex(index: string) {
    const { data }: AxiosResponse<Nereid.Index<null>> = await axios.get(`${src}/${index}`)
    return data
  }
  function task(composable: Nereid.Composable) {
    return new HttpTask(
      source, composable, `${output}/store/${composable.hash}`,
      `${src}/store/${composable.hash}`, timeout, 
    )
  }
  return source
}
