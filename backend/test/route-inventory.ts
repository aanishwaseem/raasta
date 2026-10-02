import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC, ROLES_KEY } from '../src/common/auth/decorators';

export interface RouteInfo {
  method: string;
  path: string; // e.g. /api/v1/rides/:id
  key: string; // "GET /api/v1/rides/:id"
  controller: string;
  handler: string;
  isPublic: boolean;
  roles: string[];
}

const NO_PREFIX = ['/health', '/health/ready', '/metrics'];
const join = (...parts: string[]) => '/' + parts.map((p) => p.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');

/** Every HTTP route the running application exposes, with its declared auth decision. */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const reflector = app.get(Reflector);
  const out: RouteInfo[] = [];
  const controllers = [...app.get(ModulesContainer, { strict: false }).values()].flatMap((m) => [...m.controllers.values()]);
  for (const wrapper of controllers) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = (Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined) ?? '';
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const methodId = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (methodId === undefined) continue;
      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const raw = join(base, sub === '/' ? '' : sub);
      const path = NO_PREFIX.includes(raw) ? raw : join('api/v1', raw);
      const method = RequestMethod[methodId];
      out.push({
        method,
        path,
        key: `${method} ${path}`,
        controller: metatype.name,
        handler: name,
        isPublic: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler as () => unknown, metatype]),
        roles: reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [handler as () => unknown, metatype]) ?? [],
      });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
