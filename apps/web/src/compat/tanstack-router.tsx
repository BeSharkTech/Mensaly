"use client";

import NextLink from "next/link";
import {
  useParams as useNextParams,
  usePathname,
  useRouter as useNextRouter,
} from "next/navigation";
import {
  useCallback,
  type AnchorHTMLAttributes,
  type ComponentType,
} from "react";

type RouteConfig = {
  component: ComponentType;
  head?: () => unknown;
};

export function createFileRoute(_path: string) {
  return <T extends RouteConfig>(config: T) =>
    Object.assign(config, {
      useParams: () => useNextParams() as Record<string, string>,
      useRouteContext: () => ({}),
    });
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
};

export function Link({ to, children, ...props }: LinkProps) {
  return (
    <NextLink href={to} {...props}>
      {children}
    </NextLink>
  );
}

export function useNavigate() {
  const router = useNextRouter();
  return useCallback(
    ({ to, replace }: { to: string; replace?: boolean }) => {
      if (replace) router.replace(to);
      else router.push(to);
    },
    [router],
  );
}

export function useRouterState<T>({
  select,
}: {
  select: (state: { location: { pathname: string } }) => T;
}) {
  return select({ location: { pathname: usePathname() } });
}

export function useRouter() {
  const router = useNextRouter();
  return { invalidate: () => router.refresh() };
}
