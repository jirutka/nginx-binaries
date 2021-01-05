
export function bindAll <T> (obj: T): T {
  for (const propName of Object.getOwnPropertyNames(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, propName)!

    if (typeof desc.value === 'function') {
      desc.value = desc.value.bind(obj)
      Object.defineProperty(obj, propName, desc)
    }
  }
  return obj
}

export function replaceProperty <T, K extends keyof T> (obj: T, propName: K, value: T[K]): T[K] {
  delete obj[propName]
  obj[propName] = value

  return value
}
