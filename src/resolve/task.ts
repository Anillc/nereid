import { Source } from '.'
import { Nereid } from '..'

export abstract class Task<T> {
  status: 'downloading' | 'pause' | 'failed' | 'done'
  error?: Error
  resolve: Function
  private future: Promise<void>
  // downloaded in bytes
  current = 0

  public constructor(
    public source: Source<T>,
    public composable: Nereid.Composable,
    public output: string,
  ) {}

  // this promise should always be fulfilled
  // this function will start download
  async promise() {
    if (!this.future) {
      this.status = 'downloading'
      this.future = new Promise(resolve => this.resolve = resolve).then(() => this.resolve = undefined)
      this._start()
    }
    return this.future
  }
  async pause() {
    this.status = 'pause'
    this._pause()
    this.resolve?.()
    this.future = null
    this.resolve = null
  }
  async stop() {
    this._stop()
    this.failed(new Error('stopped'))
  }
  failed(error: any) {
    this.status = 'failed'
    this.error = error
    this.resolve?.()
    this.future = null
    this.resolve = null
  }
  done() {
    this.status = 'done'
    this.resolve?.()
    this.future = null
    this.resolve = null
  }
  abstract _start(): void
  abstract _pause(): void
  abstract _stop(): void
}
