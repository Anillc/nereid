import { Source } from '.'
import { Nereid } from '..'

export abstract class Task<T> {
  status: 'downloading' | 'pause' | 'failed' | 'done'
  error?: Error
  resolve: Function
  private future: Promise<void>
  protected current = 0
  public constructor(
    public source: Source<T>,
    public composable: Nereid.Composable,
    public output: string,
  ) {}
  get downloaded() {
    return Math.floor(this.current / this.composable.size * 100)
  }
  // this promise should be always resolved
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
  }
  async stop() {
    this._stop()
    this.failed(new Error('stopped'))
  }
  failed(error: any) {
    this.status = 'failed'
    this.error = error
    this.resolve?.()
  }
  done() {
    this.status = 'done'
    this.resolve?.()
  }
  abstract _start(): void
  abstract _pause(): void
  abstract _stop(): void
}