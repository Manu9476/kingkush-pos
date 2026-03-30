import { dataApi } from './services/platformApi';
import type { UserProfile } from './types';

type AuthLikeUser = {
  uid: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: {
    providerId: string;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
  }[];
  sessionProfile?: UserProfile;
};

type DocumentData = any;

type DBRef = {
  kind: 'db';
};

type CollectionRef = {
  kind: 'collection';
  id: string;
  path: string;
  parent: DocumentRef | null;
};

type DocumentRef = {
  kind: 'document';
  id: string;
  path: string;
  parent: CollectionRef;
};

type QueryConstraint =
  | { type: 'where'; field: string; op: '=='; value: unknown }
  | { type: 'orderBy'; field: string; direction: 'asc' | 'desc' }
  | { type: 'limit'; count: number };

type QueryRef = {
  kind: 'query';
  source: CollectionRef | CollectionGroupRef;
  constraints: QueryConstraint[];
};

type CollectionGroupRef = {
  kind: 'collectionGroup';
  collectionId: string;
};

type SnapshotDoc = {
  id: string;
  ref: DocumentRef;
  data: () => DocumentData;
};

type QuerySnapshot = {
  docs: SnapshotDoc[];
  empty: boolean;
  forEach: (cb: (doc: SnapshotDoc) => void) => void;
};

type DocumentSnapshot = {
  id: string;
  ref: DocumentRef;
  exists: () => boolean;
  data: () => DocumentData;
};

type AuthListener = (user: AuthLikeUser | null) => void;

const authListeners = new Set<AuthListener>();
const snapshotRefreshers = new Set<() => void | Promise<void>>();
let authHydrationPromise: Promise<void> | null = null;
let authHydrated = false;
const SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_POLL_INTERVAL_MS = 15000;
const SNAPSHOT_MUTATION_REFRESH_DELAY_MS = 120;
let scheduledSnapshotRefreshId: number | null = null;
const AUTH_REQUEST_TIMEOUT_MS = 30000;
const AUTH_TIMEOUT_MESSAGE = 'The authentication service took too long to respond. Please refresh and try again.';
const PROTECTED_PREVIEW_MESSAGE =
  'This Vercel preview deployment is protected. Sign into the preview or use the public production URL.';
const UNEXPECTED_AUTH_RESPONSE_MESSAGE =
  'The server returned an unexpected response while checking your session. Please refresh and try again.';

type CachedDocPayload = {
  kind: 'doc';
  exists: boolean;
  data: DocumentData | null;
  cachedAt: number;
};

type CachedQueryPayload = {
  kind: 'query';
  docs: Array<{ id: string; data: DocumentData }>;
  cachedAt: number;
};

type CachedSnapshotPayload = CachedDocPayload | CachedQueryPayload;
type SnapshotCacheWritePayload = Omit<CachedDocPayload, 'cachedAt'> | Omit<CachedQueryPayload, 'cachedAt'>;

const snapshotCache = new Map<string, CachedSnapshotPayload>();

function normalizePath(base: string, ...segments: string[]) {
  const parts = [base, ...segments]
    .join('/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join('/');
}

function splitPath(path: string) {
  return path.split('/').filter(Boolean);
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function looksLikeHtml(contentType: string, body: string) {
  const normalizedBody = body.trim().toLowerCase();
  return (
    contentType.includes('text/html') ||
    normalizedBody.startsWith('<!doctype html') ||
    normalizedBody.startsWith('<html')
  );
}

function looksLikeProtectedPreview(contentType: string, body: string) {
  const normalizedBody = body.toLowerCase();
  return (
    looksLikeHtml(contentType, body) &&
    (normalizedBody.includes('vercel authentication') ||
      normalizedBody.includes('this page requires vercel authentication') ||
      normalizedBody.includes('sso-api') ||
      normalizedBody.includes('authentication required'))
  );
}

async function requestSessionJson<T extends Record<string, unknown>>(
  url: string,
  options: RequestInit,
  config: { fallbackError: string; allowUnauthorized?: boolean }
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    const rawBody = await response.text();

    if (looksLikeProtectedPreview(contentType, rawBody)) {
      throw new Error(PROTECTED_PREVIEW_MESSAGE);
    }

    let payload = {} as T & { error?: string };
    if (rawBody.trim() && !looksLikeHtml(contentType, rawBody)) {
      try {
        payload = JSON.parse(rawBody) as T & { error?: string };
      } catch {
        payload = {} as T & { error?: string };
      }
    }

    if (!response.ok) {
      if (config.allowUnauthorized && response.status === 401) {
        return {} as T;
      }

      throw new Error(typeof payload.error === 'string' ? payload.error : config.fallbackError);
    }

    if (rawBody.trim() && looksLikeHtml(contentType, rawBody)) {
      throw new Error(UNEXPECTED_AUTH_RESPONSE_MESSAGE);
    }

    return payload;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(AUTH_TIMEOUT_MESSAGE);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function getSnapshotCacheNamespace() {
  return auth.currentUser?.uid || 'guest';
}

function buildSnapshotCacheStorageKey(cacheKey: string) {
  return `kingkush-cache:${getSnapshotCacheNamespace()}:${cacheKey}`;
}

function readSnapshotCache(cacheKey: string): CachedSnapshotPayload | null {
  const storageKey = buildSnapshotCacheStorageKey(cacheKey);
  const fromMemory = snapshotCache.get(storageKey);
  if (fromMemory && Date.now() - fromMemory.cachedAt < SNAPSHOT_CACHE_TTL_MS) {
    return fromMemory;
  }

  if (typeof window === 'undefined') {
    snapshotCache.delete(storageKey);
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      snapshotCache.delete(storageKey);
      return null;
    }

    const parsed = JSON.parse(raw) as CachedSnapshotPayload;
    if (!parsed || Date.now() - parsed.cachedAt >= SNAPSHOT_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(storageKey);
      snapshotCache.delete(storageKey);
      return null;
    }

    snapshotCache.set(storageKey, parsed);
    return parsed;
  } catch {
    snapshotCache.delete(storageKey);
    return null;
  }
}

function writeSnapshotCache(cacheKey: string, payload: SnapshotCacheWritePayload) {
  const storageKey = buildSnapshotCacheStorageKey(cacheKey);
  const cachedPayload: CachedSnapshotPayload = {
    ...payload,
    cachedAt: Date.now()
  } as CachedSnapshotPayload;

  snapshotCache.set(storageKey, cachedPayload);
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(cachedPayload));
  } catch {
    // Ignore storage quota/privacy errors and keep the in-memory cache only.
  }
}

function getDocCacheKey(path: string) {
  return `doc:${path}`;
}

function getQueryCacheKey(source: CollectionRef | QueryRef) {
  if (source.kind === 'collection') {
    return `query:${JSON.stringify({ kind: 'collection', path: source.path })}`;
  }

  const descriptor =
    source.source.kind === 'collection'
      ? { kind: 'collection', path: source.source.path, constraints: source.constraints }
      : { kind: 'collectionGroup', collectionId: source.source.collectionId, constraints: source.constraints };

  return `query:${JSON.stringify(descriptor)}`;
}

function assertDocumentPath(path: string) {
  if (splitPath(path).length % 2 !== 0) {
    throw new Error(`Invalid document path: ${path}`);
  }
}

function assertCollectionPath(path: string) {
  if (splitPath(path).length % 2 === 0) {
    throw new Error(`Invalid collection path: ${path}`);
  }
}

function randomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createCollectionRef(path: string): CollectionRef {
  assertCollectionPath(path);
  const parts = splitPath(path);
  const id = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join('/');
  return {
    kind: 'collection',
    id,
    path,
    parent: parentPath ? createDocumentRef(parentPath) : null
  };
}

function createDocumentRef(path: string): DocumentRef {
  assertDocumentPath(path);
  const parts = splitPath(path);
  const id = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join('/');
  return {
    kind: 'document',
    id,
    path,
    parent: createCollectionRef(parentPath)
  };
}

export const db: DBRef = { kind: 'db' };

export const auth: { currentUser: AuthLikeUser | null } = {
  currentUser: null
};

export const googleProvider = { providerId: 'google.com' };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const info: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email
    }
  };
  if (process.env.NODE_ENV === 'development') {
    console.error('Data Layer Error:', info);
  }
  throw new Error(info.error);
}

export class Timestamp {
  private iso: string;

  private constructor(iso: string) {
    this.iso = iso;
  }

  static now() {
    return new Timestamp(new Date().toISOString());
  }

  static fromDate(date: Date) {
    return new Timestamp(date.toISOString());
  }

  static fromMillis(milliseconds: number) {
    return new Timestamp(new Date(milliseconds).toISOString());
  }

  toDate() {
    return new Date(this.iso);
  }

  toMillis() {
    return this.toDate().getTime();
  }

  toISOString() {
    return this.iso;
  }
}

function toAuthLikeUser(user: any): AuthLikeUser {
  const sessionProfile =
    user &&
    typeof user === 'object' &&
    typeof user.uid === 'string' &&
    typeof user.username === 'string' &&
    typeof user.role === 'string'
      ? {
          uid: user.uid,
          username: user.username,
          email: user.email || `${user.username}@kingkush.local`,
          displayName: user.displayName || user.username,
          branchId: user.branchId ?? null,
          role: user.role,
          permissions: Array.isArray(user.permissions) ? user.permissions : [],
          status: user.status || 'active',
          createdAt: user.createdAt || new Date().toISOString()
        } satisfies UserProfile
      : undefined;

  return {
    uid: user.uid,
    email: user.email || `${user.username}@kingkush.local`,
    displayName: user.displayName || null,
    emailVerified: true,
    isAnonymous: false,
    tenantId: null,
    providerData: [
      {
        providerId: 'password',
        displayName: user.displayName || null,
        email: user.email || null,
        photoURL: null
      }
    ],
    sessionProfile
  };
}

function setCurrentUser(user: AuthLikeUser | null) {
  auth.currentUser = user;
  for (const listener of authListeners) {
    listener(user);
  }
}

function canAccessModule(profile: UserProfile | undefined, permissionId: string) {
  if (!profile) {
    return false;
  }

  return profile.role === 'superadmin' || profile.permissions.includes(permissionId);
}

async function warmSessionCaches(user: AuthLikeUser) {
  const profile = user.sessionProfile;
  if (!profile) {
    return;
  }

  const requests: Array<Promise<unknown>> = [];
  const warmedKeys = new Set<string>();

  const warmDoc = (path: string) => {
    const cacheKey = getDocCacheKey(path);
    if (warmedKeys.has(cacheKey)) {
      return;
    }
    warmedKeys.add(cacheKey);

    requests.push(
      dataApi<{ exists: boolean; data: DocumentData | null }>({ mode: 'doc', path })
        .then((payload) => {
          writeSnapshotCache(cacheKey, {
            kind: 'doc',
            exists: payload.exists,
            data: payload.data
          });
        })
        .catch(() => undefined)
    );
  };

  const warmCollection = (path: string, constraints: QueryConstraint[] = []) => {
    const cacheKey =
      constraints.length === 0
        ? getQueryCacheKey(createCollectionRef(path))
        : getQueryCacheKey(query(createCollectionRef(path), ...constraints));

    if (warmedKeys.has(cacheKey)) {
      return;
    }
    warmedKeys.add(cacheKey);

    requests.push(
      dataApi<{ docs: Array<{ id: string; data: DocumentData }> }>({
        mode: 'query',
        source: { kind: 'collection', path },
        constraints
      })
        .then((payload) => {
          writeSnapshotCache(cacheKey, {
            kind: 'query',
            docs: payload.docs
          });
        })
        .catch(() => undefined)
    );
  };

  writeSnapshotCache(getDocCacheKey(`users/${profile.uid}`), {
    kind: 'doc',
    exists: true,
    data: profile
  });

  warmDoc('settings/system');
  warmCollection('branches');
  warmDoc(`users/${profile.uid}`);

  if (canAccessModule(profile, 'dashboard')) {
    warmCollection('sales');
    warmCollection('sales', [orderBy('timestamp', 'desc'), limit(10)]);
    warmCollection('credits');
    warmCollection('expenses');
    warmCollection('credit_payments', [orderBy('timestamp', 'desc'), limit(20)]);
    warmCollection('products');
  }

  if (canAccessModule(profile, 'pos')) {
    warmCollection('products');
    warmCollection('customers');
    warmCollection('branches');
  }

  if (canAccessModule(profile, 'customers')) {
    warmCollection('customers', [orderBy('name', 'asc')]);
    warmCollection('credits', [where('status', '==', 'open')]);
  }

  if (canAccessModule(profile, 'credits')) {
    warmCollection('credits', [where('status', '==', 'open')]);
  }

  if (canAccessModule(profile, 'sales-history')) {
    warmCollection('sales', [orderBy('timestamp', 'desc')]);
    warmCollection('branches');
  }

  if (canAccessModule(profile, 'products')) {
    warmCollection('products', [orderBy('createdAt', 'desc')]);
    warmCollection('categories');
    warmCollection('suppliers');
  }

  if (canAccessModule(profile, 'inventory')) {
    warmCollection('products');
    warmCollection('suppliers');
    warmCollection('inventory_transactions', [orderBy('timestamp', 'desc'), limit(50)]);
  }

  if (canAccessModule(profile, 'shifts')) {
    warmCollection('cash_shifts', [orderBy('openedAt', 'desc')]);
    warmCollection('branches');
  }

  await Promise.allSettled(requests);
}

async function ensureAuthHydrated() {
  if (!authHydrationPromise) {
    authHydrationPromise = (async () => {
      try {
        const payload = await requestSessionJson<{ user?: any }>(
          '/api/auth/me',
          {
            method: 'GET'
          },
          {
            fallbackError: 'Unable to verify the current session.',
            allowUnauthorized: true
          }
        );
        const user = payload.user ? toAuthLikeUser(payload.user) : null;
        setCurrentUser(user);
        if (user?.sessionProfile) {
          writeSnapshotCache(getDocCacheKey(`users/${user.uid}`), {
            kind: 'doc',
            exists: true,
            data: user.sessionProfile
          });
          void warmSessionCaches(user);
        }
      } catch {
        setCurrentUser(null);
      } finally {
        authHydrated = true;
      }
    })();
  }

  await authHydrationPromise;
}

function normalizeData(value: unknown, fieldName: string | null = null): any {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeData(entry, fieldName));
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && isDateLikeField(fieldName) && !Number.isNaN(Date.parse(value))) {
      return Timestamp.fromDate(new Date(value));
    }
    return value;
  }

  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(record)) {
    output[key] = normalizeData(nestedValue, key);
  }
  return output;
}

function isDateLikeField(fieldName: string | null) {
  return Boolean(fieldName) && /(^date$|timestamp|At$)/i.test(fieldName || '');
}

function makeSnapshotDoc(path: string, data: DocumentData): SnapshotDoc {
  const ref = createDocumentRef(path);
  return {
    id: ref.id,
    ref,
    data: () => normalizeData(data)
  };
}

function makeQuerySnapshot(docs: SnapshotDoc[]): QuerySnapshot {
  return {
    docs,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb)
  };
}

function getQueryDocPath(source: CollectionRef | QueryRef, entryId: string) {
  if (source.kind === 'collection') {
    return `${source.path}/${entryId}`;
  }

  if (source.source.kind === 'collection') {
    return `${source.source.path}/${entryId}`;
  }

  return `sales/placeholder/items/${entryId}`;
}

function makeCachedDocumentSnapshot(ref: DocumentRef, payload: CachedDocPayload): DocumentSnapshot {
  return {
    id: ref.id,
    ref,
    exists: () => payload.exists,
    data: () => normalizeData(payload.data || {})
  };
}

function makeCachedQuerySnapshot(source: CollectionRef | QueryRef, payload: CachedQueryPayload): QuerySnapshot {
  const docs = payload.docs.map((entry) => makeSnapshotDoc(getQueryDocPath(source, entry.id), entry.data));
  return makeQuerySnapshot(docs);
}

function canRefreshSnapshotsNow() {
  if (typeof document === 'undefined') {
    return true;
  }

  return document.visibilityState === 'visible';
}

function runSnapshotRefreshers() {
  scheduledSnapshotRefreshId = null;
  if (!canRefreshSnapshotsNow()) {
    return;
  }

  for (const refresher of snapshotRefreshers) {
    void refresher();
  }
}

function notifySnapshots(delay = SNAPSHOT_MUTATION_REFRESH_DELAY_MS) {
  if (typeof window === 'undefined') {
    runSnapshotRefreshers();
    return;
  }

  if (scheduledSnapshotRefreshId !== null) {
    window.clearTimeout(scheduledSnapshotRefreshId);
  }

  scheduledSnapshotRefreshId = window.setTimeout(runSnapshotRefreshers, delay);
}

export function collection(base: DBRef | DocumentRef, path: string) {
  if (base.kind === 'db') {
    return createCollectionRef(normalizePath(path));
  }
  return createCollectionRef(normalizePath(base.path, path));
}

export function doc(base: DBRef | CollectionRef, path?: string, maybeId?: string) {
  if (base.kind === 'collection') {
    const id = path || randomId();
    return createDocumentRef(normalizePath(base.path, id));
  }

  const target = maybeId ? normalizePath(path || '', maybeId) : normalizePath(path || '');
  return createDocumentRef(target);
}

export function where(field: string, op: '==', value: unknown): QueryConstraint {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): QueryConstraint {
  return { type: 'limit', count };
}

export function collectionGroup(_db: DBRef, collectionId: string): CollectionGroupRef {
  return { kind: 'collectionGroup', collectionId };
}

export function query(source: CollectionRef | CollectionGroupRef, ...constraints: QueryConstraint[]): QueryRef {
  return {
    kind: 'query',
    source,
    constraints
  };
}

export async function getDoc(ref: DocumentRef): Promise<DocumentSnapshot> {
  await ensureAuthHydrated();
  const payload = await dataApi<{ id: string; exists: boolean; data: DocumentData | null }>({
    mode: 'doc',
    path: ref.path
  });

  writeSnapshotCache(getDocCacheKey(ref.path), {
    kind: 'doc',
    exists: payload.exists,
    data: payload.data
  });

  return {
    id: ref.id,
    ref,
    exists: () => payload.exists,
    data: () => normalizeData(payload.data || {})
  };
}

export async function getDocFromServer(ref: DocumentRef) {
  return getDoc(ref);
}

export async function getDocs(source: CollectionRef | QueryRef): Promise<QuerySnapshot> {
  await ensureAuthHydrated();
  const payload = await dataApi<{ docs: Array<{ id: string; data: DocumentData }> }>({
    mode: 'query',
    source: source.kind === 'collection'
      ? { kind: 'collection', path: source.path }
      : source.source.kind === 'collection'
        ? { kind: 'collection', path: source.source.path }
        : { kind: 'collectionGroup', collectionId: source.source.collectionId },
    constraints: source.kind === 'collection' ? [] : source.constraints
  });

  writeSnapshotCache(getQueryCacheKey(source), {
    kind: 'query',
    docs: payload.docs
  });

  const docs = payload.docs.map((entry) => makeSnapshotDoc(getQueryDocPath(source, entry.id), entry.data));

  return makeQuerySnapshot(docs);
}

export async function setDoc(ref: DocumentRef, data: any) {
  await ensureAuthHydrated();
  await dataApi({
    mode: 'write',
    action: 'set',
    path: ref.path,
    data: serializeWriteData(data)
  });
  notifySnapshots();
}

export async function addDoc(ref: CollectionRef, data: any) {
  await ensureAuthHydrated();
  const payload = await dataApi<{ id: string }>({
    mode: 'write',
    action: 'add',
    collectionPath: ref.path,
    data: serializeWriteData(data)
  });
  notifySnapshots();
  return createDocumentRef(normalizePath(ref.path, payload.id));
}

export async function updateDoc(ref: DocumentRef, data: any) {
  await ensureAuthHydrated();
  await dataApi({
    mode: 'write',
    action: 'update',
    path: ref.path,
    data: serializeWriteData(data)
  });
  notifySnapshots();
}

export async function deleteDoc(ref: DocumentRef) {
  await ensureAuthHydrated();
  await dataApi({
    mode: 'write',
    action: 'delete',
    path: ref.path
  });
  notifySnapshots();
}

export function serverTimestamp() {
  return Timestamp.now().toISOString();
}

export function increment(by: number) {
  return { __op: 'increment' as const, by };
}

export function writeBatch(_db: DBRef) {
  const operations: Array<{
    action: 'set' | 'add' | 'update' | 'delete';
    path?: string;
    collectionPath?: string;
    data?: any;
  }> = [];

  return {
    set(ref: DocumentRef, data: any) {
      operations.push({ action: 'set', path: ref.path, data });
    },
    update(ref: DocumentRef, data: any) {
      operations.push({ action: 'update', path: ref.path, data });
    },
    delete(ref: DocumentRef) {
      operations.push({ action: 'delete', path: ref.path });
    },
    async commit() {
      await ensureAuthHydrated();
      await dataApi({
        mode: 'write',
        action: 'batch',
        operations: operations.map((operation) => ({
          ...operation,
          data: operation.data ? serializeWriteData(operation.data) : undefined
        }))
      });
      notifySnapshots();
    }
  };
}

export function onSnapshot(
  source: DocumentRef,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: unknown) => void
): () => void;
export function onSnapshot(
  source: CollectionRef | QueryRef,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: unknown) => void
): () => void;
export function onSnapshot(
  source: DocumentRef | CollectionRef | QueryRef,
  onNext: ((snapshot: DocumentSnapshot) => void) | ((snapshot: QuerySnapshot) => void),
  onError?: (error: unknown) => void
) {
  let active = true;
  const cacheKey = source.kind === 'document' ? getDocCacheKey(source.path) : getQueryCacheKey(source);

  const cachedPayload = readSnapshotCache(cacheKey);
  if (cachedPayload) {
    if (source.kind === 'document' && cachedPayload.kind === 'doc') {
      onNext(makeCachedDocumentSnapshot(source, cachedPayload) as never);
    } else if (source.kind !== 'document' && cachedPayload.kind === 'query') {
      onNext(makeCachedQuerySnapshot(source, cachedPayload) as never);
    }
  }

  const refresh = async () => {
    try {
      const snapshot = source.kind === 'document'
        ? await getDoc(source)
        : await getDocs(source);
      if (active) {
        onNext(snapshot as never);
      }
    } catch (error) {
      if (active) {
        try {
          onError?.(error);
        } catch (callbackError) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Snapshot error handler failed', callbackError);
          }
        }
      }
    }
  };

  void refresh();
  const intervalId = window.setInterval(() => {
    if (!canRefreshSnapshotsNow()) {
      return;
    }
    void refresh();
  }, SNAPSHOT_POLL_INTERVAL_MS);
  snapshotRefreshers.add(refresh);

  return () => {
    active = false;
    window.clearInterval(intervalId);
    snapshotRefreshers.delete(refresh);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('kingkush:data-mutated', () => {
    notifySnapshots();
  });

  window.addEventListener('focus', () => {
    notifySnapshots(0);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      notifySnapshots(0);
    }
  });
}

export function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (typeof value === 'number') return new Date(value);
  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

export function onAuthStateChanged(_authObj: typeof auth, callback: AuthListener) {
  authListeners.add(callback);
  if (authHydrated) {
    callback(auth.currentUser);
  } else {
    void ensureAuthHydrated();
  }
  return () => {
    authListeners.delete(callback);
  };
}

export async function signInWithEmailAndPassword(_authObj: typeof auth, email: string, password: string) {
  const username = email.split('@')[0];
  const payload = await requestSessionJson<{ user: any; error?: string }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password })
    },
    {
      fallbackError: 'Authentication failed'
    }
  );
  const user = toAuthLikeUser(payload.user);
  setCurrentUser(user);
  if (user.sessionProfile) {
    writeSnapshotCache(getDocCacheKey(`users/${user.uid}`), {
      kind: 'doc',
      exists: true,
      data: user.sessionProfile
    });
    void warmSessionCaches(user);
  }
  return { user };
}

export async function signInWithPopup(_authObj: typeof auth, _provider: unknown) {
  throw new Error('Google login is not configured on this deployment.');
}

export async function signOut(_authObj: typeof auth) {
  await requestSessionJson(
    '/api/auth/logout',
    {
      method: 'POST'
    },
    {
      fallbackError: 'Failed to sign out',
      allowUnauthorized: true
    }
  ).catch(() => undefined);
  setCurrentUser(null);
}

export async function createUserWithEmailAndPassword() {
  throw new Error('Direct auth account creation is not supported in the browser client.');
}

export async function createLocalUserAccount() {
  throw new Error('Use the server-side user creation endpoint instead.');
}

export async function updateUserAccountPassword() {
  throw new Error('Use the server-side password endpoint instead.');
}

export async function sendPasswordResetEmail() {
  throw new Error('Password reset email is not configured on this deployment.');
}

export async function signInAnonymously() {
  throw new Error('Anonymous sign-in is not supported.');
}

export const EmailAuthProvider = {
  credential(email: string, password: string) {
    return { email, password };
  }
};

export async function reauthenticateWithCredential() {
  return true;
}

export async function updatePassword() {
  return true;
}

function serializeWriteData(data: any) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isIncrement(value)) {
      throw new Error(`increment() is not supported through the generic client for field "${key}". Use the dedicated transaction endpoints.`);
    }
    if (value instanceof Timestamp) {
      output[key] = value.toISOString();
      continue;
    }
    output[key] = serializeValue(value);
  }
  return output;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serializeValue(nestedValue);
    }
    return output;
  }
  return value;
}

function isIncrement(value: unknown): value is { __op: 'increment'; by: number } {
  return Boolean(value) && typeof value === 'object' && (value as { __op?: string }).__op === 'increment';
}

void ensureAuthHydrated();
