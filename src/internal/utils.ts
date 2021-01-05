
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
