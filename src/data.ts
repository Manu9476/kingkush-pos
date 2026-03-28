type JsonValue = null | boolean | number | string | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type LocalDocMap = Record<string, JsonValue>;
type AuthAccount = { uid: string; email: string; password: string };
type AuthAccountMap = Record<string, AuthAccount>;

interface LocalStore {
  docs: LocalDocMap;
  authAccounts: AuthAccountMap;
}

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
};

type DocumentData = any;

type RefKind = 'db' | 'collection' | 'document' | 'query' | 'collectionGroup';

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
  data: () => any;
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
  data: () => any;
};

type Listener = {
  target: CollectionRef | QueryRef;
  onNext: (snapshot: QuerySnapshot) => void;
  onError?: (error: unknown) => void;
};

type AuthListener = (user: AuthLikeUser | null) => void;

const STORE_KEY = 'kingkush-pos.store.v1';
const AUTH_KEY = 'kingkush-pos.auth.uid.v1';

const DEFAULT_PERMISSIONS = [
  'dashboard',
  'pos',
  'sales-history',
  'customers',
  'credits',
  'products',
  'categories',
  'inventory',
  'purchase-orders',
  'suppliers',
  'labels',
  'reports',
  'expenses',
  'users',
  'audit-logs',
  'settings',
  'status'
];

const listeners = new Set<Listener>();
const authListeners = new Set<AuthListener>();

function randomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function splitPath(path: string) {
  return path.split('/').filter(Boolean);
}

function isDocumentPath(path: string) {
  return splitPath(path).length % 2 === 0;
}

function assertDocumentPath(path: string) {
  if (!isDocumentPath(path)) {
    throw new Error(`Invalid document path: ${path}`);
  }
}

function assertCollectionPath(path: string) {
  if (splitPath(path).length % 2 === 0) {
    throw new Error(`Invalid collection path: ${path}`);
  }
}

function normalizePath(base: string, ...segments: string[]) {
  const parts = [base, ...segments]
    .join('/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join('/');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function encodeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return { __kk_timestamp: value.toISOString() } as JsonObject;
  if (value instanceof Date) return { __kk_timestamp: value.toISOString() } as JsonObject;
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (isPlainObject(value)) {
    const out: JsonObject = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = encodeValue(nested);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function decodeValue(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item));
  if (value && typeof value === 'object') {
    const objectValue = value as JsonObject;
    if (typeof objectValue.__kk_timestamp === 'string') {
      return Timestamp.fromDate(new Date(objectValue.__kk_timestamp));
    }
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(objectValue)) {
      out[key] = decodeValue(nested as JsonValue);
    }
    return out;
  }
  return value;
}

function isServerTimestamp(value: unknown): value is { __op: 'serverTimestamp' } {
  return isPlainObject(value) && value.__op === 'serverTimestamp';
}

function isIncrement(value: unknown): value is { __op: 'increment'; by: number } {
  return isPlainObject(value) && value.__op === 'increment' && typeof value.by === 'number';
}

function applyFieldOps(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (isServerTimestamp(value)) {
      next[key] = Timestamp.now();
      continue;
    }
    if (isIncrement(value)) {
      const previous = Number(next[key] ?? 0);
      next[key] = previous + value.by;
      continue;
    }
    next[key] = deepClone(value);
  }
  return next;
}

function firestoreError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function readStore(): LocalStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      return { docs: {}, authAccounts: {} };
    }
    const parsed = JSON.parse(raw) as LocalStore;
    return {
      docs: parsed.docs || {},
      authAccounts: parsed.authAccounts || {}
    };
  } catch {
    return { docs: {}, authAccounts: {} };
  }
}

let store = readStore();

function writeStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
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

function listCollectionDocs(collectionPath: string) {
  const prefix = `${collectionPath}/`;
  const expectedSegments = splitPath(collectionPath).length + 1;
  return Object.entries(store.docs)
    .filter(([path]) => {
      if (!path.startsWith(prefix)) return false;
      return splitPath(path).length === expectedSegments;
    })
    .map(([path, value]) => {
      const ref = createDocumentRef(path);
      const decoded = decodeValue(value) as DocumentData;
      return {
        id: ref.id,
        ref,
        data: () => deepClone(decoded)
      } as SnapshotDoc;
    });
}

function listCollectionGroupDocs(collectionId: string) {
  return Object.entries(store.docs)
    .filter(([path]) => {
      const parts = splitPath(path);
      if (parts.length < 2 || parts.length % 2 !== 0) return false;
      return parts[parts.length - 2] === collectionId;
    })
    .map(([path, value]) => {
      const ref = createDocumentRef(path);
      const decoded = decodeValue(value) as DocumentData;
      return {
        id: ref.id,
        ref,
        data: () => deepClone(decoded)
      } as SnapshotDoc;
    });
}

function compareValues(a: unknown, b: unknown) {
  const left = a instanceof Timestamp ? a.toMillis() : a;
  const right = b instanceof Timestamp ? b.toMillis() : b;
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function applyQuery(target: QueryRef) {
  const baseDocs = target.source.kind === 'collection'
    ? listCollectionDocs(target.source.path)
    : listCollectionGroupDocs(target.source.collectionId);

  let docs = [...baseDocs];
  for (const constraint of target.constraints) {
    if (constraint.type === 'where') {
      docs = docs.filter((docEntry) => {
        const data = docEntry.data() as Record<string, unknown>;
        return compareValues(data[constraint.field], constraint.value) === 0;
      });
    }
    if (constraint.type === 'orderBy') {
      docs.sort((a, b) => {
        const left = (a.data() as Record<string, unknown>)[constraint.field];
        const right = (b.data() as Record<string, unknown>)[constraint.field];
        const result = compareValues(left, right);
        return constraint.direction === 'asc' ? result : -result;
      });
    }
    if (constraint.type === 'limit') {
      docs = docs.slice(0, constraint.count);
    }
  }

  return docs;
}

function makeQuerySnapshot(docs: SnapshotDoc[]): QuerySnapshot {
  return {
    docs,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb)
  };
}

function emitChanges() {
  for (const listener of listeners) {
    try {
      if (listener.target.kind === 'collection') {
        listener.onNext(makeQuerySnapshot(listCollectionDocs(listener.target.path)));
      } else {
        listener.onNext(makeQuerySnapshot(applyQuery(listener.target)));
      }
    } catch (error) {
      listener.onError?.(error);
    }
  }
}

function notifyAuth() {
  for (const listener of authListeners) {
    listener(auth.currentUser);
  }
}

function maybeDenyWrite(path: string) {
  if (path.startsWith('_forbidden_test_/') || path.includes('/_forbidden_test_/')) {
    throw firestoreError('permission-denied', 'Write denied by security policy');
  }
}

function userDocPath(uid: string) {
  return `users/${uid}`;
}

function getUserByUid(uid: string) {
  const raw = store.docs[userDocPath(uid)];
  if (!raw) return null;
  return decodeValue(raw) as Record<string, unknown>;
}

function syncAccountFromUserDoc(path: string, data: Record<string, unknown>) {
  if (!path.startsWith('users/')) return;
  const uid = splitPath(path)[1];
  const username = typeof data.username === 'string' ? data.username.toLowerCase() : '';
  const email = typeof data.email === 'string'
    ? data.email.toLowerCase()
    : username
      ? `${username}@pos.com`
      : '';
  if (!email) return;

  const existing = store.authAccounts[email];
  store.authAccounts[email] = {
    uid,
    email,
    password: typeof data.password === 'string' ? data.password : existing?.password || 'admin123'
  };
}

function ensureSeedData() {
  const hasUsers = Object.keys(store.docs).some((path) => path.startsWith('users/'));
  if (!hasUsers) {
    const uid = 'root-admin';
    const user = {
      uid,
      username: 'admin',
      password: 'admin123',
      displayName: 'Super Admin',
      role: 'superadmin',
      permissions: DEFAULT_PERMISSIONS,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    store.docs[userDocPath(uid)] = encodeValue(user);
    store.authAccounts['admin@pos.com'] = {
      uid,
      email: 'admin@pos.com',
      password: 'admin123'
    };
  }

  if (!store.docs['settings/system']) {
    store.docs['settings/system'] = encodeValue({
      id: 'system',
      skuPrefix: 'KK-',
      badDebtThresholdDays: 30,
      taxRate: 16,
      loyaltyPointRate: 100,
      updatedAt: new Date().toISOString()
    });
  }

  writeStore();
}

function accountToAuthUser(account: AuthAccount): AuthLikeUser {
  const profile = getUserByUid(account.uid);
  const displayName = typeof profile?.displayName === 'string' ? profile.displayName : null;
  return {
    uid: account.uid,
    email: account.email,
    displayName,
    emailVerified: true,
    isAnonymous: false,
    tenantId: null,
    providerData: [{
      providerId: 'password',
      displayName,
      email: account.email,
      photoURL: null
    }]
  };
}

function setCurrentUser(user: AuthLikeUser | null) {
  auth.currentUser = user;
  if (user) {
    localStorage.setItem(AUTH_KEY, user.uid);
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
  notifyAuth();
}

function hydrateAuthFromStorage() {
  const uid = localStorage.getItem(AUTH_KEY);
  if (!uid) return;
  const account = Object.values(store.authAccounts).find((entry) => entry.uid === uid);
  if (!account) return;
  auth.currentUser = accountToAuthUser(account);
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
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Data Layer Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
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

  toString() {
    return this.iso;
  }

  valueOf() {
    return this.toMillis();
  }

  [Symbol.toPrimitive](hint: string) {
    if (hint === 'number') return this.toMillis();
    return this.iso;
  }

  get seconds() {
    return Math.floor(this.toMillis() / 1000);
  }
}

ensureSeedData();
hydrateAuthFromStorage();

export function collection(base: DBRef | DocumentRef, path: string) {
  if (base.kind === 'db') {
    const target = normalizePath(path);
    return createCollectionRef(target);
  }
  const target = normalizePath(base.path, path);
  return createCollectionRef(target);
}

export function doc(base: DBRef | CollectionRef, path?: string, maybeId?: string) {
  if (base.kind === 'collection') {
    const id = path || randomId();
    return createDocumentRef(normalizePath(base.path, id));
  }

  const target = maybeId ? normalizePath(path || '', maybeId) : normalizePath(path || '');
  assertDocumentPath(target);
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
  const raw = store.docs[ref.path];
  if (!raw) {
    return {
      id: ref.id,
      ref,
      exists: () => false,
      data: () => ({})
    };
  }

  const decoded = decodeValue(raw) as DocumentData;
  return {
    id: ref.id,
    ref,
    exists: () => true,
    data: () => deepClone(decoded)
  };
}

export async function getDocFromServer(ref: DocumentRef) {
  return getDoc(ref);
}

export async function getDocs(source: CollectionRef | QueryRef): Promise<QuerySnapshot> {
  if (source.kind === 'collection') {
    return makeQuerySnapshot(listCollectionDocs(source.path));
  }
  return makeQuerySnapshot(applyQuery(source));
}

export async function setDoc(ref: DocumentRef, data: any) {
  maybeDenyWrite(ref.path);
  const normalized = applyFieldOps({}, data);
  store.docs[ref.path] = encodeValue(normalized);
  syncAccountFromUserDoc(ref.path, normalized);
  writeStore();
  emitChanges();
}

export async function addDoc(ref: CollectionRef, data: any) {
  const created = doc(ref);
  await setDoc(created, data);
  return created;
}

export async function updateDoc(ref: DocumentRef, data: any) {
  maybeDenyWrite(ref.path);
  const existing = store.docs[ref.path];
  if (!existing) {
    throw firestoreError('not-found', `Document not found: ${ref.path}`);
  }
  const current = decodeValue(existing) as Record<string, unknown>;
  const next = applyFieldOps(current, data);
  store.docs[ref.path] = encodeValue(next);
  syncAccountFromUserDoc(ref.path, next);
  writeStore();
  emitChanges();
}

export async function deleteDoc(ref: DocumentRef) {
  maybeDenyWrite(ref.path);
  delete store.docs[ref.path];
  writeStore();
  emitChanges();
}

export function serverTimestamp() {
  return { __op: 'serverTimestamp' as const };
}

export function increment(by: number) {
  return { __op: 'increment' as const, by };
}

export function writeBatch(_db: DBRef) {
  const operations: Array<() => Promise<void>> = [];
  return {
    set(ref: DocumentRef, data: Record<string, unknown>) {
      operations.push(() => setDoc(ref, data));
    },
    update(ref: DocumentRef, data: any) {
      operations.push(() => updateDoc(ref, data));
    },
    delete(ref: DocumentRef) {
      operations.push(() => deleteDoc(ref));
    },
    async commit() {
      for (const operation of operations) {
        await operation();
      }
    }
  };
}

export function onSnapshot(
  source: CollectionRef | QueryRef,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: unknown) => void
) {
  const listener: Listener = { target: source, onNext, onError };
  listeners.add(listener);
  try {
    if (source.kind === 'collection') {
      onNext(makeQuerySnapshot(listCollectionDocs(source.path)));
    } else {
      onNext(makeQuerySnapshot(applyQuery(source)));
    }
  } catch (error) {
    onError?.(error);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function onAuthStateChanged(_authObj: typeof auth, callback: AuthListener) {
  authListeners.add(callback);
  callback(auth.currentUser);
  return () => {
    authListeners.delete(callback);
  };
}

export async function signInWithEmailAndPassword(_authObj: typeof auth, email: string, password: string) {
  const normalizedEmail = email.toLowerCase();
  const account = store.authAccounts[normalizedEmail];
  if (!account) {
    throw firestoreError('auth/user-not-found', 'Invalid username or password');
  }
  if (account.password !== password) {
    throw firestoreError('auth/wrong-password', 'Invalid username or password');
  }
  const user = accountToAuthUser(account);
  setCurrentUser(user);
  return { user };
}

export async function createUserWithEmailAndPassword(_authObj: typeof auth, email: string, password: string) {
  const normalizedEmail = email.toLowerCase();
  if (store.authAccounts[normalizedEmail]) {
    throw firestoreError('auth/email-already-in-use', 'Email already in use');
  }
  const account: AuthAccount = {
    uid: randomId(),
    email: normalizedEmail,
    password
  };
  store.authAccounts[normalizedEmail] = account;
  writeStore();

  const user = accountToAuthUser(account);
  setCurrentUser(user);
  return { user };
}

export async function createLocalUserAccount(email: string, password: string) {
  const normalizedEmail = email.toLowerCase();
  if (store.authAccounts[normalizedEmail]) {
    throw firestoreError('auth/email-already-in-use', 'Email already in use');
  }
  const account: AuthAccount = {
    uid: randomId(),
    email: normalizedEmail,
    password
  };
  store.authAccounts[normalizedEmail] = account;
  writeStore();
  return { uid: account.uid, email: account.email };
}

export async function updateUserAccountPassword(email: string, password: string) {
  const normalizedEmail = email.toLowerCase();
  const account = store.authAccounts[normalizedEmail];
  if (!account) {
    throw firestoreError('auth/user-not-found', 'User account not found');
  }
  store.authAccounts[normalizedEmail] = {
    ...account,
    password
  };
  writeStore();
}

export async function signInWithPopup(_authObj: typeof auth, _provider: unknown) {
  const email = 'admin@pos.com';
  if (!store.authAccounts[email]) {
    store.authAccounts[email] = {
      uid: randomId(),
      email,
      password: 'admin123'
    };
    writeStore();
  }
  const user = accountToAuthUser(store.authAccounts[email]);
  setCurrentUser(user);
  return { user };
}

export async function signOut(_authObj: typeof auth) {
  setCurrentUser(null);
}

export async function sendPasswordResetEmail(_authObj: typeof auth, _email: string) {
  return;
}

export async function signInAnonymously(_authObj: typeof auth) {
  const user: AuthLikeUser = {
    uid: randomId(),
    email: `anonymous-${Date.now()}@local.pos`,
    displayName: 'Anonymous',
    emailVerified: false,
    isAnonymous: true,
    tenantId: null,
    providerData: []
  };
  setCurrentUser(user);
  return { user };
}

export const EmailAuthProvider = {
  credential(email: string, password: string) {
    return { email: email.toLowerCase(), password };
  }
};

export async function reauthenticateWithCredential(user: AuthLikeUser, credential: { email: string; password: string }) {
  const account = store.authAccounts[credential.email];
  if (!account || account.uid !== user.uid || account.password !== credential.password) {
    throw firestoreError('auth/wrong-password', 'Incorrect current password');
  }
  return { user };
}

export async function updatePassword(user: AuthLikeUser, newPassword: string) {
  const account = store.authAccounts[user.email.toLowerCase()];
  if (!account || account.uid !== user.uid) {
    throw firestoreError('auth/user-not-found', 'User account not found');
  }
  store.authAccounts[user.email.toLowerCase()] = {
    ...account,
    password: newPassword
  };
  writeStore();
}
