# Coding Agent Performance

## Purpose

MDA optimizes the Coding Agent loop without constraining dashboard authorship. Components, visual encodings, layout, interactions, and source organization remain Agent decisions. The platform instead reduces avoidable model output, context growth, repeated validation, and invisible waiting.

## Latency model

An edit Job contains four distinct costs:

1. Model input and first-token latency.
2. Model output, including Tool-call arguments such as source code.
3. Tool execution, clean builds, and Data Source queries.
4. Session compaction and durable artifact upload.

These phases must remain observable separately. A long Tool argument is model generation, not Tool execution; the platform never reports it as a slow filesystem write.

## Source mutation policy

For an existing dashboard, the Agent preserves good work and uses the smallest coherent change:

- Prefer `edit` for focused changes.
- Use `write` for new files or when a complete rewrite is genuinely simpler and safer.
- Do not rewrite a large existing file merely to change a few components, styles, or interactions.
- Split source by meaningful responsibilities when that reduces repeated full-file generation; no file structure is mandatory.
- Do not reread content just written unless a later diagnostic requires it.

This is guidance about efficient coding, not a component system or source DSL.

## Validation policy

The Agent runs one final `validate_dashboard` or `build_preview` after the last source mutation. It repeats a build only after a subsequent source change or a failed diagnostic. It tests a registered Query once while its binding and parameters remain unchanged. Additional checks require a concrete reason.

## Bounded context

Data exploration Tools return representative bounded samples plus complete result metadata. They never place thousands of full rows into Pi history. The runtime compacts before the model reaches its hard context boundary and retains a concise recent tail so later turns do not repeatedly process obsolete full-file Tool arguments.

Compaction remains durable Pi history. It is never implemented by deleting Session entries or silently dropping the user's decisions.

## Progress events

Long model phases emit content-free progress through `agent.progress`:

- `model`: a model turn started.
- `tool-input`: the model is generating Tool arguments, with only Tool name and byte count.
- `compaction`: Session compaction started or completed.

Progress events never contain generated source, prompts, credentials, Query rows, or Tool arguments. The CLI may render them, and durable SSE replay uses the same event contract. During a watch, transient SSE and Job-read socket failures resume from the last durable event cursor instead of terminating an otherwise healthy Job.

## Acceptance criteria

1. Large Tool-argument generation is visible before Tool execution starts.
2. Compaction is visible rather than appearing as an unexplained post-response stall.
3. Query exploration is bounded independently of connector result limits.
4. Focused dashboard repairs normally use targeted edits instead of full-file rewrites.
5. One successful final build is sufficient when no source changes follow it.
6. A transient Job-read failure does not terminate CLI watch or duplicate assistant output.
7. Performance guidance does not prescribe a component, chart, layout, or source structure.
