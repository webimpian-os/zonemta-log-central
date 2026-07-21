# ZoneMTA → Log Central

[![npm version](https://img.shields.io/npm/v/@webimpian/zonemta-log-central.svg)](https://www.npmjs.com/package/@webimpian/zonemta-log-central)
[![License](https://img.shields.io/npm/l/@webimpian/zonemta-log-central.svg)](LICENSE.md)

[ZoneMTA](https://github.com/zone-eu/zone-mta) plugin that ships mail delivery logs to a [Log Central](https://log.dev-aplikasiniaga.com) server: every queued, delivered, deferred, and bounced message becomes a searchable log entry with message-id, recipient, sending zone, and the remote MX response.

Built on [`@webimpian/log-central-node`](https://www.npmjs.com/package/@webimpian/log-central-node) — batched background delivery, capped backoff, and bounded memory, so a Log Central outage can never disrupt mail flow. Hook handlers swallow their own failures and always advance ZoneMTA's plugin chain.

## Installation

Inside your ZoneMTA application directory:

```bash
npm install @webimpian/zonemta-log-central
```

Enable the plugin in the ZoneMTA config:

```toml
# config/plugins/log-central.toml
["modules/@webimpian/zonemta-log-central"]
enabled=["receiver", "main", "sender"]
url="https://logs.example.com/api"
token="your-project-key"
app="your-mta-slug"
environment="production"
channel="zonemta"
```

Alternatively, if you keep local plugins in a `plugins/` folder, drop in a one-line shim as `plugins/log-central.js`:

```js
module.exports = require('@webimpian/zonemta-log-central');
```

and enable it as `["log-central"]` with the same options.

## What gets logged

| ZoneMTA hook | Level | Entry |
|---|---|---|
| `message:queue` | info | Message accepted into the queue (id, from, recipients, interface) |
| `sender:delivered` | info | MX accepted the message (recipient, zone, MX response) |
| `sender:responseError` | warning | Delivery deferred/failed (recipient, zone, error response) |
| `queue:bounce` | error | Message bounced permanently (recipient, response, category) |
| `log:entry` | debug | Raw ZoneMTA message-event feed — **off by default** |

Toggle any of them in the config:

```toml
["modules/@webimpian/zonemta-log-central".events]
queued=false
raw=true
```

## Options

| Option | Default | Purpose |
|---|---|---|
| `url` | *(required)* | Log Central ingest base URL, e.g. `https://logs.example.com/api` |
| `token` | *(required)* | The app's project key (bearer token) |
| `app` | *(required)* | The app's slug, must match the token's app |
| `environment` | `production` | Environment tag on every entry |
| `channel` | `zonemta` | Log channel shown in the Log Central viewer |
| `hostname` | `os.hostname()` | Hostname tag on every entry |
| `batchSize` / `flushInterval` / `maxQueue` | see client | Passed through to [`@webimpian/log-central-node`](https://www.npmjs.com/package/@webimpian/log-central-node) |
| `events` | all on, `raw` off | Toggle individual hooks (see above) |

If `url`, `token`, or `app` is missing, the plugin logs a warning through ZoneMTA's logger and disables itself — it never prevents ZoneMTA from starting.

## Testing

```bash
npm install
npm test
```

## License

MIT — see [LICENSE.md](LICENSE.md).
