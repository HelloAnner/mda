export interface ArtifactStore {
  ready(): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  write(key: string, data: Uint8Array, contentType: string): Promise<void>;
}

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: Bun.S3Client;

  constructor(options: {
    endpoint: string;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.client = new Bun.S3Client(options);
  }

  async ready(): Promise<void> {
    await this.client.list({ maxKeys: 1 });
  }

  async read(key: string): Promise<Uint8Array> {
    const file = this.client.file(key);
    if (!(await file.exists())) throw new Error("Artifact object is missing");
    return new Uint8Array(await file.arrayBuffer());
  }

  async write(
    key: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.client.write(key, data, { type: contentType });
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly objects = new Map<string, Uint8Array>();

  async ready(): Promise<void> {}

  async read(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error("Artifact object is missing");
    return value.slice();
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, data.slice());
  }
}
