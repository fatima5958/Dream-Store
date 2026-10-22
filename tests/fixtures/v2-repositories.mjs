import assert from 'node:assert/strict';

export class MemoryFirestore {
  data = new Map();
  tail = Promise.resolve();
  failCommit = false;
  collection(name) { return new Query(this, name); }
  seed(path, value) { this.data.set(path, structuredClone(value)); }
  async runTransaction(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    const working = new Map([...this.data].map(([k,v]) => [k, structuredClone(v)]));
    let wrote = false;
    const write = (ref, value, mode, options) => {
      wrote = true;
      if (mode === 'create') assert.equal(working.has(ref.path), false, 'create precondition');
      if (mode === 'update') assert.equal(working.has(ref.path), true, 'update precondition');
      if (mode === 'delete') working.delete(ref.path);
      else working.set(ref.path, { ...(mode === 'update' || options?.merge ? working.get(ref.path) : {}), ...structuredClone(value) });
    };
    const tx = {
      get: async ref => { assert.equal(wrote, false, 'Firestore requires all reads before writes'); return ref.read(working); },
      set: (ref,v,o) => write(ref,v,'set',o), create: (ref,v) => write(ref,v,'create'),
      update: (ref,v) => write(ref,v,'update'), delete: ref => write(ref,{},'delete'),
    };
    try {
      const result = await fn(tx);
      if (this.failCommit) throw new Error('simulated Firestore commit failure');
      this.data = working;
      return result;
    } finally { release(); }
  }
}
class Ref {
  constructor(db,path) { this.db=db; this.path=path; this.id=path.split('/').at(-1); }
  collection(name) { return new Query(this.db, this.path+'/'+name); }
  read(data) {
    const value = data.get(this.path);
    return { id:this.id, ref:this, exists: value !== undefined, data: () => structuredClone(value), get: key => value?.[key] };
  }
  async get() { return this.read(this.db.data); }
  async create(value) { assert.equal(this.db.data.has(this.path), false); await this.set(value); }
  async set(value, options) { this.db.seed(this.path, { ...(options?.merge ? this.db.data.get(this.path) : {}), ...value }); }
  async update(value) { assert.ok(this.db.data.has(this.path)); await this.set(value, { merge: true }); }
  async delete() { this.db.data.delete(this.path); }
}
class Query {
  constructor(db,path,filters=[],count=Infinity) { Object.assign(this,{db,path,filters,count}); }
  doc(id) { assert.equal(typeof id,'string'); assert.ok(id && !id.includes('/')); return new Ref(this.db,this.path+'/'+id); }
  where(key,op,value) { return new Query(this.db,this.path,[...this.filters,[key,op,value]],this.count); }
  limit(count) { return new Query(this.db,this.path,this.filters,count); }
  read(data) {
    const docs=[];
    for (const [path,value] of data) {
      if (!path.startsWith(this.path+'/') || path.slice(this.path.length+1).includes('/')) continue;
      if (!this.filters.every(([k,op,v]) => op==='==' ? value[k]===v : op==='<=' ? value[k]<=v : false)) continue;
      docs.push(new Ref(this.db,path).read(data));
      if (docs.length===this.count) break;
    }
    return {docs,empty:docs.length===0,size:docs.length};
  }
  async get() { return this.read(this.db.data); }
}
export class MemoryBucket {
  objects = new Map();
  failSave = false; failDelete = false;
  generation=0;
  file(path) {
    return {
      save: async (data,options) => {
        if(this.failSave) throw new Error('simulated Storage write failure');
        assert.equal(options.preconditionOpts.ifGenerationMatch,0);
        if(this.objects.has(path)) throw new Error('object exists');
        this.objects.set(path,{data:Buffer.from(data),size:String(data.length),contentType:options.metadata.contentType,generation:String(++this.generation)});
      },
      getMetadata: async () => {
        const object=this.objects.get(path); if(!object) throw new Error('object missing');
        return [{...object,data:undefined}];
      },
      download: async () => {
        const object=this.objects.get(path); if(!object) throw new Error('object missing');
        return [Buffer.from(object.data)];
      },
      delete: async () => { if(this.failDelete) throw new Error('simulated Storage delete failure'); this.objects.delete(path); },
    };
  }
}
