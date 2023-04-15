export interface Events {}

type A<E, N extends keyof E> = E[N] extends (...args: infer T) => any ? T : never
type F<E, N extends keyof E> = E[N] extends (...args: any) => any ? E[N] : never

type Once = boolean
export class EventEmitter<E = Events> {
  callbacks: { [N in keyof E]?: [F<E, N>, Once][] } = {}

  on<N extends keyof E>(name: N, callback: F<E, N>, once = false) {
    const callbacks = this.callbacks[name] ||= []
    callbacks.push([callback, once])
    return () => {
      const index = callbacks.findIndex(([, cb]) => cb === callback)
      if (index !== -1) {
        callbacks.splice(index, 1)
        return true
      }
      return false
    }
  }

  once<N extends keyof E>(name: N, callback: F<E, N>) {
    return this.on(name, callback, true)
  }

  emit<N extends keyof E>(name: N, ...params: A<E, N>) {
    const callbacks = this.callbacks[name]
    if (!callbacks) return
    const rest: typeof callbacks = []
    for (const [callback, once] of callbacks) {
      callback.apply(null, params)
      if (!once) {
        rest.push([callback, false])
      }
    }
    this.callbacks[name] = rest
  }
}
