/**
 * YAZMA GÖVDESİNDEKİ İLİŞKİ KİMLİKLERİ
 *
 * Prisma eklentisi okuma/yazma sorgusunun kendisini siteye daraltır, ama
 * gövdedeki yabancı anahtarları (`unitId`, `personId`, `connect: { id }`)
 * denetlemez. Başka sitenin kaydına bağlanan bir satır, sonra `include` ile
 * okunduğunda o sitenin verisini sızdırır (ilişki okumaları filtrelenmez).
 *
 * Bu modül, yazma gövdesinden tenant modellerine işaret eden tüm kimlikleri
 * toplar; eklenti bunların başka bir siteye ait olmadığını doğrular.
 */

export interface RelationField {
  /** İlişki alanının adı (`unit`) */
  name: string;
  /** Hedef model (`Unit`) */
  target: string;
  /** Bu modelde tutulan yabancı anahtar sütunları (`['unitId']`); karşı taraf tutuyorsa boş */
  fromFields: readonly string[];
}

export type RelationIndex = ReadonlyMap<string, readonly RelationField[]>;

interface DmmfModel {
  name: string;
  fields: readonly { name: string; kind: string; type: string; relationFromFields?: readonly string[] }[];
}

export function buildRelationIndex(models: readonly DmmfModel[]): RelationIndex {
  return new Map(
    models.map((model) => [
      model.name,
      model.fields
        .filter((field) => field.kind === 'object')
        .map((field) => ({ name: field.name, target: field.type, fromFields: field.relationFromFields ?? [] })),
    ]),
  );
}

type Refs = Map<string, Set<string>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/**
 * Bir yazma gövdesindeki (create / update / createMany öğesi) tenant
 * kimliklerini toplar. İç içe `create`, `createMany`, `connectOrCreate`,
 * `upsert` ve `update` gövdelerine iner.
 */
export function collectForeignRefs(
  index: RelationIndex,
  tenantModels: ReadonlySet<string>,
  model: string,
  data: unknown,
  refs: Refs = new Map(),
): Refs {
  if (Array.isArray(data)) {
    for (const item of data) collectForeignRefs(index, tenantModels, model, item, refs);
    return refs;
  }
  if (!isObject(data)) return refs;

  const add = (target: string, id: unknown) => {
    if (!tenantModels.has(target) || typeof id !== 'string') return;
    if (!refs.has(target)) refs.set(target, new Set());
    refs.get(target)!.add(id);
  };

  for (const relation of index.get(model) ?? []) {
    // Site kimliği eklentinin kendi işi; site tenant modeli değildir
    if (relation.target === 'Site') continue;

    // Bu modeldeki düz yabancı anahtar: { unitId: '...' } — tek sütunlu ilişkiler
    if (relation.fromFields.length === 1) {
      const value = data[relation.fromFields[0]];
      if (isObject(value) && 'set' in value) add(relation.target, value.set);
      else add(relation.target, value);
    }

    const nested = data[relation.name];
    if (!isObject(nested)) continue;

    for (const connect of asList(nested.connect)) {
      if (isObject(connect)) add(relation.target, connect.id);
    }
    for (const item of asList(nested.connectOrCreate)) {
      if (!isObject(item)) continue;
      if (isObject(item.where)) add(relation.target, item.where.id);
      collectForeignRefs(index, tenantModels, relation.target, item.create, refs);
    }
    collectForeignRefs(index, tenantModels, relation.target, nested.create, refs);
    if (isObject(nested.createMany)) {
      collectForeignRefs(index, tenantModels, relation.target, nested.createMany.data, refs);
    }
    for (const item of asList(nested.upsert)) {
      if (!isObject(item)) continue;
      collectForeignRefs(index, tenantModels, relation.target, item.create, refs);
      collectForeignRefs(index, tenantModels, relation.target, item.update, refs);
    }
    // update: tekil ilişkide doğrudan gövde ya da { data }, liste ilişkisinde [{ where, data }]
    for (const item of asList(nested.update)) {
      if (!isObject(item)) continue;
      collectForeignRefs(index, tenantModels, relation.target, 'data' in item ? item.data : item, refs);
    }
  }
  return refs;
}

/** Eklentinin denetlediği yazma işlemleri ve gövdeleri */
export function writeBodies(operation: string, args: Record<string, unknown>): unknown[] {
  switch (operation) {
    case 'create':
    case 'update':
    case 'updateMany':
    case 'createMany':
    case 'createManyAndReturn':
    case 'updateManyAndReturn':
      return [args.data];
    case 'upsert':
      return [args.create, args.update];
    default:
      return [];
  }
}
