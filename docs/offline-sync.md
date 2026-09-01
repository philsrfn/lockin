# Offline sync

The workout logger is used in basement gyms. A set must never be lost to a dead
bar of signal, and a set must never be *silently* lost — those are different
requirements and both matter.

## The shape

```
tap "Log set"
   │
   ├─→ local_sets           (SQLite, synchronous)     ─→ rendered
   └─→ sync_queue           (SQLite, synchronous)
                │
                ├─ after every write
                ├─ on app foreground        ──→  POST /sync  ──→  Postgres
                └─ every 15s while non-empty
```

Nothing in the tap path awaits the network. `logSet` is a synchronous function.

## Identity

Every queued op carries a client-generated uuid. The server keeps a `sync_log`
of those uuids with the result of each one, so a batch replayed after a dropped
response returns what it returned the first time instead of writing again.

Sets are *also* idempotent by natural key — `sets` has a unique index on
`(session_id, exercise_id, set_index)` and `POST /sets` upserts. Belt and braces:
the same mechanism lets him correct a fat-fingered set by re-logging it.

## Sessions started offline

A workout can begin with no signal at all, so the session exists on the phone
before the server has ever heard of it. Queued sets then reference it by the
client uuid of the `create_session` op ahead of them in the batch, and the
server resolves that through `sync_log` when the batch lands.

Once the session *does* have a server id — because the create drained, or
because the phone adopted a session the server already knew about — ops
reference `sessionId` directly instead. Getting this wrong is not cosmetic:
referencing an adopted session by client uuid looks up a `create_session` that
never existed, and every set is rejected.

## Failure

| Outcome | Queue | UI |
|---|---|---|
| applied / duplicate | row deleted | set shows plain |
| network failure | row kept, attempts++ | `queued`, "N writes waiting" |
| server rejects, retryable | row kept, attempts++ | `queued` |
| server rejects, permanent | row **kept**, `dead = 1` | `not saved`, in red |

A permanently rejected op is never deleted. Dropping it would empty the queue,
which the UI would read as "everything saved" — telling him the opposite of the
truth about a set that is now nowhere. It stays on the phone, flagged, and
`revive()` can re-queue it once the cause is fixed.

## Reads

Every `useResource` GET is cached to SQLite on success and served from cache on
failure, so Today and the weight screen render with no signal. Anything served
from cache says so on screen, and the marker clears once a real response lands.
