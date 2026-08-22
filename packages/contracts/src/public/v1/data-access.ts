import { type Static, Type } from "@sinclair/typebox";

export const DataValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

export const DataFieldTypeSchema = Type.Union([
  Type.Literal("string"),
  Type.Literal("integer"),
  Type.Literal("number"),
  Type.Literal("boolean"),
  Type.Literal("date"),
  Type.Literal("datetime"),
  Type.Literal("json"),
]);

export const HttpDataSourceConfigSchema = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1, maxLength: 2_000 }),
    allowPrivateNetwork: Type.Optional(Type.Boolean()),
    auth: Type.Optional(
      Type.Union([
        Type.Object(
          { type: Type.Literal("none") },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("bearer"),
            secretRef: Type.String({ minLength: 1, maxLength: 200 }),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    maxResponseBytes: Type.Integer({ minimum: 1_024, maximum: 10_485_760 }),
  },
  { additionalProperties: false },
);

export const JdbcDataSourceConfigSchema = Type.Object(
  {
    driverId: Type.Literal("postgresql"),
    jdbcUrl: Type.String({
      minLength: 1,
      maxLength: 2_000,
      pattern: "^jdbc:postgresql://",
    }),
    usernameRef: Type.String({ minLength: 1, maxLength: 200 }),
    passwordRef: Type.String({ minLength: 1, maxLength: 200 }),
    connectionTimeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    statementTimeoutMs: Type.Integer({ minimum: 100, maximum: 60_000 }),
    maxRows: Type.Integer({ minimum: 1, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

export const DataEntitySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    fields: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 200 }),
          type: DataFieldTypeSchema,
          nullable: Type.Boolean(),
          description: Type.Optional(Type.String({ maxLength: 2_000 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1_000 },
    ),
  },
  { additionalProperties: false },
);

export const DataSourceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    kind: Type.Union([Type.Literal("http"), Type.Literal("jdbc")]),
    status: Type.Union([
      Type.Literal("draft"),
      Type.Literal("active"),
      Type.Literal("disabled"),
      Type.Literal("deleted"),
    ]),
    health: Type.Union([
      Type.Literal("unknown"),
      Type.Literal("healthy"),
      Type.Literal("degraded"),
      Type.Literal("unreachable"),
    ]),
    configRevision: Type.Integer({ minimum: 1 }),
    schemaRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    deletedAt: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "DataSourceV1", additionalProperties: false },
);

export const DataSourceDescriptionSchema = Type.Object(
  {
    source: DataSourceSchema,
    runtime: Type.Object(
      {
        live: Type.Literal(true),
        modes: Type.Array(
          Type.Union([Type.Literal("query"), Type.Literal("poll")]),
        ),
        minRefreshIntervalMs: Type.Integer({ minimum: 1_000 }),
      },
      { additionalProperties: false },
    ),
    entities: Type.Array(DataEntitySchema),
  },
  { additionalProperties: false },
);

export const CreateDataSourceRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    kind: Type.Union([Type.Literal("http"), Type.Literal("jdbc")]),
    config: Type.Union([
      HttpDataSourceConfigSchema,
      JdbcDataSourceConfigSchema,
    ]),
    entities: Type.Optional(Type.Array(DataEntitySchema, { maxItems: 100 })),
  },
  { additionalProperties: false },
);

export const RenameDataSourceRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    expectedVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const UpdateDataSourceRequestSchema = Type.Object(
  {
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    config: Type.Optional(
      Type.Union([HttpDataSourceConfigSchema, JdbcDataSourceConfigSchema]),
    ),
    entities: Type.Optional(Type.Array(DataEntitySchema, { maxItems: 100 })),
    expectedVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const DataSourceListResponseSchema = Type.Object(
  { items: Type.Array(DataSourceSchema) },
  { additionalProperties: false },
);

export const DataSourceTestResultSchema = Type.Object(
  {
    sourceId: Type.String({ minLength: 1 }),
    configRevision: Type.Integer({ minimum: 1 }),
    success: Type.Boolean(),
    health: Type.Union([Type.Literal("healthy"), Type.Literal("unreachable")]),
    latencyMs: Type.Integer({ minimum: 0 }),
    checkedAt: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1, maxLength: 2_000 }),
  },
  { additionalProperties: false },
);

export const QueryParameterDefinitionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    type: Type.Union([
      Type.Literal("string"),
      Type.Literal("integer"),
      Type.Literal("number"),
      Type.Literal("boolean"),
      Type.Literal("date"),
      Type.Literal("datetime"),
    ]),
    required: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const HttpQueryOperationSchema = Type.Object(
  {
    method: Type.Union([Type.Literal("GET"), Type.Literal("POST")]),
    path: Type.String({ minLength: 1, maxLength: 1_000 }),
    query: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1, maxLength: 100 }),
        Type.String({ minLength: 1, maxLength: 100 }),
      ),
    ),
    body: Type.Optional(Type.Unknown()),
    rowsPointer: Type.String({ maxLength: 500 }),
    readOnly: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const JdbcQueryOperationSchema = Type.Object(
  {
    sql: Type.String({ minLength: 1, maxLength: 20_000 }),
    readOnly: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const RegisteredQuerySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    sourceId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    revision: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("active"), Type.Literal("retired")]),
    operation: Type.Union([HttpQueryOperationSchema, JdbcQueryOperationSchema]),
    parameters: Type.Array(QueryParameterDefinitionSchema, { maxItems: 100 }),
    columns: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 200 }),
          type: DataFieldTypeSchema,
          nullable: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1_000 },
    ),
    public: Type.Boolean(),
    minRefreshIntervalMs: Type.Integer({ minimum: 1_000 }),
    createdAt: Type.String({ minLength: 1 }),
  },
  { $id: "RegisteredQueryV1", additionalProperties: false },
);

export const CreateRegisteredQueryRequestSchema = Type.Object(
  {
    sourceId: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    operation: Type.Union([HttpQueryOperationSchema, JdbcQueryOperationSchema]),
    parameters: Type.Array(QueryParameterDefinitionSchema, { maxItems: 100 }),
    sampleParameters: Type.Optional(
      Type.Record(Type.String(), DataValueSchema),
    ),
    public: Type.Optional(Type.Boolean()),
    minRefreshIntervalMs: Type.Optional(
      Type.Integer({ minimum: 1_000, maximum: 3_600_000 }),
    ),
  },
  { additionalProperties: false },
);

export const ExecuteQueryRequestSchema = Type.Object(
  {
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
    parameters: Type.Record(Type.String(), DataValueSchema),
  },
  { additionalProperties: false },
);

export const QueryResultSchema = Type.Object(
  {
    rows: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
      maxItems: 10_000,
    }),
    meta: Type.Object(
      {
        columns: RegisteredQuerySchema.properties.columns,
        rowCount: Type.Integer({ minimum: 0 }),
        truncated: Type.Boolean(),
        durationMs: Type.Integer({ minimum: 0 }),
        fetchedAt: Type.String({ minLength: 1 }),
        cache: Type.Object(
          { hit: Type.Boolean() },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const RegisteredQueryListResponseSchema = Type.Object(
  { items: Type.Array(RegisteredQuerySchema) },
  { additionalProperties: false },
);

export type CreateDataSourceRequest = Static<
  typeof CreateDataSourceRequestSchema
>;
export type CreateRegisteredQueryRequest = Static<
  typeof CreateRegisteredQueryRequestSchema
>;
export type DataEntity = Static<typeof DataEntitySchema>;
export type DataSource = Static<typeof DataSourceSchema>;
export type DataSourceDescription = Static<typeof DataSourceDescriptionSchema>;
export type DataSourceListResponse = Static<
  typeof DataSourceListResponseSchema
>;
export type DataSourceTestResult = Static<typeof DataSourceTestResultSchema>;
export type ExecuteQueryRequest = Static<typeof ExecuteQueryRequestSchema>;
export type HttpDataSourceConfig = Static<typeof HttpDataSourceConfigSchema>;
export type HttpQueryOperation = Static<typeof HttpQueryOperationSchema>;
export type JdbcDataSourceConfig = Static<typeof JdbcDataSourceConfigSchema>;
export type JdbcQueryOperation = Static<typeof JdbcQueryOperationSchema>;
export type QueryResult = Static<typeof QueryResultSchema>;
export type RegisteredQuery = Static<typeof RegisteredQuerySchema>;
export type RegisteredQueryListResponse = Static<
  typeof RegisteredQueryListResponseSchema
>;
export type RenameDataSourceRequest = Static<
  typeof RenameDataSourceRequestSchema
>;
export type UpdateDataSourceRequest = Static<
  typeof UpdateDataSourceRequestSchema
>;
