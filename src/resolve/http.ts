import axios, { AxiosResponse } from 'axios'
import { Source, Task } from '.'
import { Nereid } from '..'

export class HttpTask implements Task {
  constructor(public url: string, public timeout: number) { }

  get progress() {
    return 0
  }

  start(start = 0) {
  }

  stop() {
  }

  pause() {
  }

  async promise() {
    
  }
}

export function createHttpSource(src: string, timeout: number): Source {
  async function fetchIndex(index: string) {
    const { data }: AxiosResponse<Nereid.Index> = await axios.get(`${src}${index}`)
    return data
  }
  async function task(composable: string) {
    return new HttpTask(`${src}${composable}`, timeout)
  }
  return { src, fetchIndex, task }
}