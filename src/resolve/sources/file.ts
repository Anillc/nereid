import { createReadStream, promises as fsp, ReadStream, WriteStream } from 'fs'
import { Source, Task } from '..'
import { Nereid } from '../..'

export class FileTask extends Task<null> {
  current = 0
  read: ReadStream
  write: WriteStream
  constructor(
    public source: Source<null>,
    public composable: Nereid.Composable,
    public output: string,
    public path: string,
  ) {
    super(source, composable, output)
  }

  _start() {
    new Promise(async () => {
      if (this.read)
        await new Promise(resolve => this.read.close(resolve))
      if (this.write)
        await new Promise(resolve => this.write.close(resolve))
      await fsp.rm(this.output, { force: true })

      this.read = createReadStream(this.path, { start: this.current })
      this.read.on('data', data => {
        if (typeof data === 'string') data = Buffer.from(data)
        this.write.write(data)
        this.current += data.byteLength
      })
      this.read.on('error', error => {
        this.failed(error)
      })
    }).catch(error => {
      this.failed(error)
    })
  }
  
  _pause() {
    this._stop()
  }

  _stop(): void {
    this.read?.close(error => {
      if (error) this.failed(error)
    })
    this.write?.close(error => {
      if (error) this.failed(error)
    })
  }
}

export function createFileSource(src: string, output: string): Source {
  // file://
  const base = src.substring(7)
  const source: Source<null> = { src, fetchIndex, task }
  async function fetchIndex(index: string) {
    const content = await fsp.readFile(`${base}${index}`, 'utf-8')
    return JSON.parse(content)
  }
  function task(composable: Nereid.Composable) {
    return new FileTask(
      source, composable, `${output}/${composable.hash}`, 
      `${base}/composables/${composable.hash}`,
    )
  }
  return source
}