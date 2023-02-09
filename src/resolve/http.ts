import axios, { AxiosResponse } from 'axios'
import { Source, Task } from '.'
import { Nereid } from '..'

export class HttpTask implements Task {
  status: any = 'downloading'
  constructor(
    public source: Source,
    public url: string,
    public composable: Nereid.Composable,
    public timeout: number,
    public output: string,
  ) { }

  get downloaded() {
    return 0
  }

  start(start = 0) {
  }

  stop() {
  }

  pause() {
  }

  async promise() {
    return this
  }
}

export function createHttpSource(src: string, timeout: number, output: string): Source {
  const source: Source = { src, fetchIndex, task }
  async function fetchIndex(index: string) {
    const { data }: AxiosResponse<Nereid.Index<null>> = await axios.get(`${src}${index}`)
    return data
  }
  function task(composable: Nereid.Composable) {
    return new HttpTask(source, src, composable, timeout, output)
  }
  return source
}