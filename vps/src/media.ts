export function isLocalPath(p: string): boolean {
  return !/^https?:\/\//i.test(p)
}
