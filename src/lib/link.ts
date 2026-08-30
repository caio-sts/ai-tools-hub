const BASE: string = import.meta.env.BASE_URL ?? '/';

// Pure core, so an empty base and a root base stay testable without a build.
export function joinBase(base: string, path: string): string {
  const prefix = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${suffix}`;
}

export function withBase(path: string): string {
  return joinBase(BASE, path);
}
