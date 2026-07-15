export interface ThrottleOptions {
  leading?: boolean
  trailing?: boolean
}

export interface ThrottledFunction<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void
  cancel(): void
  flush(): void
}

export function throttle<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number,
  options: ThrottleOptions = {},
): ThrottledFunction<T> {
  const leading = options.leading !== false
  const trailing = options.trailing !== false

  return debounce(func, wait, { leading, trailing, maxWait: wait })
}

interface DebounceOptions {
  leading?: boolean
  trailing?: boolean
  maxWait?: number
}

function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number,
  options: DebounceOptions = {},
): ThrottledFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let lastThis: unknown = null
  let result: unknown = null
  let lastCallTime: number | null = null
  let lastInvokeTime = 0

  const leading = !!options.leading
  const trailing = options.trailing !== false
  const maxWait =
    options.maxWait !== undefined ? Math.max(options.maxWait, wait) : null

  function shouldInvoke(time: number): boolean {
    if (lastCallTime === null) return true
    const timeSinceLastCall = time - lastCallTime
    const timeSinceLastInvoke = time - lastInvokeTime
    return (
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxWait !== null && timeSinceLastInvoke >= maxWait)
    )
  }

  function invokeFunc(time: number): unknown {
    const args = lastArgs
    const thisArg = lastThis
    lastArgs = null
    lastThis = null
    lastInvokeTime = time
    if (args) result = func.apply(thisArg, args)
    return result
  }

  function remainingWait(time: number): number {
    if (lastCallTime === null) return 0
    const timeSinceLastCall = time - lastCallTime
    const timeSinceLastInvoke = time - lastInvokeTime
    const timeWaiting = wait - timeSinceLastCall
    if (maxWait !== null) {
      return Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
    }
    return timeWaiting
  }

  function trailingEdge(time: number): unknown {
    timeoutId = null
    if (trailing && lastArgs) return invokeFunc(time)
    lastArgs = null
    lastThis = null
    return result
  }

  function timerExpired(): void {
    const time = Date.now()
    if (shouldInvoke(time)) {
      trailingEdge(time)
      return
    }
    timeoutId = setTimeout(timerExpired, remainingWait(time))
  }

  function leadingEdge(time: number): unknown {
    lastInvokeTime = time
    timeoutId = setTimeout(timerExpired, wait)
    return leading ? invokeFunc(time) : result
  }

  function throttled(this: unknown, ...args: Parameters<T>): void {
    const time = Date.now()
    const isInvoking = shouldInvoke(time)
    lastArgs = args
    lastThis = this
    lastCallTime = time

    if (isInvoking) {
      if (timeoutId === null) {
        leadingEdge(lastCallTime)
        return
      }
      if (maxWait !== null) {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(timerExpired, wait)
        invokeFunc(lastCallTime)
        return
      }
    }

    if (timeoutId === null) {
      timeoutId = setTimeout(timerExpired, wait)
    }
  }

  throttled.cancel = function (): void {
    if (timeoutId !== null) clearTimeout(timeoutId)
    lastInvokeTime = 0
    lastArgs = null
    lastThis = null
    lastCallTime = null
    timeoutId = null
  }

  throttled.flush = function (): unknown {
    return timeoutId === null ? result : trailingEdge(Date.now())
  }

  return throttled
}
