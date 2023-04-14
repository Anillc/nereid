export interface Events {
  a(i: string, j: number): void
}

type A<E, N extends keyof E> = E[N] extends (...args: infer T) => any ? T : never

export class EventEmitter<E = Events> {
  callbacks: { [N in keyof E]: E[N][] }

  on<N extends keyof E>(name: N, callback: E[N]) {
    const callbacks = this.callbacks[name] ||= []
    callbacks.push(callback)
    return () => {
      const index = callbacks.indexOf(callback)
      if (index !== -1) {
        callbacks.splice(index, 1)
        return true
      }
      return false
    }
  }

  once<N extends keyof E>(name: N, callback: E[N]) {
    // const callbacks = this.callbacks[name] ||= []
    // callbacks.push(callback)
  }

  emit<N extends keyof E>(name: N, ...params: A<E, N>) {
    const callbacks = this.callbacks[name]
    for (const callback of callbacks) {
      (callback as Function).apply(null, params)
    }
  }
}
