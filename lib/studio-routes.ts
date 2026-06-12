export function withStudioRoutePrefix(currentPathname: string | null | undefined, href: string) {
  if (!href.startsWith('/')) return href;

  const isV2Route = currentPathname === '/v2' || currentPathname?.startsWith('/v2/');
  if (!isV2Route) return href;
  if (href === '/v2' || href.startsWith('/v2/')) return href;

  return href === '/' ? '/v2' : `/v2${href}`;
}
