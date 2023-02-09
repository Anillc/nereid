import { createWriteStream, promises as fsp, ReadStream, WriteStream } from 'fs'
import axios, { AxiosResponse } from 'axios'
import { Source, Task } from '.'
import { Nereid } from '..'

export class HttpTask implements Task {
  status: 'downloading' | 'pause' | 'failed' | 'done'
  current = 0
  abort: AbortController
  stream: WriteStream
  error: Error
  future: Promise<Task>
  resolve: Function
  constructor(
    public source: Source,
    public url: string,
    public composable: Nereid.Composable,
    public timeout: number,
    public output: string,
  ) {}

  get downloaded() {
    return Math.floor(this.current / this.composable.size)
  }

  async promise() {
    if (!this.future) {
      this.status = 'downloading'
      this.future = new Promise(resolve => this.resolve = resolve)
        .then(() => this.resolve = undefined)
      try {
        this.abort = new AbortController()
        const headers: Record<string, string> = {}
        if (this.current !== 0) headers['Range'] = `bytes=${this.current}-`
        const response: AxiosResponse<ReadStream> = await axios.get(this.url, {
          signal: this.abort.signal,
          responseType: 'stream',
        })
        // continue with 206, restart with 200
        if (response.status === 200) {
          await new Promise(resolve => this.stream.close(resolve))
          await fsp.rm(this.output)
          this.stream = createWriteStream(this.output)
        }
        if (!this.stream) this.stream = createWriteStream(this.output)
        response.data.on('data', data => {
          if (typeof data === 'string') data = Buffer.from(data)
          this.stream.write(data)
          this.current += data.byteLength
        })
        response.data.on('end', () => {
          this.status = 'done'
          this.resolve()
        })
        response.data.on('error', error => {
          this.status = 'failed'
          this.error = error
          this.resolve()
        })
      } catch (error) {
        this.status = 'failed'
        this.error = error
        this.resolve()
      }
    }
    return this.future
  }
  
  pause() {
    this.status = 'pause'
    this.abort?.abort()
    this?.resolve()
  }

  stop() {
    this.status = 'failed'
    this.error = new Error('stopped')
    this?.resolve()
  }
}

export function createHttpSource(src: string, timeout: number, output: string): Source {
  const source: Source = { src, fetchIndex, task }
  async function fetchIndex(index: string) {
    const { data }: AxiosResponse<Nereid.Index<null>> = await axios.get(`${src}${index}`)
    return data
  }
  function task(composable: Nereid.Composable) {
    return new HttpTask(
      source, `${src}/${composable.hash}`,
      composable, timeout, `${output}/${composable.hash}`
    )
  }
  return source
}